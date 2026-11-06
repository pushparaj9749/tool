"""Model configuration for ANKIT LLM.

Design notes (see TECHNICAL_SPEC.md for the full rationale):
  * Decoder-only Transformer, pre-norm, no biases.
  * RoPE instead of learned absolute positions: no parameters, better length
    extrapolation, standard for modern decoder-only models.
  * RMSNorm instead of LayerNorm: cheaper, stable, no mean subtraction.
  * SwiGLU instead of GELU MLP: better quality per parameter; costs 3 matrices.
  * Input embedding and output projection are tied: saves ~25M parameters at
    this vocabulary size and improves small-model quality.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, fields
from pathlib import Path
from typing import Any, Dict

import yaml


@dataclass
class AnkitConfig:
    name: str = "ankit-100m"
    vocab_size: int = 32768
    d_model: int = 768
    n_layers: int = 10
    n_heads: int = 12
    d_ff: int = 2112
    max_seq_len: int = 512
    rope_theta: float = 10000.0
    rms_norm_eps: float = 1e-5
    dropout: float = 0.0
    tie_word_embeddings: bool = True
    attention_bias: bool = False
    initializer_range: float = 0.02

    def __post_init__(self) -> None:
        if self.d_model % self.n_heads != 0:
            raise ValueError(
                f"d_model ({self.d_model}) must be divisible by n_heads ({self.n_heads})"
            )
        if self.vocab_size > 65535:
            raise ValueError("vocab_size must fit in uint16 token shards")
        if self.d_model < 16:
            raise ValueError("d_model too small")

    @property
    def head_dim(self) -> int:
        return self.d_model // self.n_heads

    # ---- serialisation -------------------------------------------------
    @classmethod
    def from_yaml(cls, path: str | Path) -> "AnkitConfig":
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AnkitConfig":
        known = {f.name for f in fields(cls)}
        unknown = set(data) - known
        if unknown:
            raise ValueError(f"unknown model config keys: {sorted(unknown)}")
        return cls(**{k: v for k, v in data.items() if k in known})

    @classmethod
    def from_json(cls, path: str | Path) -> "AnkitConfig":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(json.load(fh))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(self.to_dict(), fh, indent=2)
            fh.write("\n")

    def to_yaml(self, path: str | Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(self.to_dict(), fh, sort_keys=False)

    # ---- analytic parameter estimate (verified by model/parameter_count.py)
    def estimated_parameter_count(self) -> Dict[str, int]:
        emb = self.vocab_size * self.d_model
        attn = 4 * self.d_model * self.d_model
        if self.attention_bias:
            attn += 4 * self.d_model
        mlp = 3 * self.d_model * self.d_ff  # gate/up/down, no biases
        norm = 2 * self.d_model  # two RMSNorm gains per block (attn + mlp)
        per_layer = attn + mlp + norm
        out_proj = 0 if self.tie_word_embeddings else emb
        total = emb + self.n_layers * per_layer + self.d_model + out_proj
        return {
            "embedding": emb,
            "per_layer": per_layer,
            "blocks": self.n_layers * per_layer,
            "final_norm": self.d_model,
            "output_projection": out_proj,
            "total": total,
        }
