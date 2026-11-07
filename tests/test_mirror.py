"""Async Drive mirror: coalescing, one rolling file, atomic pointer, restore, alarms."""
import json
import shutil
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
    BackgroundMirror, newest_mirrored_checkpoint, probe_dir, read_heartbeat,
    restore_from_mirror, write_heartbeat,
)

CFG = AnkitConfig(name="mirror-test", vocab_size=128, d_model=32, n_layers=1, n_heads=4,
                  d_ff=64, max_seq_len=16)
RUN_CFG = {"learning_rate": 1e-3, "batch_size": 1}


def _ckpt(tmp: Path, tag: str, step: int, model) -> tuple[Path, Path]:
    path = save_checkpoint(tmp, tag, model, None, step, step * 64, CFG, RUN_CFG)
    return path, path.with_suffix(".json")


def _pointer(drive: Path) -> dict:
    return json.loads((drive / "latest.json").read_text())


# ------------------------------------------------------------------ core behaviour
def test_submit_does_not_block_on_a_slow_copy(tmp_path, monkeypatch):
    """The whole point: the training thread must not wait for the copy."""
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    ckpt, sidecar = _ckpt(local, "step1", 1, model)
    real_copy = shutil.copyfile

    def slow_copy(src, dst, *a, **kw):
        time.sleep(1.0)                       # stands in for a 1.3 GB Drive write
        return real_copy(src, dst, *a, **kw)

    monkeypatch.setattr("training.mirror.shutil.copyfile", slow_copy)
    mirror = BackgroundMirror(tmp_path / "drive", keep=2)
    t0 = time.time()
    mirror.submit(ckpt, sidecar, step=1)
    assert time.time() - t0 < 0.5, "submit() must return immediately"
    assert mirror.flush(timeout=30)
    assert (tmp_path / "drive" / "latest.pt").exists()


def test_pointer_is_only_written_after_a_complete_copy(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step5", 5, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=5)
        mirror.flush(timeout=30)
    pointer = _pointer(drive)
    assert pointer["tag"] == "step5" and pointer["step"] == 5
    assert pointer["file"] == "latest.pt"
    assert (drive / "latest.pt").stat().st_size == ckpt.stat().st_size
    assert not list(drive.glob(".*.partial")), "no partial file may survive"


def test_newer_submissions_supersede_queued_ones(tmp_path, monkeypatch):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    real_copy = shutil.copyfile

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
    assert mirror.stats["coalesced"] >= 2
    assert _pointer(drive)["step"] == 400


def test_one_rolling_file_so_the_drive_trash_never_grows(tmp_path):
    """Pruning leaked quota: every unlink on a Drive mount moves 1.27 GB to trash."""
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    mirror = BackgroundMirror(drive, keep=2)
    for step in (10, 20, 30, 40):
        ckpt, sidecar = _ckpt(local, f"step{step}", step, model)
        mirror.submit(ckpt, sidecar, step=step)
    assert mirror.flush(timeout=60)
    mirror.close()
    assert sorted(p.name for p in drive.glob("*.pt")) == ["latest.pt"]
    assert _pointer(drive)["step"] == 40


def test_restore_round_trip_gives_the_file_its_real_name(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "old_session"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step737", 737, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=737)
        mirror.flush(timeout=30)

    fresh = tmp_path / "fresh_session"                 # simulates a new Colab VM
    dest = restore_from_mirror(drive, fresh)
    assert dest is not None and dest.name == "step737.pt"   # rolling name -> real tag
    assert dest.stat().st_size == ckpt.stat().st_size
    meta = json.loads((fresh / "latest.json").read_text())
    assert meta["step"] == 737 and meta["tag"] == "step737"
    assert Path(meta["path"]) == dest.resolve()        # repointed at the local copy
    assert meta["sha256"] == json.loads(sidecar.read_text())["sha256"]


def test_newest_mirrored_checkpoint_ignores_a_truncated_file(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step9", 9, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=9)
        mirror.flush(timeout=30)
    (drive / "latest.pt").write_bytes(b"\0" * 16)      # runtime stopped mid-copy
    assert newest_mirrored_checkpoint(drive) is None


def test_legacy_step_tagged_mirrors_are_still_resumable(tmp_path):
    """Checkpoints already on Drive from the old build must not become unusable."""
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    drive.mkdir()
    ckpt, sidecar = _ckpt(local, "step400", 400, model)
    shutil.copyfile(ckpt, drive / "step400.pt")
    shutil.copyfile(sidecar, drive / "step400.json")
    found = newest_mirrored_checkpoint(drive)
    assert found is not None and found.name == "step400.pt"


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
    assert (drive / "latest.pt").exists()
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


# ------------------------------------------------------------------ observability
def test_heartbeat_round_trip_and_mirror_health(tmp_path):
    drive = tmp_path / "drive"
    mirror = BackgroundMirror(drive, keep=2)
    ok = write_heartbeat(drive, {"step": 5520, "tokens_seen": 45_219_840, "loss": 3.91},
                         mirror)
    assert ok
    beat = read_heartbeat(drive)
    assert beat["step"] == 5520 and beat["mirror"]["copied"] == 0
    assert (drive / "heartbeat.json").exists()
    mirror.close()


def test_health_reports_how_far_behind_the_mirror_is(tmp_path):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step200", 200, model)
    with BackgroundMirror(drive, keep=2) as mirror:
        mirror.submit(ckpt, sidecar, step=200)
        mirror.flush(timeout=30)
        h = mirror.health(step=1600)
    assert h["copied"] == 1 and h["last_ok_step"] == 200
    assert h["steps_behind"] == 1400
    assert h["last_ok_age_s"] is not None


def test_failed_copy_is_reported_not_swallowed(tmp_path, monkeypatch):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step50", 50, model)

    def broken_copy(*_a, **_kw):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr("training.mirror.shutil.copyfile", broken_copy)
    mirror = BackgroundMirror(drive, keep=2, max_retries=1, retry_delay_s=0.01)
    mirror.submit(ckpt, sidecar, step=50)
    assert mirror.flush(timeout=30)
    mirror.close()
    assert mirror.stats["failed"] == 1
    assert mirror.stats["retried"] == 1
    assert "No space left" in (mirror.stats["last_error"] or "")
    assert mirror.health(step=50)["last_ok_step"] == -1


def test_transient_failure_recovers_on_retry(tmp_path, monkeypatch):
    model = AnkitLM(CFG)
    local = tmp_path / "local"
    drive = tmp_path / "drive"
    ckpt, sidecar = _ckpt(local, "step60", 60, model)
    real_copy = shutil.copyfile
    calls = {"n": 0}

    def flaky(src, dst, *a, **kw):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError(5, "Input/output error")
        return real_copy(src, dst, *a, **kw)

    monkeypatch.setattr("training.mirror.shutil.copyfile", flaky)
    mirror = BackgroundMirror(drive, keep=2, max_retries=2, retry_delay_s=0.01)
    mirror.submit(ckpt, sidecar, step=60)
    assert mirror.flush(timeout=30)
    mirror.close()
    assert mirror.stats["copied"] == 1 and mirror.stats["failed"] == 0
    assert (drive / "latest.pt").exists()


def test_stale_partial_files_are_cleaned_at_startup(tmp_path):
    drive = tmp_path / "drive"
    drive.mkdir()
    (drive / ".latest.pt.partial").write_bytes(b"x" * 1024)
    mirror = BackgroundMirror(drive, keep=2)
    mirror.close()
    assert not list(drive.glob(".*.partial"))


def test_probe_reports_a_dead_mirror(tmp_path):
    ok, why = probe_dir(tmp_path / "drive")
    assert ok and why == "ok"
    blocked = tmp_path / "file-not-a-dir"
    blocked.write_text("x")
    ok2, why2 = probe_dir(blocked / "checkpoints")
    assert not ok2 and why2


def test_watchdog_shouts_when_nothing_is_reaching_drive(capsys):
    """The exact failure that cost session 3: training fine, persistence dead."""
    from training.pretrain import _watch_mirror

    class Stuck:
        def health(self, step=None):
            return {"copied": 0, "failed": 2, "retried": 2, "coalesced": 0,
                    "last_ok_step": -1, "last_ok_age_s": None,
                    "steps_behind": (step or 0), "busy": False, "pending": True,
                    "last_error": "OSError: [Errno 28] No space left on device"}

    cfg = {"save_every": 200, "mirror_max_lag_steps": 600, "mirror_max_age_s": 1800}
    _watch_mirror(Stuck(), 100, cfg)
    out = capsys.readouterr().out
    assert "MIRROR IS NOT KEEPING UP" in out
    assert "No space left" in out


def test_watchdog_stays_quiet_when_the_mirror_is_healthy(capsys):
    from training.pretrain import _watch_mirror

    class Fine:
        def health(self, step=None):
            return {"copied": 7, "failed": 0, "retried": 0, "coalesced": 1,
                    "last_ok_step": (step or 0) - 100, "last_ok_age_s": 42.0,
                    "steps_behind": 100, "busy": False, "pending": False,
                    "last_error": None}

    cfg = {"save_every": 200, "mirror_max_lag_steps": 600, "mirror_max_age_s": 1800}
    _watch_mirror(Fine(), 1600, cfg)
    assert capsys.readouterr().out == ""
