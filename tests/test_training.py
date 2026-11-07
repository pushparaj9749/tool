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


def test_plan_epochs_is_honest_about_corpus_reuse(tmp_path):
    """A 2B-token target over a 24.1M-token corpus would be ~83 epochs of the same text."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.colab_autopilot import plan_epochs

    shard = tmp_path / "train.bin"
    shard.write_bytes(b"\0\0" * 24_100_344)          # uint16 shards
    plan = plan_epochs(shard, 8192, 64000)
    assert plan["steps_per_epoch"] == 2941           # 24.1M / 8192
    assert 21.5 <= plan["epochs"] <= 22.0
    assert plan["total_tokens"] == 64000 * 8192
    assert plan_epochs(shard, 8192, 244141)["epochs"] > 80
    missing = plan_epochs(tmp_path / "nope.bin", 8192, 100)
    assert missing["train_tokens"] == 0 and missing["epochs"] is None


def test_artifact_cache_round_trip(tmp_path):
    """A fresh VM must get the 50 MB of built data from Drive, not rebuild it (~15 min)."""
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.colab_autopilot import ARTIFACT_FILES, cache_artifacts, restore_artifacts

    root = tmp_path / "vm1"
    for rel in ARTIFACT_FILES:
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x01" * 1024)
    cache = tmp_path / "drive/artifacts"

    assert cache_artifacts(cache=cache, root=root) == len(ARTIFACT_FILES)
    assert (cache / "manifest.json").exists()
    # second run: nothing to do
    assert cache_artifacts(cache=cache, root=root) == 0

    fresh = tmp_path / "vm2"                       # empty: a new Colab VM
    restored = restore_artifacts(cache=cache, root=fresh)
    assert len(restored) == len(ARTIFACT_FILES)
    for rel in ARTIFACT_FILES:
        assert (fresh / rel).read_bytes() == b"\x01" * 1024
    assert not list(fresh.rglob("*.partial"))


def test_artifact_cache_rejects_a_short_file(tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.colab_autopilot import ARTIFACT_FILES, cache_artifacts, restore_artifacts

    root = tmp_path / "vm1"
    for rel in ARTIFACT_FILES:
        f = root / rel
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x02" * 512)
    cache = tmp_path / "drive/artifacts"
    cache_artifacts(cache=cache, root=root)
    (cache / ARTIFACT_FILES[1]).write_bytes(b"\x02" * 10)      # truncated on Drive
    assert restore_artifacts(cache=cache, root=tmp_path / "vm2") == []


def test_restore_without_cache_is_a_no_op(tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.colab_autopilot import restore_artifacts
    assert restore_artifacts(cache=tmp_path / "nothing", root=tmp_path / "vm") == []


def test_build_stamp_identifies_the_running_code():
    """Every run must leave proof of *which* build produced its checkpoints.

    The 2026-11-06 session ran an older checkout (step-tagged mirror, no
    `latest.pt`) and nothing on Drive could say so; this stamp makes it a fact.
    """
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from scripts.colab_autopilot import BUILD_MARKERS, build_stamp

    stamp = build_stamp()
    assert "sha" in stamp and "markers" in stamp
    # every durability fix listed must be present in *this* checkout
    missing = [k for k, ok in stamp["markers"].items() if not ok]
    assert not missing, f"checkout is missing safety markers: {missing}"
    assert len(stamp["markers"]) == len(BUILD_MARKERS)
