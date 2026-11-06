"""Multilingual evaluation for Hindi / English / Hinglish / romanised Hindi.

Measures *observable* behaviour: script of the response, language-consistency
(does a Hindi question get a Devanagari answer?), and response statistics. It
does not claim comprehension quality — raw generations are included.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import DEVANAGARI, LATIN, language_of, load_engine, save_report  # noqa: E402

PROBES = [
    {"id": "hi_devanagari_1", "lang": "hi", "prompt": "भारत की राजधानी क्या है? हिंदी में उत्तर दो।"},
    {"id": "hi_devanagari_2", "lang": "hi", "prompt": "मुझे एक अच्छी किताब सुझाओ।"},
    {"id": "hi_devanagari_3", "lang": "hi", "prompt": "कृपया समझाइए कि कंप्यूटर कैसे काम करता है।"},
    {"id": "en_1", "lang": "en", "prompt": "What is the capital of India? Answer in English."},
    {"id": "en_2", "lang": "en", "prompt": "Suggest a good book for a beginner."},
    {"id": "en_3", "lang": "en", "prompt": "Explain how a computer works, briefly."},
    {"id": "hinglish_1", "lang": "hinglish", "prompt": "Bhai, mujhe ek acchi book suggest karo na."},
    {"id": "hinglish_2", "lang": "hinglish", "prompt": "Yaar, computer kaise kaam karta hai, simple mein batao."},
    {"id": "roman_hindi_1", "lang": "roman_hi", "prompt": "Mera naam Aman hai. Mujhe padhai mein mann nahi lagta, kya karun?"},
]

SWITCH_PROBE = {
    "id": "language_switch",
    "turns": [
        "Hello, what is Python? Answer in English.",
        "अब हिंदी में बताओ, Python क्या है?",
        "Ab Hinglish mein batao yaar.",
    ],
}


def script_mix(text: str) -> dict:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return {"devanagari": 0.0, "latin": 0.0}
    return {
        "devanagari": round(sum(1 for c in letters if DEVANAGARI.match(c)) / len(letters), 3),
        "latin": round(sum(1 for c in letters if LATIN.match(c)) / len(letters), 3),
    }


def consistency(expected_lang: str, answer: str) -> bool:
    got = language_of(answer)
    if expected_lang == "hi":
        return got in ("hi", "mixed")
    if expected_lang == "en":
        return got in ("en",)
    if expected_lang in ("hinglish", "roman_hi"):
        return got in ("hinglish", "en")     # romanised Hindi can look like English
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    engine = load_engine(args.checkpoint, args.device)
    engine.gen_cfg.max_new_tokens = 64

    rows = []
    for probe in PROBES:
        answer = engine.chat_once([{"role": "user", "content": probe["prompt"]}], mode="adaptive")
        rows.append({
            "id": probe["id"],
            "expected_lang": probe["lang"],
            "prompt": probe["prompt"],
            "response": answer,
            "detected_lang": language_of(answer),
            "script": script_mix(answer),
            "language_consistent": consistency(probe["lang"], answer),
            "chars": len(answer),
        })

    conv = engine.new_conversation("adaptive")
    switch_turns = []
    for user in SWITCH_PROBE["turns"]:
        answer = engine.reply(conv, user)
        switch_turns.append({"user": user, "assistant": answer,
                             "detected_lang": language_of(answer)})

    per_lang = {}
    for lang in ("hi", "en", "hinglish", "roman_hi"):
        subset = [r for r in rows if r["expected_lang"] == lang]
        if subset:
            per_lang[lang] = {
                "probes": len(subset),
                "language_consistency": round(sum(r["language_consistent"] for r in subset) / len(subset), 3),
                "mean_chars": round(sum(r["chars"] for r in subset) / len(subset), 1),
            }

    report = {
        "checkpoint": args.checkpoint,
        "probes": rows,
        "per_language": per_lang,
        "overall_consistency": round(sum(r["language_consistent"] for r in rows) / len(rows), 3),
        "language_switch_probe": {
            "turns": [{"user": t["user"], "assistant": t["assistant"]} for t in switch_turns],
        },
        "note": (
            "Consistency checks the script/language of the OUTPUT against the language of the "
            "QUESTION. It does not measure comprehension or answer correctness."
        ),
    }
    save_report("eval_languages.json", report)
    print(json.dumps(per_lang, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
