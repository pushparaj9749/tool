"""Causal multi-head self-attention with rotary position embeddings (RoPE)
and an incremental KV cache for generation.
"""
from __future__ import annotations

from typing import Optional, Tuple

import torch
import torch.nn.functional as F
from torch import nn


def build_rope_cache(
    seq_len: int,
    head_dim: int,
    theta: float,
    device: torch.device,
    dtype: torch.dtype,
    offset: int = 0,
) -> Tuple[torch.Tensor, torch.Tensor]:
    """cos/sin tables of shape [seq_len, head_dim] for positions offset..offset+seq_len-1."""
    if head_dim % 2 != 0:
        raise ValueError("head_dim must be even for RoPE")
    inv_freq = 1.0 / (
        theta ** (torch.arange(0, head_dim, 2, device=device, dtype=torch.float32) / head_dim)
    )
    positions = torch.arange(offset, offset + seq_len, device=device, dtype=torch.float32)
    freqs = torch.outer(positions, inv_freq)          # [T, head_dim/2]
    emb = torch.cat((freqs, freqs), dim=-1)           # [T, head_dim]
    return emb.cos().to(dtype), emb.sin().to(dtype)


def rotate_half(x: torch.Tensor) -> torch.Tensor:
    x1, x2 = x.chunk(2, dim=-1)
    return torch.cat((-x2, x1), dim=-1)


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """x: [B, H, T, D]; cos/sin: [T, D]."""
    cos = cos[None, None, :, :]
    sin = sin[None, None, :, :]
    return (x * cos) + (rotate_half(x) * sin)


class CausalSelfAttention(nn.Module):
    def __init__(self, config) -> None:
        super().__init__()
        self.n_heads = config.n_heads
        self.head_dim = config.head_dim
        self.d_model = config.d_model
        self.rope_theta = config.rope_theta
        self.dropout = config.dropout
        bias = config.attention_bias
        self.q_proj = nn.Linear(config.d_model, config.d_model, bias=bias)
        self.k_proj = nn.Linear(config.d_model, config.d_model, bias=bias)
        self.v_proj = nn.Linear(config.d_model, config.d_model, bias=bias)
        self.o_proj = nn.Linear(config.d_model, config.d_model, bias=bias)

    def forward(
        self,
        x: torch.Tensor,
        past_kv: Optional[Tuple[torch.Tensor, torch.Tensor]] = None,
        use_cache: bool = False,
    ) -> Tuple[torch.Tensor, Optional[Tuple[torch.Tensor, torch.Tensor]]]:
        B, T, _ = x.shape
        q = self.q_proj(x).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        k = self.k_proj(x).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)
        v = self.v_proj(x).view(B, T, self.n_heads, self.head_dim).transpose(1, 2)

        past_len = 0
        if past_kv is not None:
            past_k, past_v = past_kv
            past_len = past_k.shape[2]
        cos, sin = build_rope_cache(T, self.head_dim, self.rope_theta, x.device, q.dtype, past_len)
        q = apply_rope(q, cos, sin)
        k = apply_rope(k, cos, sin)

        new_cache = None
        if use_cache or past_kv is not None:
            if past_kv is not None:
                k = torch.cat([past_kv[0], k], dim=2)
                v = torch.cat([past_kv[1], v], dim=2)
            new_cache = (k, v)

        # When we are decoding a single token against a cache, causality is
        # implied (query sits after every key), so is_causal must be False.
        is_causal = past_len == 0
        out = F.scaled_dot_product_attention(
            q,
            k,
            v,
            attn_mask=None,
            dropout_p=self.dropout if self.training else 0.0,
            is_causal=is_causal,
            scale=1.0 / (self.head_dim ** 0.5),
        )
        out = out.transpose(1, 2).contiguous().view(B, T, self.d_model)
        return self.o_proj(out), new_cache
