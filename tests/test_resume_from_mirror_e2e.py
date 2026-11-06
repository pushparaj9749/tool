"""Regression test for the incident: a fresh VM must resume from the Drive mirror.

Story: the first real T4 long run mirrored checkpoints synchronously, Drive fell far
behind the GPU, the runtime was stopped, and most of the session was gone. This test
reproduces the *recovery* half: train into a mirror, delete the whole local checkpoint
directory (what a stopped Colab VM does), then resume and prove it continues from the
mirrored step instead of restarting at 0.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TRAIN_BIN = ROOT / "data/_selftest/processed/pretrain_train.bin"


@pytest.fixture(scope="module")
def tiny_artifacts():
    """Tiny tokenizer + shards, built once the same way --self-test builds them."""
    if not TRAIN_BIN.exists():
        from scripts.colab_autopilot import _synthetic_artifacts
        _synthetic_artifacts()
    if not TRAIN_BIN.exists():
        pytest.skip("could not build synthetic shards")
    return ROOT / "configs/_selftest_model.yaml", ROOT / "data/_selftest/tok"


def _run(ckpt_dir: Path, mirror_dir: Path, run_id: str) -> tuple[int, str]:
    cfg = yaml.safe_load((ROOT / "configs/pretraining_nano.yaml").read_text(encoding="utf-8"))
    cfg.update({
        "model_config": "configs/_selftest_model.yaml",
        "tokenizer_dir": "data/_selftest/tok",
        "data_dir": "data/_selftest/processed",
        "train_bin": "data/_selftest/processed/pretrain_train.bin",
        "val_bin": "data/_selftest/processed/pretrain_val.bin",
        "dtype": "fp32", "device": "cpu", "seq_len": 64, "batch_size": 2,
        "grad_accum_steps": 1, "max_steps": 5, "warmup_steps": 1, "eval_every": 5,
        "save_every": 5, "log_every": 1, "keep_last_checkpoints": 2,
        "checkpoint_dir": str(ckpt_dir), "log_dir": "logs", "run_name": "mirror-e2e",
        "mirror_dir": str(mirror_dir), "mirror_keep": 2, "storage_min_free_gb": 0.1,
    })
    path = ROOT / "configs/_mirror_e2e.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    r = subprocess.run([sys.executable, "training/pretrain.py", "--config",
                        "configs/_mirror_e2e.yaml", "--run-id", run_id],
                       cwd=ROOT, text=True, capture_output=True)
    return r.returncode, r.stdout + r.stderr


def test_fresh_session_resumes_from_the_mirror(tmp_path, tiny_artifacts):
    ckpt_dir = ROOT / "checkpoints/_mirror_e2e"
    mirror = tmp_path / "drive" / "checkpoints" / "t4-full"
    mirror.mkdir(parents=True)
    shutil.rmtree(ckpt_dir, ignore_errors=True)

    rc1, out1 = _run(ckpt_dir, mirror, "sess1")
    assert rc1 == 0, out1[-2000:]
    assert (mirror / "latest.json").exists(), "no pointer on the mirror"
    assert list(mirror.glob("*.pt")), "nothing was mirrored"

    # a stopped Colab runtime loses its local disk
    shutil.rmtree(ckpt_dir)

    rc2, out2 = _run(ckpt_dir, mirror, "sess2")
    assert rc2 == 0, out2[-2000:]
    assert "restored" in out2, out2[-1500:]
    assert "resumed from" in out2 and "at step 5" in out2, out2[-1500:]

    shutil.rmtree(ckpt_dir, ignore_errors=True)
    (ROOT / "configs/_mirror_e2e.yaml").unlink(missing_ok=True)
    for f in (ROOT / "logs").glob("mirror-e2e-*"):
        f.unlink(missing_ok=True)
