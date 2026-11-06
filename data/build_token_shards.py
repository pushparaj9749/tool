"""Token shard construction: JSONL text -> packed uint16 token shards.

Packing strategy: documents are concatenated with an <eos> separator and stored
as one flat uint16 array per split. Training samples random contiguous windows,
which keeps the pipeline simple and avoids padding waste.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tokenizer.ankit_tokenizer import AnkitTokenizer  # noqa: E402


def build_shard(jsonl_path: Path, tokenizer: AnkitTokenizer, out_bin: Path,
                chunk_size: int = 8192) -> dict:
    """Batched encoding: the Rust tokenizer parallelises across a batch."""
    tokens: list[int] = []
    eos = tokenizer.eos_id
    docs = 0

    def flush(batch: list[str]) -> None:
        nonlocal docs
        for enc in tokenizer._tok.encode_batch(batch, add_special_tokens=False):
            tokens.extend(enc.ids)
            tokens.append(eos)
            docs += 1

    buf: list[str] = []
    with open(jsonl_path, encoding="utf-8") as fh:
        for line in fh:
            buf.append(json.loads(line)["text"])
            if len(buf) >= chunk_size:
                flush(buf)
                buf = []
    if buf:
        flush(buf)
    arr = np.asarray(tokens, dtype=np.uint16)
    if arr.size and arr.max() >= tokenizer.vocab_size:
        raise ValueError("token id exceeds vocab size")
    out_bin.parent.mkdir(parents=True, exist_ok=True)
    arr.tofile(out_bin)
    return {"docs": docs, "tokens": int(arr.size), "bytes": int(arr.nbytes), "path": str(out_bin)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tokenizer-dir", default="tokenizer/ankit_bpe")
    ap.add_argument("--data-dir", default="data/processed")
    args = ap.parse_args()
    proc = Path(args.data_dir)
    tok = AnkitTokenizer.load(args.tokenizer_dir)
    report = {"tokenizer_vocab": tok.vocab_size, "splits": {}}
    for split in ("train", "val", "test"):
        jsonl = proc / f"pretrain_{split}.jsonl"
        if not jsonl.exists():
            print(f"[skip] {jsonl}")
            continue
        info = build_shard(jsonl, tok, proc / f"pretrain_{split}.bin")
        report["splits"][split] = info
        print(f"[{split}] docs={info['docs']} tokens={info['tokens']:,} -> {info['path']}")
    total = sum(s["tokens"] for s in report["splits"].values())
    report["total_tokens"] = total
    (proc / "token_shard_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"total tokens: {total:,}")


if __name__ == "__main__":
    main()
