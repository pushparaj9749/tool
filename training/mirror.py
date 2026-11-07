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
LATEST_CKPT_NAME = "latest.pt"      # one rolling file: overwritten, never pruned


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
                 slow_warn_s: float = 180.0, max_retries: int = 2,
                 retry_delay_s: float = 12.0) -> None:
        self.mirror = Path(mirror_dir)
        self.keep = max(1, int(keep))
        self.slow_warn_s = float(slow_warn_s)
        self.max_retries = max(0, int(max_retries))
        self.retry_delay_s = float(retry_delay_s)
        self.last_ok_at: Optional[float] = None
        self.last_ok_step = -1
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
            "retried": 0,
            "bytes_copied": 0,
            "seconds_copying": 0.0,
            "last_error": None,
            "last_copy_s": None,
            "last_tag": None,
        }
        self.mirror.mkdir(parents=True, exist_ok=True)
        # a .partial left behind by a killed runtime is useless and costs Drive quota
        for stale in self.mirror.glob(".*.partial"):
            try:
                stale.unlink()
                _log(f"removed stale partial {stale.name}")
            except OSError:
                pass
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
            superseded = False
            attempt = 0
            while True:
                attempt += 1
                try:
                    self._copy(ckpt, sidecar, step)
                    break
                except FileNotFoundError:
                    # the local checkpoint was pruned before we reached it: the newer
                    # checkpoint that caused the prune is what matters. Not a failure.
                    superseded = True
                    self.stats["coalesced"] += 1
                    break
                except BaseException as exc:                 # noqa: BLE001
                    if attempt <= self.max_retries:
                        delay = self.retry_delay_s * attempt
                        self.stats["retried"] += 1
                        _log(f"copy of {ckpt.name} failed (attempt {attempt}): "
                             f"{type(exc).__name__}: {exc} — retrying in {delay:.0f}s")
                        time.sleep(delay)
                        continue
                    self.stats["failed"] += 1
                    self.stats["last_error"] = f"{type(exc).__name__}: {exc}"
                    _log(f"MIRROR FAILED for {ckpt.name} after {attempt} attempt(s): "
                         f"{type(exc).__name__}: {exc}. Training continues, but this "
                         f"checkpoint is NOT on Drive.")
                    break
            dt = time.time() - t0
            with self._cv:
                self._busy = False
                self.stats["seconds_copying"] += dt
                self.stats["last_copy_s"] = round(dt, 1)
                self._cv.notify_all()
            if not superseded and dt > self.slow_warn_s:
                try:
                    size = ckpt.stat().st_size / 1e9
                except OSError:
                    size = float("nan")
                _log(f"slow copy: {ckpt.name} took {dt/60:.1f} min ({size:.2f} GB)")

    def _copy(self, ckpt: Path, sidecar: Path, step: int) -> Path:
        self.mirror.mkdir(parents=True, exist_ok=True)
        tag = ckpt.stem
        # ONE rolling file, overwritten each time. Step-tagged copies looked tidier
        # but every prune moves a 1.27 GB file into the Drive trash, and trash counts
        # against the quota: a few hundred saves would have leaked hundreds of GB.
        dest = self.mirror / LATEST_CKPT_NAME
        tmp = self.mirror / f".{LATEST_CKPT_NAME}.partial"
        # .partial -> rename so a runtime kill mid-copy can never leave a truncated
        # file that looks like a valid checkpoint
        shutil.copyfile(ckpt, tmp)
        expected = ckpt.stat().st_size
        got = tmp.stat().st_size
        if got != expected:
            tmp.unlink(missing_ok=True)
            raise IOError(f"short copy for {tag}: {got} != {expected} bytes")
        os.replace(tmp, dest)
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8")) if sidecar.exists() else {}
        except ValueError:
            meta = {}
        latest = {
            "tag": tag,
            "file": dest.name,
            "step": step,
            "bytes": expected,
            "mirrored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            # the sidecar's own fields (sha256, tokens_seen, created_at) so a restore
            # can still verify and name the file correctly
            "sha256": meta.get("sha256"),
            "tokens_seen": meta.get("tokens_seen"),
            "created_at": meta.get("created_at"),
        }
        pointer = self.mirror / LATEST_NAME
        tmp_pointer = self.mirror / f".{LATEST_NAME}.partial"
        tmp_pointer.write_text(json.dumps(latest, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp_pointer, pointer)
        landed = dest.stat().st_size
        if landed != expected:                       # FUSE can lie about a rename
            dest.unlink(missing_ok=True)
            raise IOError(f"mirrored file is {landed} bytes, expected {expected}")
        with self._cv:
            self.stats["copied"] += 1
            self.stats["bytes_copied"] += expected
            self.stats["last_tag"] = tag
            self.last_ok_at = time.time()
            self.last_ok_step = max(self.last_ok_step, int(step or 0))
        _log(f"mirrored {tag} -> {dest.name} ({expected/1e9:.2f} GB, step {step})")
        return dest

    def _prune(self, protected: Optional[str] = None) -> None:
        """Legacy helper, no longer called.

        Pruning through a Drive FUSE mount only moves files to the trash, which still
        counts against the quota - so the mirror now overwrites one rolling file
        instead of deleting old step-tagged ones.
        """
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


    def health(self, step: Optional[int] = None) -> Dict[str, Any]:
        """What the mirror is actually doing - the thing that was missing when a run
        kept training while silently persisting nothing."""
        with self._cv:
            age = None if self.last_ok_at is None else round(time.time() - self.last_ok_at, 1)
            return {
                "copied": self.stats["copied"],
                "failed": self.stats["failed"],
                "retried": self.stats["retried"],
                "coalesced": self.stats["coalesced"],
                "last_ok_step": self.last_ok_step,
                "last_ok_age_s": age,
                # while nothing has ever landed, "behind" is measured from step 0, so
                # a run that never mirrors (the failure that lost last session's tail)
                # still trips the watchdog instead of looking healthy
                "steps_behind": (None if step is None
                                 else int(step) - max(self.last_ok_step, 0)),
                "busy": self._busy,
                "pending": self._pending is not None,
                "last_error": self.stats["last_error"],
            }


# --------------------------------------------------------- heartbeat / preflight
HEARTBEAT_NAME = "heartbeat.json"


def write_heartbeat(mirror_dir: str | Path, payload: Dict[str, Any],
                   mirror: Optional["BackgroundMirror"] = None) -> bool:
    """Tiny file on the mirror telling us how far training really got.

    A checkpoint is 1.27 GB and can fail for a dozen reasons; a 400-byte heartbeat
    usually still lands and answers the question that cost the last session its
    tail: "the GPU ran - did anything get saved?" Never raises.
    """
    if not mirror_dir:
        return False
    try:
        target = Path(mirror_dir)
        target.mkdir(parents=True, exist_ok=True)
        body = dict(payload)
        body["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if mirror is not None:
            body["mirror"] = mirror.health(step=payload.get("step"))
        tmp = target / f".{HEARTBEAT_NAME}.partial"
        tmp.write_text(json.dumps(body, indent=2) + "\n", encoding="utf-8")
        os.replace(tmp, target / HEARTBEAT_NAME)
        return True
    except OSError as exc:
        print(f"[mirror] WARNING heartbeat write failed: {exc}", flush=True)
        return False


def read_heartbeat(mirror_dir: str | Path) -> Optional[Dict[str, Any]]:
    path = Path(mirror_dir) / HEARTBEAT_NAME
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def probe_dir(mirror_dir: str | Path, label: str = "probe") -> tuple[bool, str]:
    """Can we actually write to the mirror right now? Cheap and explicit."""
    if not mirror_dir:
        return False, "no mirror configured"
    try:
        target = Path(mirror_dir)
        target.mkdir(parents=True, exist_ok=True)
        probe = target / f".{label}.probe"
        probe.write_text(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), encoding="utf-8")
        probe.unlink()
        return True, "ok"
    except OSError as exc:
        return False, f"{type(exc).__name__}: {exc}"


# ---------------------------------------------------------------- resume helpers
def newest_mirrored_checkpoint(mirror_dir: str | Path) -> Optional[Path]:
    """Path of the newest *complete* mirrored checkpoint, or None.

    Trusts ``latest.json`` (written only after a rename, with the byte count) and
    falls back to the highest-step sidecar found in the directory, so checkpoints
    mirrored by an older build are still resumable.
    """
    mirror = Path(mirror_dir)
    if not mirror.exists():
        return None
    pointer = mirror / LATEST_NAME
    if pointer.exists():
        try:
            meta = json.loads(pointer.read_text(encoding="utf-8"))
            candidate = mirror / meta.get("file", LATEST_CKPT_NAME)
            if candidate.exists() and candidate.stat().st_size == int(meta.get("bytes", -1)):
                return candidate
        except (OSError, ValueError, KeyError, TypeError):
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
    ``<ckpt_dir>/latest.json``) needs exactly this. The stored sidecar's ``path`` is
    rewritten to the local path, because the Drive copy still records the location of
    the session that wrote it.
    """
    src = newest_mirrored_checkpoint(mirror_dir)
    if src is None:
        return None
    meta: Dict[str, Any] = {}
    for candidate in (Path(mirror_dir) / LATEST_NAME, src.with_suffix(".json")):
        if candidate.exists():
            try:
                meta = json.loads(candidate.read_text(encoding="utf-8"))
                break
            except (OSError, ValueError):
                meta = {}
    tag = str(meta.get("tag") or src.stem)
    ckpt_dir = Path(ckpt_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    dest = ckpt_dir / f"{tag}.pt"
    tmp = ckpt_dir / f".{tag}.pt.partial"
    shutil.copyfile(src, tmp)
    if tmp.stat().st_size != src.stat().st_size:
        tmp.unlink(missing_ok=True)
        raise IOError(f"short copy while restoring {src.name}")
    os.replace(tmp, dest)
    sidecar = dict(meta)
    sidecar.update({"tag": tag, "path": str(dest.resolve()),
                    "bytes": dest.stat().st_size,
                    "restored_from": str(src),
                    "restored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    sidecar.pop("file", None)
    sidecar.pop("mirrored_at", None)
    (ckpt_dir / f"{tag}.json").write_text(json.dumps(sidecar, indent=2) + "\n",
                                          encoding="utf-8")
    (ckpt_dir / LATEST_NAME).write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    _log(f"restored {src.name} (tag {tag}, step {sidecar.get('step')}) -> {dest}")
    return dest
