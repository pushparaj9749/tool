"""ANKIT LLM dataset pipeline: raw sources -> validated, deduplicated, split JSONL.

Every raw source is read with an explicit provenance record; the produced
statistics land in data/data_statistics.json and the source/licence record in
data/dataset_manifest.json.

Run:  python data/prepare_data.py [--config data/pipeline_config.json]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
LATIN = re.compile(r"[A-Za-z]")
CONTROL = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]")
MULTISPACE = re.compile(r"[ \t\u00A0]+")
REPEATED_PUNCT = re.compile(r"([!?.,;:\-])\1{3,}")

# Romanised-Hindi (Hinglish) function words used only for language tagging.
HINGLISH_MARKERS = {
    "hai", "hain", "nahi", "nahin", "kya", "kaise", "kaisa", "kaisi", "mera", "meri",
    "mujhe", "tum", "tumhara", "aap", "aapka", "bhai", "yaar", "karo", "karna", "kar",
    "raha", "rahi", "the", "tha", "thi", "aur", "par", "kal", "aaj", "abhi", "bhi",
    "nahi", "haan", "ha", "kyun", "kyu", "matlab", "accha", "acha", "thik", "theek",
    "chahiye", "banana", "batao", "bataye", "samajh", "jaldi", "bahut", "zyada",
}


# ----------------------------------------------------------------- helpers
def normalize_text(text: str) -> str:
    text = unicodedata.normalize("NFKC", text)
    text = text.replace("\u200b", "").replace("\ufeff", "")
    text = CONTROL.sub(" ", text)
    text = REPEATED_PUNCT.sub(r"\1\1\1", text)
    text = MULTISPACE.sub(" ", text)
    return text.strip()


def script_ratio(text: str) -> Tuple[float, float]:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return 0.0, 0.0
    dev = sum(1 for c in letters if DEVANAGARI.match(c))
    lat = sum(1 for c in letters if LATIN.match(c))
    return dev / len(letters), lat / len(letters)


def detect_language(text: str) -> str:
    dev, lat = script_ratio(text)
    if dev > 0.6:
        return "hi"
    if lat > 0.6:
        words = {w.lower() for w in re.findall(r"[A-Za-z]+", text)}
        hits = len(words & HINGLISH_MARKERS)
        if hits >= 2 and hits / max(len(words), 1) >= 0.12:
            return "hinglish"
        return "en"
    if dev > 0.15 and lat > 0.15:
        return "mixed"        # Devanagari + Latin in one sentence
    return "other"


def quality_ok(text: str, lang: str) -> Tuple[bool, str]:
    if len(text) < 12:
        return False, "too_short"
    if len(text) > 2000:
        return False, "too_long"
    letters = sum(1 for c in text if c.isalpha())
    if letters / max(len(text), 1) < 0.5:
        return False, "low_alpha_ratio"
    words = text.split()
    if len(words) < 3:
        return False, "too_few_words"
    if len(set(words)) / len(words) < 0.35:
        return False, "repetitive"
    if "\ufffd" in text:
        return False, "decoding_error"
    if lang in ("other",):
        return False, "unknown_language"
    dev, _ = script_ratio(text)
    if lang == "hinglish" and dev > 0.2:
        return False, "hinglish_but_devanagari"
    return True, "ok"


def doc_hash(text: str) -> str:
    return hashlib.blake2b(text.encode("utf-8"), digest_size=16).hexdigest()


def split_of(text: str) -> str:
    """Deterministic content-hash split: 98/1/1, leakage-free by construction."""
    h = int(doc_hash(text)[:8], 16) % 1000
    if h < 980:
        return "train"
    if h < 990:
        return "val"
    return "test"


# ----------------------------------------------------------------- sources
def iter_iitb(limit: int | None = None) -> Iterator[Dict[str, str]]:
    pairs = [
        (RAW / "iitb" / "IITB.en-hi-hi.txt", "hi"),
        (RAW / "iitb" / "IITB.en-hi-en.txt", "en"),
    ]
    for path, lang in pairs:
        if not path.exists():
            print(f"  [skip] missing {path}")
            continue
        with open(path, encoding="utf-8", errors="replace") as fh:
            for i, line in enumerate(fh):
                if limit and i >= limit:
                    break
                yield {"text": line, "source": "iitb_en_hi", "source_lang": lang}


def iter_gutenberg() -> Iterator[Dict[str, str]]:
    directory = RAW / "gutenberg" / "gutenberg"
    if not directory.exists():
        print(f"  [skip] missing {directory}")
        return
    for path in sorted(directory.glob("*.txt")):
        text = path.read_text(encoding="utf-8", errors="replace")
        # Paragraph-level records keep documents reasonably sized.
        for para in text.split("\n\n"):
            para = " ".join(para.split())
            if para:
                yield {"text": para, "source": "gutenberg", "source_lang": "en"}


def iter_hinglish_top() -> Iterator[Dict[str, str]]:
    base = RAW / "hinglish_top" / "Dataset"
    if not base.exists():
        print(f"  [skip] missing {base}")
        return
    for path in sorted(base.rglob("*.tsv")):
        with open(path, encoding="utf-8", errors="replace") as fh:
            header = fh.readline().rstrip("\n").split("\t")
            if "cs_query" not in header:
                continue
            idx = header.index("cs_query")
            for line in fh:
                cols = line.rstrip("\n").split("\t")
                if len(cols) > idx:
                    yield {"text": cols[idx], "source": "hinglish_top", "source_lang": "hinglish"}


SOURCES = {
    "iitb": iter_iitb,
    "gutenberg": iter_gutenberg,
    "hinglish_top": iter_hinglish_top,
}


# ----------------------------------------------------------------- pipeline
def process(source_filter: List[str] | None = None) -> Dict[str, object]:
    PROC.mkdir(parents=True, exist_ok=True)
    stats: Dict[str, object] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sources": {},
        "counts": Counter(),
        "reject_reasons": Counter(),
        "language_counts": Counter(),
        "split_counts": Counter(),
        "duplicates_removed": 0,
        "total_seen": 0,
    }
    seen_hashes: set[str] = set()
    writers = {s: open(PROC / f"pretrain_{s}.jsonl", "w", encoding="utf-8") for s in ("train", "val", "test")}
    per_source_kept: Dict[str, int] = defaultdict(int)

    for name, iterator in SOURCES.items():
        if source_filter and name not in source_filter:
            continue
        seen = dup = kept = 0
        for rec in iterator():
            seen += 1
            text = normalize_text(rec["text"])
            lang = detect_language(text)
            ok, reason = quality_ok(text, lang)
            if not ok:
                stats["reject_reasons"][reason] += 1
                continue
            h = doc_hash(text)
            if h in seen_hashes:
                dup += 1
                continue
            seen_hashes.add(h)
            split = split_of(text)
            writers[split].write(json.dumps({"text": text, "lang": lang, "source": rec["source"]}, ensure_ascii=False) + "\n")
            stats["language_counts"][lang] += 1
            stats["split_counts"][split] += 1
            kept += 1
            per_source_kept[rec["source"]] += 1
        stats["sources"][name] = {"seen": seen, "kept": kept, "duplicates": dup}
        stats["total_seen"] += seen
        stats["duplicates_removed"] += dup
        print(f"  {name}: seen={seen} kept={kept} dup={dup}")

    for fh in writers.values():
        fh.close()

    stats["per_source_kept"] = dict(per_source_kept)
    stats["counts"] = {
        "kept_total": sum(stats["split_counts"].values()),
        "train": stats["split_counts"].get("train", 0),
        "val": stats["split_counts"].get("val", 0),
        "test": stats["split_counts"].get("test", 0),
    }
    stats["language_counts"] = dict(stats["language_counts"])
    stats["split_counts"] = dict(stats["split_counts"])
    stats["reject_reasons"] = dict(stats["reject_reasons"])
    (PROC / "data_statistics.json").write_text(json.dumps(stats, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return stats


def build_tokenizer_corpus(max_chars: int = 40_000_000) -> int:
    """Mixed-language sample used to train the BPE vocabulary.

    Language mix mirrors the *balanced* pretraining mix so that merge
    frequencies are not dominated by English.
    """
    out = PROC / "tokenizer_corpus.txt"
    per_lang_share = {"hi": 0.45, "en": 0.35, "hinglish": 0.20}
    written = 0
    used: Counter = Counter()
    caps = {k: int(max_chars * v) for k, v in per_lang_share.items()}
    with open(out, "w", encoding="utf-8") as fo, open(PROC / "pretrain_train.jsonl", encoding="utf-8") as fh:
        for line in fh:
            rec = json.loads(line)
            lang = rec["lang"]
            cap = caps.get(lang, 0)
            if used[lang] + len(rec["text"]) + 1 > cap:
                continue
            fo.write(rec["text"] + "\n")
            used[lang] += len(rec["text"]) + 1
            written += len(rec["text"]) + 1
    print(f"  tokenizer_corpus.txt: {written/1e6:.1f} MB (chars per language: {dict(used)})")
    return written


def balance_splits(en_hi_ratio: float = 1.15) -> Dict[str, int]:
    """Cap English records relative to Hindi so the model is not English-skewed.

    Deterministic (content-hash based sampling), so re-running is reproducible.
    """
    train = PROC / "pretrain_train.jsonl"
    counts: Counter = Counter()
    with open(train, encoding="utf-8") as fh:
        for line in fh:
            counts[json.loads(line)["lang"]] += 1
    hi = counts["hi"]
    en_cap = int(hi * en_hi_ratio)
    if counts["en"] <= en_cap:
        return dict(counts)
    keep_prob = en_cap / counts["en"]
    tmp = train.with_suffix(".jsonl.balanced")
    kept: Counter = Counter()
    dropped = 0
    with open(train, encoding="utf-8") as fh, open(tmp, "w", encoding="utf-8") as fo:
        for line in fh:
            rec = json.loads(line)
            if rec["lang"] == "en":
                # hash-based deterministic thinning
                if (int(doc_hash(rec["text"])[:6], 16) / 0xFFFFFF) > keep_prob:
                    dropped += 1
                    continue
            fo.write(line)
            kept[rec["lang"]] += 1
    tmp.replace(train)
    print(f"  balanced English: dropped {dropped:,} records (kept {dict(kept)})")
    return dict(kept)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", nargs="*", default=None)
    ap.add_argument("--skip-tokenizer-corpus", action="store_true")
    ap.add_argument("--skip-process", action="store_true",
                    help="reuse existing pretrain_*.jsonl and only run balance + tokenizer corpus")
    ap.add_argument("--en-hi-ratio", type=float, default=1.15)
    args = ap.parse_args()
    if not args.skip_process:
        print("[prepare_data] processing sources")
        stats = process(args.sources)
        print(json.dumps(stats["counts"], indent=2))
        print(json.dumps(stats["language_counts"], indent=2))
    print("[prepare_data] balancing language mix")
    balanced = balance_splits(args.en_hi_ratio)
    print(json.dumps(balanced, indent=2))
    if not args.skip_tokenizer_corpus:
        build_tokenizer_corpus()
    summary = {"balanced_language_counts": balanced,
               "note": "English capped relative to Hindi for a Hindi/English/Hinglish model"}
    (PROC / "balance_report.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
