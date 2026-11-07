"""The "try the model right now" path must work without a GPU and without Drive.

`notebooks/TRY_MODEL.py` is what the user runs to see what the checkpoint has learned. If it
can only be tested on a T4, it will rot; these tests run it on a tiny CPU checkpoint.
"""
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
TRAIN_BIN = ROOT / "data/_selftest/processed/pretrain_train.bin"
CKPT_DIR = ROOT / "checkpoints/_tryout_test"
REPORT = ROOT / "reports/_tryout_test.md"


@pytest.fixture(scope="module")
def tiny_checkpoint():
    if not TRAIN_BIN.exists():
        from scripts.colab_autopilot import _synthetic_artifacts
        _synthetic_artifacts()
    if not TRAIN_BIN.exists():
        pytest.skip("could not build synthetic shards")
    shutil.rmtree(CKPT_DIR, ignore_errors=True)
    cfg = yaml.safe_load((ROOT / "configs/pretraining_nano.yaml").read_text(encoding="utf-8"))
    cfg.update({
        "model_config": "configs/_selftest_model.yaml",
        "tokenizer_dir": "data/_selftest/tok",
        "data_dir": "data/_selftest/processed",
        "train_bin": "data/_selftest/processed/pretrain_train.bin",
        "val_bin": "data/_selftest/processed/pretrain_val.bin",
        "dtype": "fp32", "device": "cpu", "seq_len": 64, "batch_size": 2,
        "grad_accum_steps": 1, "max_steps": 5, "warmup_steps": 1, "eval_every": 0,
        "save_every": 5, "log_every": 1, "keep_last_checkpoints": 1,
        "checkpoint_dir": str(CKPT_DIR), "log_dir": "logs",
        "run_name": "tryout-test", "storage_min_free_gb": 0.1,
    })
    path = ROOT / "configs/_tryout_test.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    r = subprocess.run([sys.executable, "training/pretrain.py", "--config",
                        "configs/_tryout_test.yaml", "--run-id", "tryout1"],
                       cwd=ROOT, text=True, capture_output=True)
    assert r.returncode == 0, (r.stdout + r.stderr)[-2000:]
    yield CKPT_DIR / "step5.pt"
    shutil.rmtree(CKPT_DIR, ignore_errors=True)
    path.unlink(missing_ok=True)
    REPORT.unlink(missing_ok=True)
    for f in (ROOT / "logs").glob("tryout-test-*"):
        f.unlink(missing_ok=True)


def test_tryout_generates_and_writes_a_report(tiny_checkpoint):
    r = subprocess.run(
        [sys.executable, "notebooks/TRY_MODEL.py",
         "--checkpoint", str(tiny_checkpoint),
         "--tokenizer-dir", "data/_selftest/tok",
         "--device", "cpu", "--max-new-tokens", "8",
         "--temperatures", "0.8", "--prompts", "1",
         "--out", "reports/_tryout_test.md"],
        cwd=ROOT, text=True, capture_output=True)
    assert r.returncode == 0, (r.stdout + r.stderr)[-3000:]
    assert REPORT.exists()
    text = REPORT.read_text(encoding="utf-8")
    assert "# ANKIT LLM tryout" in text
    assert "step **5**" in text
    assert "## Completions" in text
    # the model is untrained here, so only check that *something* came back
    assert "generation failed" not in text, text[-2000:]
    assert "**temp 0.8:**" in text


def test_tryout_chat_mode_runs(tiny_checkpoint):
    r = subprocess.run(
        [sys.executable, "notebooks/TRY_MODEL.py",
         "--checkpoint", str(tiny_checkpoint),
         "--tokenizer-dir", "data/_selftest/tok",
         "--device", "cpu", "--max-new-tokens", "6",
         "--temperatures", "0.8", "--prompts", "1", "--chat",
         "--out", "reports/_tryout_test.md"],
        cwd=ROOT, text=True, capture_output=True)
    assert r.returncode == 0, (r.stdout + r.stderr)[-3000:]
    text = REPORT.read_text(encoding="utf-8")
    assert "## Chat-style" in text
    assert "chat failed" not in text, text[-2000:]


def test_tryout_says_so_when_the_checkpoint_is_missing():
    r = subprocess.run(
        [sys.executable, "notebooks/TRY_MODEL.py",
         "--checkpoint", "checkpoints/does-not-exist.pt", "--device", "cpu"],
        cwd=ROOT, text=True, capture_output=True)
    assert r.returncode != 0
    assert "checkpoint nahi mila" in (r.stdout + r.stderr)
