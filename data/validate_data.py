"""Dataset validation tests: encoding, schema, leakage, shard integrity."""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PROC = ROOT / "data" / "processed"
SFT = ROOT / "data" / "sft"


def check_jsonl(path: Path, required: tuple[str, ...]) -> tuple[list[dict], list[str]]:
    errors: list[str] = []
    rows: list[dict] = []
    with open(path, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"{path.name}:{i} invalid JSON ({exc})")
                continue
            missing = [k for k in required if k not in rec]
            if missing:
                errors.append(f"{path.name}:{i} missing keys {missing}")
                continue
            if "\ufffd" in json.dumps(rec, ensure_ascii=False):
                errors.append(f"{path.name}:{i} contains U+FFFD replacement char")
            rows.append(rec)
    return rows, errors


def main() -> int:
    report: dict = {"checks": {}, "errors": []}
    errors: list[str] = []

    # 1. pretraining splits
    hashes: dict[str, set[str]] = {}
    langs: Counter = Counter()
    for split in ("train", "val", "test"):
        path = PROC / f"pretrain_{split}.jsonl"
        if not path.exists():
            errors.append(f"missing {path}")
            continue
        rows, errs = check_jsonl(path, ("text", "lang", "source"))
        errors.extend(errs)
        hashes[split] = {r["text"] for r in rows}
        langs.update(r["lang"] for r in rows)
        report["checks"][f"pretrain_{split}"] = {"rows": len(rows), "schema_errors": len(errs)}

    # 2. leakage between splits
    if {"train", "val", "test"} <= set(hashes):
        leaks = {
            "train_val": len(hashes["train"] & hashes["val"]),
            "train_test": len(hashes["train"] & hashes["test"]),
            "val_test": len(hashes["val"] & hashes["test"]),
        }
        report["checks"]["split_leakage"] = leaks
        if any(leaks.values()):
            errors.append(f"split leakage detected: {leaks}")

    # 3. token shards
    vocab_report = {}
    for split in ("train", "val"):
        bin_path = PROC / f"pretrain_{split}.bin"
        if not bin_path.exists():
            errors.append(f"missing shard {bin_path}")
            continue
        arr = np.memmap(bin_path, dtype=np.uint16, mode="r")
        vocab_report[split] = {"tokens": int(arr.shape[0]), "max_token_id": int(arr.max())}
        if arr.max() >= 32768:
            errors.append(f"{bin_path.name}: token id {int(arr.max())} >= vocab 32768")
    report["checks"]["token_shards"] = vocab_report

    # 4. SFT sets
    for name, required in (("sft_train.jsonl", ("messages", "lang", "mode")),
                           ("sft_val.jsonl", ("messages", "lang", "mode"))):
        path = SFT / name
        if not path.exists():
            errors.append(f"missing {path}")
            continue
        rows, errs = check_jsonl(path, required)
        errors.extend(errs)
        bad = [r for r in rows if not any(m["role"] == "assistant" for m in r["messages"])]
        if bad:
            errors.append(f"{name}: {len(bad)} examples without assistant turn")
        report["checks"][name] = {"rows": len(rows), "schema_errors": len(errs)}

    report["checks"]["language_distribution"] = dict(langs)
    report["errors"] = errors
    report["status"] = "PASS" if not errors else "FAIL"
    out = ROOT / "reports" / "data_validation.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
