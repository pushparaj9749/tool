"""Async Drive mirror: coalescing, atomic pointer, restore round-trip, no stalls."""
import json
import sys
import time
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model.architecture import AnkitLM                                    # noqa: E402
from model.configuration import AnkitConfig                               # noqa: E402
from training.checkpoint import save_checkpoint                           # noqa: E402
from training.mirror import (                                             # noqa: E402
    BackgroundMirror, newest_mirrored_checkpoint, restore_from_mirror,
)

CFG = AnkitConfig(name="mirror-test", vocab_size=128, d_model=32, n_layers=1, n_heads=4,
                  d_ff=64, max_seq_len=16)
RUN_CFG = {"learning_rate": 1e-3, "batch_size": 1}


class FakeDrive:
    """Just a directory that also counts how long copies block the caller."""

    def __init__(self, path: Path) -> None:
        self.path = path


def _ckpt(tmp: Path, tag: str, step: int, model) -> tuple[Path, Path]:
    path = save_checkpoint(tmp, tag, model, None, step, step * 64, CFG, RUN_CFG)
    return path, path.with_suffix(".json")


def test_submit_does_not_block_on_a_slow_copy(tmp_path, monkeypatch):
    """The whole point: the training thread must not wait for the copy."""
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    ckpt, sidecar = _ckpt(local, "step1", 1, model)

    real_copy = __import__("shutil").copyfile

    def slow_copy(src, dst, *a, **kw):
        time.sleep(1.0)                       # stands in for a 1.3 GB Drive write
        return real_copy(src, dst, *a, **kw)

    monkeypatch.setattr("training.mirror.shutil.copyfile", slow_copy)
    mirror = BackgroundMirror(tmp_path / "drive", keep=2)
    t0 = time.time()
    mirror.submit(ckpt, sidecar, step=1)
    assert time.time() - t0 < 0.5, "submit() must return immediately"
    assert mirror.flush(timeout=30)
    assert (tmp_path / "drive" / "step1.pt").exists()


def test_newest_pointer_is_only_written_after_a_complete_copy(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step5", 5, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=5)
        mirror.flush(timeout=30)
    pointer = json.loads((drive / "latest.json").read_text())
    assert pointer["file"] == "step5.pt" and pointer["step"] == 5
    assert (drive / "step5.pt").stat().st_size == ckpt.stat().st_size
    assert not list(drive.glob("*.partial")), "no partial file may survive"


def test_newer_submissions_supersede_queued_ones(tmp_path, monkeypatch):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    real_copy = __import__("shutil").copyfile

    def slow_copy(src, dst, *a, **kw):
        time.sleep(0.4)
        return real_copy(src, dst, *a, **kw)

    monkeypatch.setattr("training.mirror.shutil.copyfile", slow_copy)
    first, first_side = _ckpt(local, "step100", 100, model)
    mirror = BackgroundMirror(drive, keep=3)
    mirror.submit(first, first_side, step=100)
    for step in (200, 300, 400):                       # all queued behind the copy
        ckpt, sidecar = _ckpt(local, f"step{step}", step, model)
        mirror.submit(ckpt, sidecar, step=step)
    assert mirror.flush(timeout=60)
    mirror.close()
    # the queue collapsed to the newest one, so the mirror is never far behind
    assert mirror.stats["coalesced"] >= 2
    assert json.loads((drive / "latest.json").read_text())["step"] == 400
    assert (drive / "step100.pt").exists()


def test_prune_keeps_only_the_newest_and_protects_the_pointer(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    mirror = BackgroundMirror(drive, keep=2)
    for step in (10, 20, 30):
        ckpt, sidecar = _ckpt(local, f"step{step}", step, model)
        mirror.submit(ckpt, sidecar, step=step)
    mirror.flush(timeout=60)
    mirror.close()
    names = sorted(p.name for p in drive.glob("*.pt"))
    assert names == ["step20.pt", "step30.pt"]
    assert json.loads((drive / "latest.json").read_text())["file"] == "step30.pt"


def test_restore_round_trip_repoints_latest_json(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "old_session"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step737", 737, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=737)
        mirror.flush(timeout=30)

    fresh = tmp_path / "fresh_session"                 # simulates a new Colab VM
    dest = restore_from_mirror(drive, fresh)
    assert dest is not None and dest.name == "step737.pt"
    assert dest.stat().st_size == ckpt.stat().st_size
    meta = json.loads((fresh / "latest.json").read_text())
    assert meta["step"] == 737
    assert Path(meta["path"]) == dest.resolve()        # repointed at the local copy
    assert meta["restored_from"].endswith("step737.pt")


def test_newest_mirrored_checkpoint_ignores_truncated_files(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step9", 9, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=9)
        mirror.flush(timeout=30)
    # pretend the copy was cut short by a runtime stop
    (drive / "step9.pt").write_bytes(b"\0" * 16)
    assert newest_mirrored_checkpoint(drive) is None


def test_restore_with_empty_mirror_is_a_no_op(tmp_path):
    drive = tmp_path / "drive"
    drive.mkdir()
    assert newest_mirrored_checkpoint(drive) is None
    assert restore_from_mirror(drive, tmp_path / "fresh") is None


def test_save_checkpoint_hands_off_to_the_async_mirror(tmp_path):
    model = AnkitLM(CFG)
    drive = tmp_path / "drive"
    mirror = BackgroundMirror(drive, keep=2)
    save_checkpoint(tmp_path / "local", "step3", model, None, 3, 192, CFG, RUN_CFG,
                    mirror=mirror)
    mirror.flush(timeout=30)
    mirror.close()
    assert (drive / "step3.pt").exists()
    assert mirror.stats["submitted"] == 1 and mirror.stats["copied"] == 1


def test_missing_source_is_supersession_not_failure(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step11", 11, model)
    mirror = BackgroundMirror(drive, keep=2)
    ckpt.unlink()                                      # pruned before the copy ran
    mirror.submit(ckpt, sidecar, step=11)
    assert mirror.flush(timeout=30)
    mirror.close()
    assert mirror.stats["failed"] == 0
    assert mirror.stats["coalesced"] == 1
