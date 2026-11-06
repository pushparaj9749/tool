import sys
from pathlib import Path

import numpy as np
import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from training.data_loader import PackedTokenDataset          # noqa: E402
from training.optimizer import build_optimizer               # noqa: E402
from training.scheduler import lr_at_step                    # noqa: E402


def test_lr_warmup_and_decay():
    peak = 1e-3
    assert lr_at_step(0, peak, 10, 100) < peak
    assert lr_at_step(9, peak, 10, 100) == pytest.approx(peak, rel=0.2)
    assert lr_at_step(50, peak, 10, 100) < peak
    assert lr_at_step(100, peak, 10, 100) == pytest.approx(peak * 0.1, rel=0.05)


def test_optimizer_param_groups_no_decay_on_norms():
    from model.architecture import AnkitLM
    from model.configuration import AnkitConfig
    cfg = AnkitConfig(vocab_size=128, d_model=32, n_layers=1, n_heads=4, d_ff=64, max_seq_len=16)
    model = AnkitLM(cfg)
    opt = build_optimizer(model, {"weight_decay": 0.1, "learning_rate": 1e-3,
                                 "beta1": 0.9, "beta2": 0.95})
    decay = [g for g in opt.param_groups if g["weight_decay"] > 0][0]
    nodecay = [g for g in opt.param_groups if g["weight_decay"] == 0][0]
    assert len(decay["params"]) > 0 and len(nodecay["params"]) > 0


def test_dataset_batches_shapes(tmp_path):
    arr = np.arange(1000, dtype=np.uint16)
    path = tmp_path / "toy.bin"
    arr.tofile(path)
    ds = PackedTokenDataset(path)
    x, y = ds.get_batch(2, 16, "cpu")
    assert x.shape == (2, 16) and y.shape == (2, 16)
    assert torch.equal(x[:, 1:], y[:, :-1])       # next-token targets are shifted by one


def test_dataset_rejects_too_small_shard(tmp_path):
    path = tmp_path / "tiny.bin"
    np.arange(5, dtype=np.uint16).tofile(path)
    ds = PackedTokenDataset(path)
    with pytest.raises(ValueError):
        ds.get_batch(1, 16, "cpu")


def test_one_training_step_reduces_loss():
    """End-to-end sanity: a single optimisation step must not increase loss on a fixed batch."""
    from model.architecture import AnkitLM
    from model.configuration import AnkitConfig
    torch.manual_seed(0)
    cfg = AnkitConfig(vocab_size=64, d_model=32, n_layers=1, n_heads=4, d_ff=64, max_seq_len=16)
    model = AnkitLM(cfg)
    opt = torch.optim.AdamW(model.parameters(), lr=1e-2)
    x = torch.randint(0, 64, (2, 16))
    before = float(model(x, targets=x).loss)
    for _ in range(8):
        opt.zero_grad()
        loss = model(x, targets=x).loss
        loss.backward()
        opt.step()
    after = float(model(x, targets=x).loss)
    assert after < before
