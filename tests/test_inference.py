import sys
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from inference.conversation import ChatEngine, Conversation                # noqa: E402
from inference.generate import GenerationConfig, Generator                 # noqa: E402
from model.architecture import AnkitLM                                     # noqa: E402
from model.configuration import AnkitConfig                                # noqa: E402
from tokenizer.ankit_tokenizer import AnkitTokenizer                       # noqa: E402

TOK_DIR = ROOT / "tokenizer" / "ankit_bpe"


@pytest.fixture(scope="module")
def tok():
    if not (TOK_DIR / "tokenizer.json").exists():
        pytest.skip("tokenizer not trained")
    return AnkitTokenizer.load(TOK_DIR)


@pytest.fixture(scope="module")
def tiny(tok):
    torch.manual_seed(0)
    cfg = AnkitConfig(name="tiny", vocab_size=tok.vocab_size, d_model=64, n_layers=2,
                      n_heads=4, d_ff=128, max_seq_len=64)
    m = AnkitLM(cfg).eval()
    for p in m.parameters():
        torch.nn.init.normal_(p, 0, 0.02)
    return m


PERSONALITIES = {
    "professional": {"marker": "[MODE:PROFESSIONAL]", "system": "You are ANKIT. Be formal."},
    "friendly": {"marker": "[MODE:FRIENDLY]", "system": "You are ANKIT. Be casual."},
    "adaptive": {"marker": "[MODE:ADAPTIVE]", "system": "You are ANKIT. Adapt."},
}


def make_engine(tiny, tok):
    return ChatEngine(tiny, tok, GenerationConfig(max_new_tokens=8, temperature=0.0, top_k=0,
                                                  top_p=0.0, repetition_penalty=1.0),
                      personalities=PERSONALITIES, max_context_tokens=48, reserve_for_generation=16)


def test_stream_yields_tokens(tiny, tok):
    gen = Generator(tiny, tok, GenerationConfig(max_new_tokens=5, temperature=0.0))
    ids = tok.encode("Hello", add_special_tokens=False)
    produced = list(gen.stream_ids(ids))
    assert 1 <= len(produced) <= 5


def test_generation_stops_on_max_tokens(tiny, tok):
    gen = Generator(tiny, tok, GenerationConfig(max_new_tokens=4, temperature=0.0))
    assert len(list(gen.stream_ids(tok.encode("Hi", add_special_tokens=False)))) <= 4


def test_personality_prompt_contains_marker(tiny, tok):
    eng = make_engine(tiny, tok)
    for mode, entry in PERSONALITIES.items():
        prompt = eng.personality_prompt(mode)
        assert entry["marker"] in prompt and entry["system"] in prompt


def test_invalid_personality_rejected(tiny, tok):
    eng = make_engine(tiny, tok)
    with pytest.raises(ValueError):
        eng.personality_prompt("sarcastic")


def test_refuses_mid_conversation_mode_switch(tiny, tok):
    eng = make_engine(tiny, tok)
    conv = eng.new_conversation("friendly")
    eng.reply(conv, "hello")
    with pytest.raises(ValueError):
        eng.reply(conv, "hello again", mode="professional")


def test_context_window_is_enforced(tiny, tok):
    eng = make_engine(tiny, tok)
    conv = eng.new_conversation("adaptive")
    for i in range(20):
        eng.reply(conv, f"message number {i} with several extra words to consume the budget")
    assert len(tok.encode_chat(conv.to_messages(), add_generation_prompt=True)) <= eng._budget()
    assert conv.dropped_turns > 0


def test_chat_once_requires_user_last(tiny, tok):
    eng = make_engine(tiny, tok)
    with pytest.raises(ValueError):
        eng.chat_once([{"role": "assistant", "content": "hi"}])
