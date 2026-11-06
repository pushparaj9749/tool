"""Shared evaluation utilities."""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Dict, List

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
LATIN = re.compile(r"[A-Za-z]")
HINGLISH_MARKERS = {
    "hai", "hain", "nahi", "kya", "kaise", "mera", "mujhe", "tum", "aap", "bhai",
    "yaar", "karo", "karna", "raha", "rahi", "tha", "thi", "aur", "bhi", "haan",
    "kyun", "matlab", "accha", "acha", "thik", "theek", "chahiye", "batao",
    "samajh", "bahut", "zyada", "kuch", "abhi",
}
FORMAL_MARKERS = {
    "please", "kindly", "request", "regards", "sincerely", "furthermore", "therefore",
    "however", "consequently", "कृपया", "महोदय", "महोदया", "प्रार्थना", "धन्यवाद", "अतः",
}
CASUAL_MARKERS = {"yaar", "bhai", "haan", "arre", "lol", "cool", "nahi", "bro", "dude"}


def language_of(text: str) -> str:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return "none"
    dev = sum(1 for c in letters if DEVANAGARI.match(c)) / len(letters)
    lat = sum(1 for c in letters if LATIN.match(c)) / len(letters)
    if dev > 0.6:
        return "hi"
    if lat > 0.6:
        words = {w.lower() for w in re.findall(r"[A-Za-z]+", text)}
        hits = len(words & HINGLISH_MARKERS)
        if hits >= 2 and hits / max(len(words), 1) >= 0.12:
            return "hinglish"
        return "en"
    if dev > 0.15 and lat > 0.15:
        return "mixed"
    return "other"


def word_overlap(a: str, b: str) -> float:
    wa = set(re.findall(r"\w+", a.lower()))
    wb = set(re.findall(r"\w+", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def distinct_n(texts: List[str], n: int = 2) -> float:
    grams: Counter = Counter()
    total = 0
    for t in texts:
        toks = re.findall(r"\w+", t.lower())
        for i in range(len(toks) - n + 1):
            grams[tuple(toks[i:i + n])] += 1
            total += 1
    if total == 0:
        return 0.0
    return len(grams) / total


def formality_score(text: str) -> Dict[str, float]:
    words = set(re.findall(r"\w+", text.lower()))
    formal = len(words & FORMAL_MARKERS)
    casual = len(words & CASUAL_MARKERS)
    return {"formal_markers": formal, "casual_markers": casual,
            "formality_ratio": (formal + 1) / (casual + 1)}


def save_report(name: str, payload: dict) -> Path:
    path = ROOT / "reports" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"[report] {path}")
    return path


def load_engine(checkpoint: str, device: str = "cpu"):
    from inference.conversation import ChatEngine
    return ChatEngine.from_checkpoint(checkpoint, device=device)
