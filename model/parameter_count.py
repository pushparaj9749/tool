"""Programmatic parameter accounting for ANKIT LLM.

The parameter count that goes into the model card is *measured* from an
instantiated model, not assumed from the config.
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

import sys
from pathlib import Path as _Path
if __package__ in (None, ""):                       # allow `python model/parameter_count.py`
    sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
    from model.architecture import AnkitLM
    from model.configuration import AnkitConfig
else:
    from .architecture import AnkitLM
    from .configuration import AnkitConfig


def measure(config: AnkitConfig) -> dict:
    model = AnkitLM(config)
    groups = defaultdict(int)
    seen = set()
    for name, p in model.named_parameters():
        if p.requires_grad is False:
            continue
        if id(p) in seen:
            continue
        seen.add(id(p))
        head = name.split(".")[0]
        if head == "blocks":
            head = "blocks." + name.split(".")[2]
        groups[head] += p.numel()
    total = sum(groups.values())
    analytic = config.estimated_parameter_count()
    return {
        "model_name": config.name,
        "measured_trainable_parameters": total,
        "measured_millions": round(total / 1e6, 3),
        "analytic_estimate": analytic["total"],
        "analytic_matches_measured": analytic["total"] == total,
        "breakdown": dict(sorted(groups.items(), key=lambda kv: -kv[1])),
        "config": config.to_dict(),
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Measure ANKIT LLM parameter count")
    ap.add_argument("--model-config", default="configs/model.yaml")
    ap.add_argument("--out", default=None)
    args = ap.parse_args()
    config = AnkitConfig.from_yaml(args.model_config)
    result = measure(config)
    print(json.dumps(result, indent=2))
    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
