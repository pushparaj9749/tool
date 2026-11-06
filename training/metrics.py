"""Local experiment tracking: JSONL metrics + human-readable stdout."""
from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any, Dict, Optional


class RunLogger:
    def __init__(self, log_dir: str | Path, run_name: str, run_id: str) -> None:
        self.dir = Path(log_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / f"{run_name}-{run_id}.jsonl"
        self.summary_path = self.dir / f"{run_name}-{run_id}-summary.json"
        self.start = time.time()
        self.rows = 0

    def log(self, **fields: Any) -> None:
        rec = {"ts": round(time.time(), 3), "wall_clock_s": round(time.time() - self.start, 2), **fields}
        with open(self.path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        self.rows += 1

    def summary(self, **fields: Any) -> None:
        payload = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                   "duration_s": round(time.time() - self.start, 2), **fields}
        self.summary_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def perplexity(loss: float) -> Optional[float]:
    if loss is None or math.isnan(loss) or loss > 50:
        return None
    return float(math.exp(loss))
