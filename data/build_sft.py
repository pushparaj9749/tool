"""Build the ANKIT instruction-tuning dataset.

Sources
  1. Project-authored seed conversations (data/sft/seed_conversations.py),
     replicated across the three personality modes by attaching the matching
     mode system prompt -> teaches the mode markers.
  2. HDRS Hindi dialogue corpus (MIT) -> real multi-turn Hindi conversation,
     used with a task system prompt (restaurant booking) so the model sees
     natural Hindi dialogue structure.

Output: data/sft/sft_train.jsonl, data/sft/sft_val.jsonl, data/sft/sft_stats.json
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "data" / "sft"))

from seed_conversations import SEED  # noqa: E402

MODES = ("professional", "friendly", "adaptive")
HDRS_SYSTEM = (
    "You are ANKIT, a restaurant booking assistant. Help the user find a restaurant, "
    "ask for missing details, and confirm the booking politely in Hindi."
)


def _hash(text: str) -> int:
    return int(hashlib.blake2b(text.encode(), digest_size=8).hexdigest(), 16)


def load_personalities(config_path: Path) -> dict:
    cfg = yaml.safe_load(open(config_path, encoding="utf-8"))
    return cfg["personalities"]


def seed_examples(personalities: dict) -> list[dict]:
    out = []
    for rec in SEED:
        turns = rec["turns"]
        for mode in MODES:
            messages = [{"role": "system", "content": personalities[mode]["system"]}]
            for user, assistant in turns:
                messages.append({"role": "user", "content": user})
                messages.append({"role": "assistant", "content": assistant})
            out.append({
                "messages": messages,
                "lang": rec["lang"],
                "topic": rec["topic"],
                "mode": mode,
                "source": "authored_seed",
            })
    return out


def hdrs_examples(raw_dir: Path, max_dialogues: int = 120) -> list[dict]:
    out = []
    base = raw_dir / "hdrs" / "HDRS_Corpus"
    if not base.exists():
        print(f"  [skip] HDRS not found at {base}")
        return out
    files = sorted(base.glob("final_*_hin.json"))
    for path in files:
        data = json.loads(path.read_text(encoding="utf-8"))
        for dialogue in data[:max_dialogues]:
            turns = dialogue.get("dialogue", [])
            messages = [{"role": "system", "content": HDRS_SYSTEM}]
            for turn in turns:
                user_text = (turn.get("transcript") or "").strip()
                asst_text = (turn.get("system_transcript") or "").strip()
                if not user_text or not asst_text:
                    continue
                messages.append({"role": "user", "content": user_text})
                messages.append({"role": "assistant", "content": asst_text})
            if len(messages) >= 5:            # system + at least 2 exchanges
                out.append({
                    "messages": messages,
                    "lang": "hi",
                    "topic": "restaurant_booking",
                    "mode": "neutral",
                    "source": "hdrs_hindi_dialogue",
                    "file": path.name,
                })
    return out


def main() -> None:
    out_dir = ROOT / "data" / "sft"
    out_dir.mkdir(parents=True, exist_ok=True)
    personalities = load_personalities(ROOT / "configs" / "generation.yaml")

    examples = seed_examples(personalities)
    n_seed = len(examples)
    hdrs = hdrs_examples(ROOT / "data" / "raw")
    examples.extend(hdrs)

    # dedupe on serialised messages+mode
    seen, unique = set(), []
    for ex in examples:
        key = hashlib.blake2b(
            (ex["mode"] + json.dumps(ex["messages"], ensure_ascii=False)).encode(), digest_size=16
        ).hexdigest()
        if key in seen:
            continue
        seen.add(key)
        unique.append(ex)

    train, val = [], []
    for ex in unique:
        bucket = _hash(ex["mode"] + json.dumps(ex["messages"], ensure_ascii=False)) % 100
        (val if bucket < 8 else train).append(ex)

    for name, rows in (("sft_train.jsonl", train), ("sft_val.jsonl", val)):
        with open(out_dir / name, "w", encoding="utf-8") as fh:
            for ex in rows:
                fh.write(json.dumps(ex, ensure_ascii=False) + "\n")

    stats = {
        "authored_seed_conversations": len(SEED),
        "authored_seed_examples_after_mode_replication": n_seed,
        "hdrs_dialogues_converted": len(hdrs),
        "unique_examples": len(unique),
        "train": len(train),
        "val": len(val),
        "by_source": {
            s: sum(1 for e in unique if e["source"] == s) for s in {e["source"] for e in unique}
        },
        "by_lang": {l: sum(1 for e in unique if e["lang"] == l) for l in {e["lang"] for e in unique}},
        "by_mode": {m: sum(1 for e in unique if e["mode"] == m) for m in {e["mode"] for e in unique}},
        "total_turns": sum(len(e["messages"]) for e in unique),
    }
    (out_dir / "sft_stats.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n",
                                            encoding="utf-8")
    print(json.dumps(stats, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
