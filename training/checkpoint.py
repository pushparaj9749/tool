"""Checkpointing: atomic saves, SHA-256 integrity, resume, retention policy."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import time
from pathlib import Path
from typing import Any, Dict, Optional

import torch

from model.configuration import AnkitConfig


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def free_gb(path: str | Path) -> float:
    # the target directory may not exist yet: walk up to the first existing parent
    p = Path(path).resolve()
    while not p.exists() and p != p.parent:
        p = p.parent
    usage = shutil.disk_usage(str(p))
    return usage.free / 1e9


def require_free_space(path: str | Path, min_gb: float) -> None:
    have = free_gb(path)
    if have < min_gb:
        raise RuntimeError(f"insufficient disk space: {have:.2f} GB free < {min_gb} GB required")


def save_checkpoint(
    ckpt_dir: str | Path,
    tag: str,
    model: torch.nn.Module,
    optimizer: Optional[torch.optim.Optimizer],
    step: int,
    tokens_seen: int,
    model_config: AnkitConfig,
    run_cfg: Dict[str, Any],
    best_val_loss: Optional[float] = None,
    extra: Optional[Dict[str, Any]] = None,
    scaler: Optional[Any] = None,
    mirror_dir: Optional[str | Path] = None,
) -> Path:
    ckpt_dir = Path(ckpt_dir)
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    final = ckpt_dir / f"{tag}.pt"
    tmp = ckpt_dir / f".{tag}.pt.tmp"
    payload = {
        "format_version": 1,
        "tag": tag,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "step": step,
        "tokens_seen": tokens_seen,
        "model_config": model_config.to_dict(),
        "run_config": run_cfg,
        "best_val_loss": best_val_loss,
        # tensors are moved to CPU so a checkpoint written on a GPU host can be
        # resumed on a CPU host (and vice versa) and loaded without a GPU present
        "model": {k: v.detach().cpu() for k, v in model.state_dict().items()},
        "optimizer": _optimizer_to_cpu(optimizer),
        "scaler": scaler.state_dict() if scaler is not None and getattr(scaler, "is_enabled", lambda: False)() else None,
        "torch_rng": torch.get_rng_state(),
        "extra": extra or {},
    }
    torch.save(payload, tmp)
    os.replace(tmp, final)                     # atomic on POSIX
    sidecar = {
        "tag": tag,
        "path": str(final),
        "bytes": final.stat().st_size,
        "sha256": _sha256(final),
        "step": step,
        "tokens_seen": tokens_seen,
        "created_at": payload["created_at"],
    }
    (ckpt_dir / f"{tag}.json").write_text(json.dumps(sidecar, indent=2) + "\n", encoding="utf-8")
    # newest valid checkpoint pointer
    (ckpt_dir / "latest.json").write_text(
        json.dumps({"tag": tag, **sidecar}, indent=2) + "\n", encoding="utf-8"
    )
    if mirror_dir:
        mirror_checkpoint(final, ckpt_dir / f"{tag}.json", mirror_dir)
    return final


def _to_cpu_copy(obj: Any) -> Any:
    """Deep, non-aliasing CPU copy of a state_dict tree.

    `Optimizer.state_dict()` shares tensor *objects* with the live `optimizer.state`,
    so mutating the returned dict in place silently moves the live Adam moments to
    the CPU. On a GPU run the next `optimizer.step()` then dies with
    "Expected all tensors to be on the same device ... cuda:0 and cpu".
    (`copy=True` also detaches the storage, so the saved file cannot alias the
    live tensors either.)
    """
    if torch.is_tensor(obj):
        return obj.detach().to("cpu", copy=True)
    if isinstance(obj, dict):
        return {k: _to_cpu_copy(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return type(obj)(_to_cpu_copy(v) for v in obj)
    return obj


def _optimizer_to_cpu(optimizer: Optional[torch.optim.Optimizer]) -> Optional[Dict[str, Any]]:
    """CPU-portable copy of the optimizer state; never touches the live optimizer."""
    if optimizer is None:
        return None
    return _to_cpu_copy(optimizer.state_dict())


def move_optimizer_state_to(optimizer: torch.optim.Optimizer, device: torch.device) -> int:
    """Put every optimizer-state tensor on `device` (belt and braces after a resume).

    `load_state_dict()` normally casts to the parameter device already, but a
    checkpoint written by an older build may hold CPU-pinned moments; forcing the
    device here means a resume can never mix cuda and cpu inside one Adam step.
    Returns the number of tensors that had to be moved.
    """
    moved = 0
    for state in optimizer.state.values():
        for key, value in list(state.items()):
            if torch.is_tensor(value) and value.device != device:
                state[key] = value.to(device)
                moved += 1
    return moved


def _prune_mirror(mirror: Path, keep: int = 3) -> None:
    """Keep the newest N mirrored .pt files (Drive fills up fast at 1.1 GB each)."""
    files = sorted(mirror.glob("*.pt"), key=lambda p: p.stat().st_mtime)
    for old in files[:-keep] if keep > 0 else []:
        for path in (old, old.with_suffix(".json")):
            if path.exists():
                path.unlink()


def mirror_checkpoint(ckpt_file: Path, sidecar_file: Path, mirror_dir: str | Path) -> Optional[Path]:
    """Copy a checkpoint to persistent storage (e.g. mounted Google Drive).

    Written to a .partial name first, then renamed, so a Colab disconnect during
    the copy can never leave a truncated file masquerading as the latest checkpoint.
    """
    try:
        mirror = Path(mirror_dir)
        mirror.mkdir(parents=True, exist_ok=True)
        dest = mirror / ckpt_file.name
        tmp = mirror / (ckpt_file.name + ".partial")
        shutil.copyfile(ckpt_file, tmp)
        shutil.copyfile(sidecar_file, mirror / sidecar_file.name)
        os.replace(tmp, dest)
        _prune_mirror(mirror, keep=3)
        return dest
    except OSError as exc:                     # Drive hiccups must not kill training
        print(f"[checkpoint] WARNING mirror to {mirror_dir} failed: {exc}")
        return None


def list_checkpoints(ckpt_dir: str | Path) -> list[dict]:
    ckpt_dir = Path(ckpt_dir)
    out = []
    for sidecar in sorted(ckpt_dir.glob("*.json")):
        if sidecar.name == "latest.json":
            continue
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
        out.append(meta)
    return sorted(out, key=lambda m: m.get("step", 0))


def verify_checkpoint(meta: Dict[str, Any]) -> bool:
    path = Path(meta["path"])
    if not path.exists():
        return False
    if "sha256" in meta and _sha256(path) != meta["sha256"]:
        return False
    return True


def prune_checkpoints(ckpt_dir: str | Path, keep_last: int) -> list[str]:
    removed = []
    metas = list_checkpoints(ckpt_dir)
    for meta in metas[:-keep_last] if keep_last > 0 else []:
        path = Path(meta["path"])
        sidecar = path.with_suffix(".json")
        order = Path(ckpt_dir) / "latest.json"
        latest = json.loads(order.read_text(encoding="utf-8")) if Path(order).exists() else {}
        if path.name == Path(latest.get("path", "")).name:
            continue
        if path.exists():
            path.unlink()
        if sidecar.exists():
            sidecar.unlink()
        removed.append(str(path))
    return removed


def load_checkpoint(path: str | Path, map_location: str = "cpu",
                    verify: bool = True, with_optimizer: bool = True) -> Dict[str, Any]:
    path = Path(path)
    if verify:
        sidecar = path.with_suffix(".json")
        if sidecar.exists():
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
            if "sha256" in meta and _sha256(path) != meta["sha256"]:
                raise RuntimeError(f"checkpoint integrity check failed for {path}")
    payload = torch.load(path, map_location=map_location, weights_only=False)
    if not with_optimizer:
        payload["optimizer"] = None
        payload["scaler"] = None
    return payload


def resolve_resume(ckpt_dir: str | Path, mode: str = "auto") -> Optional[Path]:
    ckpt_dir = Path(ckpt_dir)
    if mode in ("none", "false", ""):
        return None
    latest = ckpt_dir / "latest.json"
    if latest.exists():
        meta = json.loads(latest.read_text(encoding="utf-8"))
        path = Path(meta["path"])
        if path.exists() and verify_checkpoint(meta):
            return path
    if mode == "auto":
        return None
    raise FileNotFoundError(f"--resume={mode} requested but no valid checkpoint in {ckpt_dir}")
