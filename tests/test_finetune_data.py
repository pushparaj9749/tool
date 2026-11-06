"""SFT masking tests — catches off-by-one errors between targets and loss mask."""
import json
import random
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tokenizer.ankit_tokenizer import AnkitTokenizer            # noqa: E402
from training.finetune import SFTDataset                         # noqa: E402

TOK_DIR = ROOT / "tokenizer" / "ankit_bpe"


@pytest.fixture(scope="module")
def tok():
    if not (TOK_DIR / "tokenizer.json").exists():
        pytest.skip("tokenizer not trained")
    return AnkitTokenizer.load(TOK_DIR)


def make_dataset(tmp_path, tok, conversations, seq_len=128):
    path = tmp_path / "sft.jsonl"
    with open(path, "w", encoding="utf-8") as fh:
        for conv in conversations:
            fh.write(json.dumps({"messages": conv, "lang": "en", "mode": "adaptive"}) + "\n")
    return SFTDataset(path, tok, seq_len)


def test_supervised_positions_are_assistant_tokens(tmp_path, tok):
    conv = [
        {"role": "system", "content": "You are ANKIT."},
        {"role": "user", "content": "Hello there"},
        {"role": "assistant", "content": "Hi, how can I help you today?"},
    ]
    ds = make_dataset(tmp_path, tok, [conv])
    x, y, m = ds.batch(1, [0], tok.pad_id, "cpu", random.Random(0))

    supervised_ids = y[0][m[0]].tolist()
    text = tok.decode([i for i in supervised_ids if i >= 0])
    assert "how can I help" in text
    # the user prompt must not be supervised
    assert "Hello there" not in text


def test_prompt_tokens_have_no_targets(tmp_path, tok):
    conv = [
        {"role": "user", "content": "What is 2 + 2?"},
        {"role": "assistant", "content": "4"},
    ]
    ds = make_dataset(tmp_path, tok, [conv])
    x, y, m = ds.batch(1, [0], tok.pad_id, "cpu", random.Random(0))
    assert (y[0][~m[0]] == -100).all()
    # every supervised position must have a real target token
    assert (y[0][m[0]] >= 0).all()


def test_shapes_and_padding(tmp_path, tok):
    convs = [
        [{"role": "user", "content": "hi"}, {"role": "assistant", "content": "hello"}],
        [{"role": "user", "content": "a longer question about databases and indexes please"},
         {"role": "assistant", "content": "Short answer."}],
    ]
    ds = make_dataset(tmp_path, tok, convs)
    x, y, m = ds.batch(2, [0, 1], tok.pad_id, "cpu", random.Random(0))
    assert x.shape == y.shape == m.shape
    assert x.shape[0] == 2


def test_skips_examples_without_assistant(tmp_path, tok):
    with pytest.raises(ValueError):
        make_dataset(tmp_path, tok, [[{"role": "user", "content": "no answer"}]])
