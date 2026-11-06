"""Standalone tokenizer checks (run: python tokenizer/tokenizer_tests.py)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tokenizer.ankit_tokenizer import AnkitTokenizer  # noqa: E402

SAMPLES = [
    "Hello ANKIT, how are you?",
    "नमस्ते अंकित, आप कैसे हैं?",
    "Bhai, kal ka plan kya hai? Mujhe 5 baje free hai.",
    "मैं Python सीख रहा हूँ, aur mujhe ML में interest hai.",
    "Numbers: 1234567890. Symbols: !@#$%^&*()_+-=[]{}|;:'\",.<>/?",
    "Emoji test 🙂 🚀 🇮🇳 and combining marks: क्ष त्र ज्ञ",
    "  multiple   spaces\tand\ttabs\nand newlines  ",
]


def main() -> int:
    tok = AnkitTokenizer.load("tokenizer/ankit_bpe")
    failures = 0
    print(f"vocab_size={tok.vocab_size} specials={tok.special_token_ids()}\n")
    for s in SAMPLES:
        ids = tok.encode(s, add_special_tokens=False)
        back = tok.decode(ids)
        ok = back == s
        failures += int(not ok)
        # unknown-token check: byte-level BPE must never emit <unk>
        unk_hits = ids.count(tok.special_token_ids()["<unk>"])
        failures += int(unk_hits > 0)
        print(f"[{'PASS' if ok and unk_hits == 0 else 'FAIL'}] chars={len(s):3d} tokens={len(ids):3d} "
              f"unk={unk_hits} roundtrip={back == s}")
        if not ok:
            print("  expected:", repr(s))
            print("  got     :", repr(back))
    # chat template round trip
    msgs = [
        {"role": "system", "content": "You are ANKIT."},
        {"role": "user", "content": "नमस्ते"},
        {"role": "assistant", "content": "नमस्ते! कैसे मदद करूँ?"},
    ]
    ids, mask = tok.encode_supervised(msgs)
    assert len(ids) == len(mask), "mask length mismatch"
    assert sum(mask) > 0 and sum(mask) < len(mask), "mask must be partial"
    print(f"\n[PASS] chat encoding: {len(ids)} tokens, {sum(mask)} supervised assistant tokens")
    print(f"[{'PASS' if failures == 0 else 'FAIL'}] total failures={failures}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
