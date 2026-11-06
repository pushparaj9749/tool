"""Conversation evaluation: multi-turn behaviour, context retention, instruction following,
clarification behaviour and repetition/coherence proxies.

These are behavioural probes with deterministic, reproducible scoring rules — NOT
a judgement of language intelligence. Every score is reported next to the raw
generations so the reader can judge for themselves.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import load_engine, save_report, word_overlap  # noqa: E402

SINGLE_TURN = [
    {"id": "greet_en", "prompt": "Hello ANKIT, who are you?", "expect_any": ["ankit", "model", "assistant"]},
    {"id": "greet_hi", "prompt": "नमस्ते अंकित, तुम कौन हो?", "expect_any": ["अंकित", "मॉडल", "मैं"]},
    {"id": "instruction_list", "prompt": "List three tips for better sleep.", "expect_any": ["1", "2", "3", "-"]},
    {"id": "explain", "prompt": "What is machine learning? Answer in one sentence.",
     "expect_any": ["learn", "data", "pattern", "example"]},
    {"id": "math", "prompt": "What is 15 percent of 240?", "expect_any": ["36"]},
    {"id": "clarify", "prompt": "Fix my code.", "expect_any": ["?", "which", "what", "code"]},
    {"id": "uncertain", "prompt": "Who won the cricket match yesterday?", "expect_any": ["not", "cannot", "don't", "no access", "नहीं"]},
    {"id": "hinglish", "prompt": "Bhai, tokenizer kya hota hai?", "expect_any": ["token", "text", "model"]},
]

CONTEXT_PROBES = [
    {
        "id": "name_recall",
        "turns": ["My name is Rahul.", "What is my name?"],
        "expect_any": ["rahul"],
    },
    {
        "id": "topic_recall_hi",
        "turns": ["मुझे पाइथन सीखनी है।", "मैंने कौन सी भाषा सीखने की बात कही थी?"],
        "expect_any": ["पाइथन", "python", "पायथन"],
    },
    {
        "id": "preference_recall",
        "turns": ["I prefer short answers without bullet points.", "Explain databases."],
        "expect_any": ["database", "data", "sql"],
    },
]


def score_expectation(text: str, expect_any: list[str]) -> bool:
    low = text.lower()
    return any(e.lower() in low for e in expect_any)


def repetition_rate(text: str, n: int = 3) -> float:
    words = re.findall(r"\w+", text.lower())
    if len(words) < n + 1:
        return 0.0
    grams = [tuple(words[i:i + n]) for i in range(len(words) - n + 1)]
    return 1.0 - (len(set(grams)) / len(grams))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--device", default="cpu")
    ap.add_argument("--mode", default="adaptive")
    args = ap.parse_args()

    engine = load_engine(args.checkpoint, args.device)
    engine.gen_cfg.max_new_tokens = 64

    single_results = []
    for case in SINGLE_TURN:
        answer = engine.chat_once([{"role": "user", "content": case["prompt"]}], mode=args.mode)
        single_results.append({
            "id": case["id"],
            "prompt": case["prompt"],
            "response": answer,
            "expectation_hit": score_expectation(answer, case["expect_any"]),
            "repetition_3gram_rate": round(repetition_rate(answer), 3),
            "prompt_overlap": round(word_overlap(case["prompt"], answer), 3),
        })

    context_results = []
    for probe in CONTEXT_PROBES:
        conv = engine.new_conversation(args.mode)
        turns = []
        for user in probe["turns"]:
            answer = engine.reply(conv, user)
            turns.append({"user": user, "assistant": answer})
        context_results.append({
            "id": probe["id"],
            "turns": turns,
            "expectation_hit": score_expectation(turns[-1]["assistant"], probe["expect_any"]),
        })

    # contradiction probe: same question twice in one conversation
    conv = engine.new_conversation(args.mode)
    q = "What is the capital of Japan?"
    a1 = engine.reply(conv, q)
    a2 = engine.reply(conv, q)
    contradiction = {
        "question": q,
        "first_answer": a1,
        "second_answer": a2,
        "identical": a1.strip().lower() == a2.strip().lower(),
        "overlap": round(word_overlap(a1, a2), 3),
    }

    n_hits = sum(r["expectation_hit"] for r in single_results)
    report = {
        "checkpoint": args.checkpoint,
        "mode": args.mode,
        "single_turn": single_results,
        "single_turn_expectation_rate": round(n_hits / len(single_results), 3),
        "multi_turn_context": context_results,
        "context_expectation_rate": round(
            sum(r["expectation_hit"] for r in context_results) / len(context_results), 3),
        "contradiction_probe": contradiction,
        "mean_repetition_3gram_rate": round(
            sum(r["repetition_3gram_rate"] for r in single_results) / len(single_results), 3),
        "scoring_note": (
            "'expectation_hit' is a substring heuristic over a small probe set; it measures whether a "
            "recognisable behaviour appeared, not whether the answer is correct or intelligent."
        ),
    }
    save_report("eval_chat.json", report)
    print(json.dumps({k: report[k] for k in
                      ("single_turn_expectation_rate", "context_expectation_rate",
                       "mean_repetition_3gram_rate")}, indent=2))


if __name__ == "__main__":
    main()
