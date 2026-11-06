"""Optimizer construction: AdamW with decay / no-decay parameter groups."""
from __future__ import annotations

from typing import Iterable, Tuple

import torch
from torch import nn

from training.scheduler import lr_at_step  # re-export for convenience


def build_param_groups(model: nn.Module, weight_decay: float) -> list[dict]:
    decay, no_decay = [], []
    for name, p in model.named_parameters():
        if not p.requires_grad:
            continue
        if p.ndim < 2 or name.endswith(".bias") or "norm" in name.lower() or name.endswith("emb.weight"):
            no_decay.append(p)
        else:
            decay.append(p)
    groups = []
    if decay:
        groups.append({"params": decay, "weight_decay": weight_decay})
    if no_decay:
        groups.append({"params": no_decay, "weight_decay": 0.0})
    return groups


def build_optimizer(model: nn.Module, cfg: dict) -> torch.optim.Optimizer:
    return torch.optim.AdamW(
        build_param_groups(model, cfg["weight_decay"]),
        lr=cfg["learning_rate"],
        betas=(cfg["beta1"], cfg["beta2"]),
        eps=1e-8,
    )


def set_lr(optimizer: torch.optim.Optimizer, lr: float) -> None:
    for group in optimizer.param_groups:
        group["lr"] = lr


def clip_gradients(parameters: Iterable[torch.Tensor], max_norm: float) -> float:
    return float(torch.nn.utils.clip_grad_norm_(list(parameters), max_norm))
