"""Learning-rate schedules (implemented from scratch)."""
from __future__ import annotations

import math


def lr_at_step(step: int, base_lr: float, warmup_steps: int, max_steps: int,
               min_lr_ratio: float = 0.1, schedule: str = "cosine") -> float:
    if step < warmup_steps:
        # linear warmup from 0
        return base_lr * (step + 1) / max(warmup_steps, 1)
    if schedule == "constant":
        return base_lr
    if schedule != "cosine":
        raise ValueError(f"unknown schedule {schedule!r}")
    progress = min(1.0, (step - warmup_steps) / max(1, max_steps - warmup_steps))
    min_lr = base_lr * min_lr_ratio
    return min_lr + 0.5 * (base_lr - min_lr) * (1.0 + math.cos(math.pi * progress))
