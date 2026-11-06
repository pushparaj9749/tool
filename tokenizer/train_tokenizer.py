"""Train the ANKIT tokenizer from the project corpus (CLI)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tokenizer.ankit_tokenizer import train_tokenizer  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser(description="Train ANKIT byte-level BPE tokenizer from scratch")
    ap.add_argument("--config", default="configs/tokenizer.yaml")
    ap.add_argument("--corpus", default=None, help="override corpus path")
    ap.add_argument("--out-dir", default="tokenizer/ankit_bpe")
    args = ap.parse_args()

    cfg = yaml.safe_load(open(args.config, encoding="utf-8"))
    corpus = args.corpus or cfg["train_corpus"]
    wrapper = train_tokenizer(
        corpus_path=corpus,
        out_dir=args.out_dir,
        vocab_size=cfg["vocab_size"],
        min_frequency=cfg["min_frequency"],
        max_token_length=cfg["max_token_length"],
        log_path="logs/tokenizer_training_log.json",
    )
    print(f"[tokenizer] vocab_size={wrapper.vocab_size}")
    print(f"[tokenizer] special ids={wrapper.special_token_ids()}")
    print(f"[tokenizer] saved to {args.out_dir}")


if __name__ == "__main__":
    main()
