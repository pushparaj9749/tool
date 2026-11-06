"""Non-blocking checkpoint mirror to persistent storage (a mounted Google Drive).

Why this module exists
----------------------
The first real T4 long run wrote a 1.27 GB checkpoint to Google Drive *inside* the
training loop. A sync copy through Drive's FUSE mount took 5-8 minutes, while the
200 steps it covered only needed ~110 s of GPU time. So ~80% of the paid Colab
session was spent waiting for Drive instead of training, and - worse - Drive ended
up far behind the live step counter. When the runtime died, the newest checkpoint
on Drive was step 400 while the GPU had been working for hours.

This module fixes both halves of that:

* the copy runs on a background thread, so the GPU never waits for Drive;
* only the *newest* pending checkpoint is kept (older pending ones are dropped),
  so the mirror can never fall further behind than one copy - it always converges
  on the latest written checkpoint;
* ``latest.json`` in the mirror directory is written only after a copy has been
  fully written and renamed, so a session start can always find the newest
  *complete* checkpoint;
* ``restore_from_mirror()`` copies it back into the local checkpoint directory so
  ``--resume auto`` picks it up on a fresh Colab VM.

Everything here is best-effort: a Drive failure must degrade throughput, never
kill a training run.
"""
from __future__ import annotations

import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

LATEST_NAME = "latest.json"


def _log(msg: str) -> None:
    print(f"[mirror] {msg}", flush=True)


class BackgroundMirror:
    """Copy checkpoints to ``mirror_dir`` on a daemon thread, coalescing updates.

    Example
    -------
    >>> mir = BackgroundMirror("/content/drive/MyDrive/ankit-llm/checkpoints/t4-full")
    >>> save_checkpoint(..., mirror=mir)      # returns immediately
    >>> mir.close(timeout=600)                # wait for the last copy on exit
    """

    def __init__(self, mirror_dir: str | Path, keep: int = 2,
                 slow_warn_s: float = 180.0) -> None:
        self.mirror = Path(mirror_dir)
        self.keep = max(1, int(keep))
        self.slow_warn_s = float(slow_warn_s)
        self._cv = threading.Condition()
        self._pending: Optional[tuple] = None
        self._busy = False
        self._stopping = False
        self._closed = False
        self.stats: Dict[str, Any] = {
            "submitted": 0,
            "copied": 0,
            "coalesced": 0,          # superseded before the copy even started
            "failed": 0,
            "bytes_copied": 0,
            "seconds_copying": 0.0,
            "last_error": None,
            "last_copy_s": None,
            "last_tag": None,
        }
        self.mirror.mkdir(parents=True, exist_ok=True)
        self._thread = threading.Thread(target=self._run, name="ckpt-mirror", daemon=True)
        self._thread.start()

    # ------------------------------------------------------------------ public
    def submit(self, ckpt_file: str | Path, sidecar_file: str | Path,
               step: Optional[int] = None) -> None:
        """Queue ``ckpt_file`` for copying. Never blocks, never raises."""
        job = (Path(ckpt_file), Path(sidecar_file), int(step or 0))
        with self._cv:
            if self._closed:
                _log("mirror already closed - dropping submission")
                return
            if self._pending is not None:
                # a newer checkpoint is already waiting; Drive is behind. Keep the
                # newest one only - the older snapshot is superseded, not lost work
                # (local checkpoints still keep the full history).
                self.stats["coalesced"] += 1
            self._pending = job
            self.stats["submitted"] += 1
            self._cv.notify_all()

    def flush(self, timeout: Optional[float] = None) -> bool:
        """Block until every submitted checkpoint has been copied (or timeout)."""
        deadline = None if timeout is None else time.time() + timeout
        with self._cv:
            while self._pending is not None or self._busy:
                remaining = None if deadline is None else deadline - time.time()
                if remaining is not None and remaining <= 0:
                    return False
                self._cv.wait(0.5 if remaining is None else min(0.5, remaining))
            return True

    def close(self, timeout: Optional[float] = 1800.0) -> bool:
        """Flush, then stop the worker thread. Safe to call more than once."""
        done = self.flush(timeout)
        with self._cv:
            self._closed = True
            self._stopping = True
            self._cv.notify_all()
        if self._thread.is_alive():
            self._thread.join(timeout=30)
        if not done:
            _log("WARNING close() timed out - the last copy may be incomplete on Drive")
        return done

    # context manager
    def __enter__(self) -> "BackgroundMirror":
        return self

    def __exit__(self, *_exc) -> None:      # noqa: D105
        self.close()

    # ------------------------------------------------------------------ worker
    def _run(self) -> None:
        while True:
            with self._cv:
                while self._pending is None and not self._stopping:
                    self._cv.wait(0.5)
                if self._pending is None and self._stopping:
                    return
                job = self._pending
                self._pending = None
                self._busy = True
            ckpt, sidecar, step = job
            t0 = time.time()
            missing = False
            try:
                self._copy(ckpt, sidecar, step)
            except FileNotFoundError:
                # the local checkpoint was pruned before we got to it: the newer
                # checkpoint that caused the prune is what matters, so this is
                # supersession, not failure
                missing = True
                self.stats["coalesced"] += 1
            except BaseException as exc:                     # noqa: BLE001
                self.stats["failed"] += 1
                self.stats["last_error"] = f"{type(exc).__name__}: {exc}"
                _log(f"WARNING copy of {ckpt.name} failed: {type(exc).__name__}: {exc}")
            finally:
                dt = time.time() - t0
                with self._cv:
                    self._busy = False
                    self.stats["seconds_copying"] += dt
                    self.stats["last_copy_s"] = round(dt, 1)
                    self._cv.notify_all()
                if not missing and dt > self.slow_warn_s:
                    try:
                        size = ckpt.stat().st_size / 1e9
                    except OSError:
                        size = float("nan")
                    _log(f"slow copy: {ckpt.name} took {dt/60:.1f} min ({size:.2f} GB)")

    def _copy(self, ckpt: Path, sidecar: Path, step: int) -> Path:
        self.mirror.mkdir(parents=True, exist_ok=True)
        tag = ckpt.stem
        dest = self.mirror / ckpt.name
        tmp = self.mirror / f".{tag}.pt.partial"
        # .partial -> rename so a runtime kill mid-copy can never leave a truncated
        # file that looks like a valid checkpoint
        shutil.copyfile(ckpt, tmp)
        expected = ckpt.stat().st_size
        got = tmp.stat().st_size
        if got != expected:
            tmp.unlink(missing_ok=True)
            raise IOError(f"short copy for {tag}: {got} != {expected} bytes")
        if sidecar.exists():
            shutil.copyfile(sidecar, self.mirror / sidecar.name)
        os.replace(tmp, dest)
        latest = {
            "tag": tag,
            "file": dest.name,
            "step": step,
            "bytes": expected,
            "mirrored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        pointer = self.mirror / LATEST_NAME
        tmp_pointer = self.mirror / f".{LATEST_NAME}.partial"
        tmp_pointer.write_text(json.dumps(latest, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp_pointer, pointer)
        with self._cv:
            self.stats["copied"] += 1
            self.stats["bytes_copied"] += expected
            self.stats["last_tag"] = tag
        self._prune(protected=dest.name)
        _log(f"mirrored {dest.name} ({expected/1e9:.2f} GB, step {step})")
        return dest

    def _prune(self, protected: Optional[str] = None) -> None:
        """Keep only the newest ``keep`` .pt files in the mirror directory."""
        try:
            files = sorted(self.mirror.glob("*.pt"), key=lambda p: p.stat().st_mtime)
        except OSError:
            return
        for old in files[:max(0, len(files) - self.keep)]:
            if protected and old.name == protected:
                continue
            for path in (old, old.with_suffix(".json")):
                try:
                    path.unlink(missing_ok=True)
                except OSError as exc:          # Drive hiccup: not fatal
                    _log(f"could not prune {path.name}: {exc}")


# ---------------------------------------------------------------- resume helpers
def newest_mirrored_checkpoint(mirror_dir: str | Path) -> Optional[Path]:
    """Path of the newest *complete* mirrored checkpoint, or None.

    Trusts ``latest.json`` (written only after a rename) and falls back to the
    highest-step sidecar found in the directory.
    """
    mirror = Path(mirror_dir)
    if not mirror.exists():
        return None
    pointer = mirror / LATEST_NAME
    if pointer.exists():
        try:
            meta = json.loads(pointer.read_text(encoding="utf-8"))
            candidate = mirror / meta["file"]
            if candidate.exists() and candidate.stat().st_size == int(meta.get("bytes", 0)):
                return candidate
        except (OSError, ValueError, KeyError):
            pass
    best: Optional[tuple] = None
    for sidecar in mirror.glob("*.json"):
        if sidecar.name == LATEST_NAME:
            continue
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
            ckpt = sidecar.with_suffix(".pt")
            if not ckpt.exists():
                continue
            # a truncated file (runtime stopped mid-copy) must never be offered as
            # resumable, even when latest.json is stale or missing
            size = ckpt.stat().st_size
            if "bytes" in meta and size != int(meta["bytes"]):
                continue
            key = (int(meta.get("step", 0)), ckpt.stat().st_mtime)
        except (OSError, ValueError):
            continue
        if best is None or key > best[0]:
            best = (key, ckpt)
    return best[1] if best else None


def restore_from_mirror(mirror_dir: str | Path, ckpt_dir: str | Path) -> Optional[Path]:
    """Copy the newest mirrored checkpoint into ``ckpt_dir`` and repoint latest.json.

    A fresh Colab VM has an empty local disk, so ``--resume auto`` (which looks at
    ``<ckpt_dir>/latest.json``) needs exactly this. The sidecar's ``path`` field is
    rewritten to the local path, because the Drive copy still records the absolute
    path of the session that wrote it.
    """
    src = newest_mirrored_checkpoint(mirror_dir)
    if src is None:
        return None
    ckpt_dir = Path(ckpt_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    dest = ckpt_dir / src.name
    tmp = ckpt_dir / f".{src.stem}.pt.partial"
    shutil.copyfile(src, tmp)
    if tmp.stat().st_size != src.stat().st_size:
        tmp.unlink(missing_ok=True)
        raise IOError(f"short copy while restoring {src.name}")
    os.replace(tmp, dest)
    sidecar_src = src.with_suffix(".json")
    sidecar: Dict[str, Any] = {}
    if sidecar_src.exists():
        try:
            sidecar = json.loads(sidecar_src.read_text(encoding="utf-8"))
        except ValueError:
            sidecar = {}
    sidecar.update({"path": str(dest.resolve()),
                    "restored_from": str(src),
                    "restored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    if "bytes" not in sidecar:
        sidecar["bytes"] = dest.stat().st_size
    (ckpt_dir / f"{src.stem}.json").write_text(json.dumps(sidecar, indent=2) + "\n",
                                               encoding="utf-8")
    (ckpt_dir / LATEST_NAME).write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    _log(f"restored {src.name} (step {sidecar.get('step')}) -> {dest}")
    return dest
