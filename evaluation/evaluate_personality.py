"""Personality-mode evaluation: do the three modes actually differ, and does the
adaptive mode follow the user's register?

Measured signals (all observable, all reported with raw text):
  * mode separation: mean pairwise dissimilarity of responses across modes
  * formality markers per mode
  * length behaviour
  * adaptive-mode language matching on Hindi/English/Hinglish prompts
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import (  # noqa: E402
    formality_score, language_of, load_engine, save_report, word_overlap,
)

PROMPTS = {
    "en": [
        "Explain what a database is.",
        "I want to learn programming. Where should I start?",
    ],
    "hi": [
        "डेटाबेस क्या होता है? समझाइए।",
        "मुझे प्रोग्रामिंग सीखनी है, कहाँ से शुरू करूँ?",
    ],
    "hinglish": [
        "Database kya hota hai? Batao na.",
        "Mujhe programming seekhni hai, kahan se shuru karun?",
    ],
}

ADAPTIVE_EXPECTATION = {
    "en": "en",
    "hi": "hi",
    "hinglish": "hinglish",
}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    engine = load_engine(args.checkpoint, args.device)
    engine.gen_cfg.max_new_tokens = 64

    per_mode = {}
    responses_by_lang = {}
    for lang, prompts in PROMPTS.items():
        responses_by_lang[lang] = {}
        for mode in ("professional", "friendly", "adaptive"):
            rows = []
            for p in prompts:
                ans = engine.chat_once([{"role": "user", "content": p}], mode=mode)
                rows.append({
                    "prompt": p,
                    "response": ans,
                    "chars": len(ans),
                    "formality": formality_score(ans),
                    "detected_lang": language_of(ans),
                    "mode_match": language_of(ans) == ADAPTIVE_EXPECTATION[lang] if mode == "adaptive" else None,
                })
            per_mode.setdefault(mode, []).extend(rows)
            responses_by_lang[lang][mode] = rows

    # mode separation: 1 - mean word overlap between professional and friendly answers
    separations = []
    for lang, by_mode in responses_by_lang.items():
        for i, _ in enumerate(by_mode["professional"]):
            a = by_mode["professional"][i]["response"]
            b = by_mode["friendly"][i]["response"]
            separations.append(1 - word_overlap(a, b))

    summary = {}
    for mode, rows in per_mode.items():
        summary[mode] = {
            "responses": len(rows),
            "mean_chars": round(sum(r["chars"] for r in rows) / len(rows), 1),
            "mean_formality_ratio": round(
                sum(r["formality"]["formality_ratio"] for r in rows) / len(rows), 3),
            "mean_formal_markers": round(
                sum(r["formality"]["formal_markers"] for r in rows) / len(rows), 2),
            "mean_casual_markers": round(
                sum(r["formality"]["casual_markers"] for r in rows) / len(rows), 2),
        }

    adaptive_rows = per_mode["adaptive"]
    report = {
        "checkpoint": args.checkpoint,
        "summary": summary,
        "mode_separation_mean": round(sum(separations) / len(separations), 3) if separations else None,
        "adaptive_language_match_rate": round(
            sum(1 for r in adaptive_rows if r["mode_match"]) / len(adaptive_rows), 3),
        "raw": {lang: by_mode for lang, by_mode in responses_by_lang.items()},
        "note": (
            "Mode separation is a lexical-difference proxy. A trained model should show clear "
            "separation; an undertrained model typically shows little, and that is reported as-is."
        ),
    }
    save_report("eval_personality.json", report)
    print(json.dumps({"summary": summary,
                      "mode_separation_mean": report["mode_separation_mean"],
                      "adaptive_language_match_rate": report["adaptive_language_match_rate"]},
                     indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
