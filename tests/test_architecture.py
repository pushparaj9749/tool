import sys
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from model.architecture import AnkitLM                        # noqa: E402
from model.configuration import AnkitConfig                   # noqa: E402
from model.parameter_count import measure                     # noqa: E402

SMALL = dict(vocab_size=256, d_model=32, n_layers=2, n_heads=4, d_ff=64, max_seq_len=32)


def small_model():
    torch.manual_seed(0)
    return AnkitLM(AnkitConfig(name="test", **SMALL))


def test_forward_shapes():
    m = small_model()
    x = torch.randint(0, 256, (2, 16))
    out = m(x, return_logits=True)
    assert out.logits.shape == (2, 1, 256)


def test_loss_is_scalar_and_differentiable():
    m = small_model()
    x = torch.randint(0, 256, (2, 16))
    out = m(x, targets=x)
    assert out.loss.ndim == 0
    out.loss.backward()
    assert any(p.grad is not None for p in m.parameters())


def test_causality_no_future_leakage():
    """Changing a future token must not change earlier position logits."""
    m = small_model().eval()
    x = torch.randint(0, 256, (1, 12))
    logits_a = m(x, targets=x).logits
    y = x.clone()
    y[0, -1] = (y[0, -1] + 1) % 256
    logits_b = m(y, targets=y).logits
    assert torch.allclose(logits_a[:, :-1], logits_b[:, :-1], atol=1e-5)
    assert not torch.allclose(logits_a[:, -1], logits_b[:, -1], atol=1e-5)


def test_kv_cache_matches_full_forward():
    m = small_model().eval()
    x = torch.randint(0, 256, (1, 10))
    with torch.no_grad():
        full = m(x, targets=x).logits
        out = m(x[:, :8], cache=None, use_cache=True, return_logits=True)
        out2 = m(x[:, 8:], cache=out.cache, use_cache=True, return_logits=True)
    # the incremental call returns only the last position's logits.
    # tolerance is loose because SDPA may select a different kernel for a
    # 1-token query against a cache than for the full causal pass.
    assert torch.allclose(full[:, -1:, :], out2.logits, atol=2e-3)


def test_parameter_count_matches_analytic():
    cfg = AnkitConfig(name="test", **SMALL)
    m = AnkitLM(cfg)
    analytic = cfg.estimated_parameter_count()["total"]
    assert m.num_parameters() == analytic


def test_100m_target_is_measured_not_asserted():
    cfg = AnkitConfig.from_yaml(ROOT / "configs" / "model.yaml")
    result = measure(cfg)
    total = result["measured_trainable_parameters"]
    assert 90e6 < total < 110e6, f"100M target off: {total}"
    assert result["analytic_matches_measured"]


def test_tied_weights_counted_once():
    cfg = AnkitConfig(name="test", tie_word_embeddings=True, **SMALL)
    m = AnkitLM(cfg)
    assert m.tok_emb.weight is m.lm_head.weight
    assert m.num_parameters() == cfg.estimated_parameter_count()["total"]


def test_generate_respects_max_new_tokens():
    m = small_model()
    ids = torch.randint(0, 256, (1, 8))
    out, produced = m.generate(ids, max_new_tokens=5, temperature=0.0)
    assert len(produced) <= 5
    assert out.shape[1] <= 8 + 5


@pytest.mark.parametrize("shape", [(1, 1), (3, 8)])
def test_generate_with_cache_various_shapes(shape):
    m = small_model()
    ids = torch.randint(0, 256, shape)
    _, produced = m.generate(ids, max_new_tokens=3, temperature=0.0)
    assert len(produced) == 3
