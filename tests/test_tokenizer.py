import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tokenizer.ankit_tokenizer import AnkitTokenizer  # noqa: E402

TOK_DIR = ROOT / "tokenizer" / "ankit_bpe"


@pytest.fixture(scope="module")
def tok():
    if not (TOK_DIR / "tokenizer.json").exists():
        pytest.skip("tokenizer not trained yet")
    return AnkitTokenizer.load(TOK_DIR)


def test_vocab_size_matches_config(tok):
    assert tok.vocab_size == 32768


def test_special_tokens_present(tok):
    for t in ("<pad>", "<unk>", "<bos>", "<eos>", "<|system|>", "<|user|>", "<|assistant|>", "<|end|>"):
        assert tok.id(t) >= 0


@pytest.mark.parametrize("text", [
    "Hello ANKIT",
    "नमस्ते अंकित, आप कैसे हैं?",
    "Bhai kal ka plan kya hai?",
    "Mixed: मैं Python सीख रहा हूँ।",
    "🙂 🚀 क्ष त्र ज्ञ",
])
def test_roundtrip(tok, text):
    ids = tok.encode(text, add_special_tokens=False)
    assert tok.decode(ids) == text


def test_no_unknown_tokens_for_unseen_unicode(tok):
    weird = "ᐊᓕᒐᔅ ẞ ﬄ 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 \u0301"
    ids = tok.encode(weird, add_special_tokens=False)
    assert tok.special_token_ids()["<unk>"] not in ids


def test_chat_template_tokens(tok):
    msgs = [{"role": "system", "content": "s"},
            {"role": "user", "content": "u"},
            {"role": "assistant", "content": "a"}]
    ids = tok.encode_chat(msgs, add_generation_prompt=True)
    for special in ("<|system|>", "<|user|>", "<|assistant|>"):
        assert tok.id(special) in ids
    assert ids[-1] == tok.assistant_id


def test_supervised_mask_only_on_assistant(tok):
    msgs = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi there"}]
    ids, mask = tok.encode_supervised(msgs)
    assert len(ids) == len(mask)
    assert mask[0] == 0
    text_before = tok.decode(ids[: mask.index(1)])
    assert "Hello" in text_before


def test_devanagari_compression_is_reasonable(tok):
    text = "मैं हिंदी में बात कर सकता हूँ और अंग्रेज़ी में भी।"
    ids = tok.encode(text, add_special_tokens=False)
    assert len(ids) < len(text.encode("utf-8")) * 0.6
