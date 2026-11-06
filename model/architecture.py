"""ANKIT LLM — decoder-only autoregressive Transformer, implemented from scratch.

No pretrained weights and no third-party model code are used: every module here
is defined in this repository. PyTorch is used only for tensor ops / autograd /
fused attention kernels.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Optional

import torch
import torch.nn.functional as F
from torch import nn

from .configuration import AnkitConfig
from .transformer_block import RMSNorm, TransformerBlock


@dataclass
class ModelOutput:
    logits: Optional[torch.Tensor]
    loss: Optional[torch.Tensor]
    cache: Optional[List] = None


class AnkitLM(nn.Module):
    def __init__(self, config: AnkitConfig) -> None:
        super().__init__()
        self.config = config
        self.tok_emb = nn.Embedding(config.vocab_size, config.d_model)
        self.blocks = nn.ModuleList([TransformerBlock(config) for _ in range(config.n_layers)])
        self.norm = RMSNorm(config.d_model, config.rms_norm_eps)
        self.lm_head = nn.Linear(config.d_model, config.vocab_size, bias=False)
        if config.tie_word_embeddings:
            self.lm_head.weight = self.tok_emb.weight
        self.apply(self._init_weights)
        # scaled init for residual projections (GPT-2 style) improves stability
        for name, p in self.named_parameters():
            if name.endswith("o_proj.weight") or name.endswith("down_proj.weight"):
                nn.init.normal_(p, mean=0.0, std=config.initializer_range / math.sqrt(2 * config.n_layers))

    def _init_weights(self, module: nn.Module) -> None:
        if isinstance(module, nn.Linear):
            nn.init.normal_(module.weight, mean=0.0, std=self.config.initializer_range)
            if module.bias is not None:
                nn.init.zeros_(module.bias)
        elif isinstance(module, nn.Embedding):
            nn.init.normal_(module.weight, mean=0.0, std=self.config.initializer_range)

    # ------------------------------------------------------------------
    def num_parameters(self, trainable_only: bool = True) -> int:
        seen = set()
        total = 0
        for p in self.parameters():
            if trainable_only and not p.requires_grad:
                continue
            if id(p) in seen:          # tied weights counted once
                continue
            seen.add(id(p))
            total += p.numel()
        return total

    def forward(
        self,
        input_ids: torch.Tensor,
        targets: Optional[torch.Tensor] = None,
        loss_mask: Optional[torch.Tensor] = None,
        cache: Optional[List] = None,
        use_cache: bool = False,
        return_logits: bool = True,
    ) -> ModelOutput:
        B, T = input_ids.shape
        if cache is None:
            cache = [None] * len(self.blocks)
        x = self.tok_emb(input_ids)
        new_cache: List = []
        for i, block in enumerate(self.blocks):
            past = cache[i] if cache is not None else None
            x, kv = block(x, past_kv=past, use_cache=use_cache)
            new_cache.append(kv)

        x = self.norm(x)
        loss = None
        logits = None
        if targets is not None:
            logits = self.lm_head(x)
            flat = logits.reshape(-1, logits.size(-1)).float()
            tgt = targets.reshape(-1)
            if loss_mask is not None:
                mask = loss_mask.reshape(-1).bool()
                if mask.any():
                    loss = F.cross_entropy(flat[mask], tgt[mask], ignore_index=-100)
                else:
                    loss = torch.zeros((), device=flat.device, requires_grad=True)
            else:
                loss = F.cross_entropy(flat, tgt, ignore_index=-100)
        elif return_logits:
            logits = self.lm_head(x[:, -1:, :])

        return ModelOutput(logits=logits, loss=loss, cache=new_cache if use_cache else None)

    # ------------------------------------------------------------------
    @torch.no_grad()
    def generate(
        self,
        input_ids: torch.Tensor,
        max_new_tokens: int = 64,
        temperature: float = 0.8,
        top_k: int = 40,
        top_p: float = 0.92,
        repetition_penalty: float = 1.1,
        eos_token_id: Optional[int] = None,
        stop_token_ids: Optional[List[int]] = None,
        generator: Optional[torch.Generator] = None,
        use_cache: bool = True,
    ):
        """Greedy / top-k / nucleus sampling with KV cache (any batch size >0).

        Returns (generated_ids, produced_token_ids_of_first_sequence).
        """
        self.eval()
        B = input_ids.shape[0]
        stop_ids = set(stop_token_ids or [])
        if eos_token_id is not None:
            stop_ids.add(eos_token_id)
        generated = input_ids
        cache = None
        produced: List[int] = []
        finished = torch.zeros(B, dtype=torch.bool, device=input_ids.device)
        for _ in range(max_new_tokens):
            cur = generated[:, -1:] if (use_cache and cache is not None) else generated
            out = self.forward(cur, cache=cache if use_cache else None,
                               use_cache=use_cache, return_logits=True)
            cache = out.cache
            logits = out.logits[:, -1, :].float().clone()          # [B, V]

            if repetition_penalty and repetition_penalty != 1.0 and produced:
                for tid in set(produced):
                    col = logits[:, tid]
                    logits[:, tid] = torch.where(col > 0, col / repetition_penalty,
                                                 col * repetition_penalty)

            if temperature <= 0:
                next_ids = torch.argmax(logits, dim=-1, keepdim=True)          # [B,1]
            else:
                scores = logits / temperature
                if top_k and top_k > 0:
                    kth = torch.topk(scores, min(top_k, scores.shape[-1]), dim=-1).values[:, -1:]
                    scores = torch.where(scores < kth, torch.full_like(scores, float("-inf")), scores)
                probs = F.softmax(scores, dim=-1)
                if top_p and 0 < top_p < 1.0:
                    sorted_probs, sorted_idx = torch.sort(probs, descending=True, dim=-1)
                    cum = torch.cumsum(sorted_probs, dim=-1)
                    mask = cum - sorted_probs > top_p
                    sorted_probs[mask] = 0.0
                    probs = torch.zeros_like(probs).scatter(1, sorted_idx, sorted_probs)
                    probs = probs / probs.sum(dim=-1, keepdim=True).clamp_min(1e-9)
                next_ids = torch.multinomial(probs, num_samples=1, generator=generator)

            produced.append(int(next_ids[0].item()))
            generated = torch.cat([generated, next_ids], dim=1)
            finished |= torch.tensor([t in stop_ids for t in next_ids.flatten().tolist()],
                                     dtype=torch.bool, device=finished.device)
            if bool(finished.all()):
                break
            if generated.shape[1] >= self.config.max_seq_len:
                break
        return generated, produced


def build_model(config: AnkitConfig, device: str = "cpu", seed: int = 0) -> AnkitLM:
    torch.manual_seed(seed)
    model = AnkitLM(config)
    return model.to(device)
