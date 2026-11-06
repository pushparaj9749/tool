"""Side-by-side generation comparison across checkpoints (same prompts, same seeds).

Used to show the *actual* effect of more pretraining, not a claim about it.

  python evaluation/compare_checkpoints.py \
      --checkpoints checkpoints/pretrain-100m/final.pt checkpoints/pretrain-100m-main/final.pt
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import save_report  # noqa: E402
from inference.conversation import ChatEngine  # noqa: E402

PROMPTS = [
    "Hello ANKIT, who are you?",
    "नमस्ते अंकित, तुम कौन हो?",
    "Bhai, tokenizer kya hota hai?",
    "What is 15 percent of 240?",
    "Python में फ़ाइल कैसे पढ़ें?",
]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoints", nargs="+", required=True)
    ap.add_argument("--max-new-tokens", type=int, default=40)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    results = {}
    for ckpt in args.checkpoints:
        engine = ChatEngine.from_checkpoint(ckpt, device=args.device)
        engine.gen_cfg.max_new_tokens = args.max_new_tokens
        engine.gen_cfg.seed = 1234                     # same seed for every checkpoint
        rows = []
        for p in PROMPTS:
            rows.append({"prompt": p,
                         "response": engine.chat_once([{"role": "user", "content": p}],
                                                      mode="adaptive")})
        results[ckpt] = rows
        del engine

    lines = ["# Checkpoint comparison — identical prompts, identical seed", "",
             f"max_new_tokens={args.max_new_tokens}, decoding: temperature 0.7 / top_p 0.9 / "
             "rep-penalty 1.3, mode `adaptive`. Raw output, unedited.", ""]
    for i, prompt in enumerate(PROMPTS):
        lines += [f"## {prompt}", ""]
        for ckpt, rows in results.items():
            lines += [f"- `{ckpt}`: {rows[i]['response']}", ""]

    out = ROOT / "reports" / "checkpoint_comparison.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    save_report("checkpoint_comparison.json", {"max_new_tokens": args.max_new_tokens,
                                              "results": results})
    print(f"[report] {out}")


if __name__ == "__main__":
    main()
