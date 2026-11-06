import sys
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model.architecture import AnkitLM                                    # noqa: E402
from model.configuration import AnkitConfig                               # noqa: E402
from training.checkpoint import (                                          # noqa: E402
    list_checkpoints, load_checkpoint, prune_checkpoints, resolve_resume,
    save_checkpoint, verify_checkpoint,
)

CFG = AnkitConfig(name="ckpt-test", vocab_size=128, d_model=32, n_layers=1, n_heads=4,
                  d_ff=64, max_seq_len=16)
RUN_CFG = {"learning_rate": 1e-3, "batch_size": 1}


@pytest.fixture()
def model():
    torch.manual_seed(0)
    return AnkitLM(CFG)


def test_save_and_load_roundtrip(tmp_path, model):
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    path = save_checkpoint(tmp_path, "step1", model, opt, 1, 512, CFG, RUN_CFG)
    assert path.exists()
    payload = load_checkpoint(path, with_optimizer=False)
    assert payload["step"] == 1 and payload["tokens_seen"] == 512
    restored = AnkitLM(AnkitConfig.from_dict(payload["model_config"]))
    restored.load_state_dict(payload["model"])
    for a, b in zip(model.parameters(), restored.parameters()):
        assert torch.equal(a, b)


def test_integrity_detection(tmp_path, model):
    path = save_checkpoint(tmp_path, "step1", model, None, 1, 100, CFG, RUN_CFG)
    meta = list_checkpoints(tmp_path)[0]
    assert verify_checkpoint(meta)
    with open(path, "ab") as fh:          # corrupt the file
        fh.write(b"corruption")
    assert not verify_checkpoint(meta)
    with pytest.raises(RuntimeError):
        load_checkpoint(path)


def test_latest_pointer_and_resume(tmp_path, model):
    save_checkpoint(tmp_path, "step1", model, None, 1, 100, CFG, RUN_CFG)
    save_checkpoint(tmp_path, "step2", model, None, 2, 200, CFG, RUN_CFG)
    assert resolve_resume(tmp_path).name == "step2.pt"
    assert resolve_resume(tmp_path, "none") is None


def test_prune_keeps_newest(tmp_path, model):
    for i in range(1, 5):
        save_checkpoint(tmp_path, f"step{i}", model, None, i, i * 100, CFG, RUN_CFG)
    prune_checkpoints(tmp_path, keep_last=2)
    tags = [m["tag"] for m in list_checkpoints(tmp_path)]
    assert len(tags) == 2 and "step4" in tags


def test_resume_restores_optimizer_state(tmp_path, model):
    opt = torch.optim.AdamW(model.parameters(), lr=1e-3)
    x = torch.randint(0, 128, (1, 8))
    model(x, targets=x).loss.backward()
    opt.step()
    path = save_checkpoint(tmp_path, "step1", model, opt, 1, 100, CFG, RUN_CFG)
    payload = load_checkpoint(path)
    opt2 = torch.optim.AdamW(model.parameters(), lr=1e-3)
    opt2.load_state_dict(payload["optimizer"])
    assert opt2.state_dict()["state"]
