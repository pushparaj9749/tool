"""Transformer building blocks: RMSNorm, SwiGLU feed-forward, pre-norm block."""
from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

from .attention import CausalSelfAttention


class RMSNorm(nn.Module):
    def __init__(self, d_model: int, eps: float = 1e-5) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.ones(d_model))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # compute in fp32 for numerical stability under mixed precision
        dtype = x.dtype
        x = x.float()
        x = x * torch.rsqrt(x.pow(2).mean(dim=-1, keepdim=True) + self.eps)
        return (x.to(dtype) * self.weight)


class SwiGLU(nn.Module):
    """gated feed-forward: down(silu(gate(x)) * up(x))"""

    def __init__(self, config) -> None:
        super().__init__()
        self.gate_proj = nn.Linear(config.d_model, config.d_ff, bias=False)
        self.up_proj = nn.Linear(config.d_model, config.d_ff, bias=False)
        self.down_proj = nn.Linear(config.d_ff, config.d_model, bias=False)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = F.silu(self.gate_proj(x)) * self.up_proj(x)
        return self.dropout(self.down_proj(h))


class TransformerBlock(nn.Module):
    def __init__(self, config) -> None:
        super().__init__()
        self.attn_norm = RMSNorm(config.d_model, config.rms_norm_eps)
        self.attn = CausalSelfAttention(config)
        self.mlp_norm = RMSNorm(config.d_model, config.rms_norm_eps)
        self.mlp = SwiGLU(config)
        self.dropout = nn.Dropout(config.dropout)

    def forward(self, x, past_kv=None, use_cache: bool = False):
        attn_out, new_cache = self.attn(self.attn_norm(x), past_kv=past_kv, use_cache=use_cache)
        x = x + self.dropout(attn_out)
        x = x + self.mlp(self.mlp_norm(x))
        return x, new_cache
