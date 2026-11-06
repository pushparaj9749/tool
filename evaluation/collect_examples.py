"""Collect real chat transcripts from the trained checkpoint into reports/chat_examples.md.

Every transcript here is raw model output — nothing edited or cherry-picked silently.
The prompt set is fixed in this file so it can be re-run for comparison.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import load_engine, save_report  # noqa: E402

PROMPTS = [
    ("adaptive", "Hello ANKIT, who are you?"),
    ("adaptive", "नमस्ते अंकित, तुम कौन हो?"),
    ("adaptive", "Bhai, tokenizer kya hota hai?"),
    ("professional", "Explain what a database is."),
    ("friendly", "I finally finished my project!"),
    ("professional", "दो दिन की छुट्टी के लिए आवेदन लिखो।"),
    ("adaptive", "What is 15 percent of 240?"),
    ("adaptive", "Python में फ़ाइल कैसे पढ़ें?"),
]

MULTITURN = {
    "mode": "adaptive",
    "turns": [
        "My name is Rahul and I am preparing for GATE.",
        "Which subject should I start with?",
        "What is my name?",
    ],
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--max-new-tokens", type=int, default=48)
    args = ap.parse_args()

    engine = load_engine(args.checkpoint, args.device)
    engine.gen_cfg.max_new_tokens = args.max_new_tokens

    rows = []
    for mode, prompt in PROMPTS:
        rows.append({"mode": mode, "prompt": prompt,
                     "response": engine.chat_once([{"role": "user", "content": prompt}], mode=mode)})

    conv = engine.new_conversation(MULTITURN["mode"])
    turns = []
    for user in MULTITURN["turns"]:
        turns.append({"user": user, "assistant": engine.reply(conv, user)})

    lines = ["# ANKIT LLM v0.1 — raw chat transcripts", "",
             f"Checkpoint: `{args.checkpoint}`, decoding: temperature "
             f"{engine.gen_cfg.temperature}, top_k {engine.gen_cfg.top_k}, "
             f"top_p {engine.gen_cfg.top_p}, max_new_tokens {args.max_new_tokens}.", "",
             "> These are **verbatim** outputs of an undertrained CPU-trained model. "
             "They are included to demonstrate that the pipeline produces language, not to "
             "claim quality. See LIMITATIONS.md.", "",
             "## Single turn", ""]
    for row in rows:
        lines += [f"**[{row['mode']}] user:** {row['prompt']}", "",
                  f"**ankit:** {row['response']}", ""]
    lines += ["## Multi-turn (context probe)", ""]
    for t in turns:
        lines += [f"**user:** {t['user']}", "", f"**ankit:** {t['assistant']}", ""]

    out = ROOT / "reports" / "chat_examples.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    save_report("chat_examples.json", {"checkpoint": args.checkpoint, "single_turn": rows,
                                      "multi_turn": turns})
    print(f"[report] {out}")


if __name__ == "__main__":
    main()
