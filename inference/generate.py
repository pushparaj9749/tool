"""Generation engine for ANKIT LLM: sampling + streaming + stop handling."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, List, Optional, Sequence

import torch
import torch.nn.functional as F

from model.architecture import AnkitLM
from tokenizer.ankit_tokenizer import AnkitTokenizer


@dataclass
class GenerationConfig:
    temperature: float = 0.8
    top_k: int = 40
    top_p: float = 0.92
    repetition_penalty: float = 1.1
    max_new_tokens: int = 128
    min_new_tokens: int = 1
    seed: Optional[int] = None

    @classmethod
    def from_dict(cls, d: dict) -> "GenerationConfig":
        fields = {k: d[k] for k in d if k in cls.__dataclass_fields__}
        return cls(**fields)


class Generator:
    """Token-by-token decoding with KV cache, penalties and stop tokens."""

    def __init__(self, model: AnkitLM, tokenizer: AnkitTokenizer, config: GenerationConfig) -> None:
        self.model = model.eval()
        self.tok = tokenizer
        self.cfg = config
        self.stop_ids = {tokenizer.end_turn_id, tokenizer.eos_id}

    def _sample(self, logits: torch.Tensor, produced: List[int],
                generator: torch.Generator | None) -> int:
        logits = logits.float().clone()
        if self.cfg.repetition_penalty and self.cfg.repetition_penalty != 1.0 and produced:
            for tid in set(produced):
                if 0 <= tid < logits.shape[-1]:
                    logits[tid] = logits[tid] / self.cfg.repetition_penalty if logits[tid] > 0 \
                        else logits[tid] * self.cfg.repetition_penalty
        if self.cfg.temperature <= 0:
            return int(torch.argmax(logits).item())
        logits = logits / self.cfg.temperature
        if self.cfg.top_k and self.cfg.top_k > 0:
            k = min(self.cfg.top_k, logits.shape[-1])
            kth = torch.topk(logits, k).values[-1]
            logits = torch.where(logits < kth, torch.full_like(logits, float("-inf")), logits)
        probs = F.softmax(logits, dim=-1)
        if self.cfg.top_p and 0 < self.cfg.top_p < 1.0:
            sorted_probs, sorted_idx = torch.sort(probs, descending=True)
            cum = torch.cumsum(sorted_probs, dim=-1)
            mask = cum - sorted_probs > self.cfg.top_p
            sorted_probs[mask] = 0.0
            probs = torch.zeros_like(probs).scatter(0, sorted_idx, sorted_probs)
            probs = probs / probs.sum().clamp_min(1e-9)
        return int(torch.multinomial(probs, num_samples=1, generator=generator).item())

    @torch.no_grad()
    def stream_ids(self, prompt_ids: Sequence[int]) -> Iterator[int]:
        cfg = self.cfg
        generator = None
        if cfg.seed is not None:
            generator = torch.Generator().manual_seed(cfg.seed)
        input_ids = torch.tensor([list(prompt_ids)], dtype=torch.long, device=next(self.model.parameters()).device)
        produced: List[int] = []
        cache = None
        for step in range(cfg.max_new_tokens):
            cur = input_ids[:, -1:] if cache is not None else input_ids
            out = self.model(cur, cache=cache, use_cache=True, return_logits=True)
            cache = out.cache
            token = self._sample(out.logits[:, -1, :][0], produced, generator)
            produced.append(token)
            if token in self.stop_ids and step + 1 >= cfg.min_new_tokens:
                return
            yield token
            input_ids = torch.cat(
                [input_ids, torch.tensor([[token]], dtype=torch.long, device=input_ids.device)], dim=1)
            if input_ids.shape[1] >= self.model.config.max_seq_len:
                return

    def stream_text(self, prompt_ids: Sequence[int]) -> Iterator[str]:
        """Yield text chunks, buffering partial UTF-8 byte sequences."""
        pending: List[int] = []
        for token in self.stream_ids(prompt_ids):
            pending.append(token)
            # Byte-level BPE can split a multi-byte character; only emit when
            # the decoded string does not end with a replacement char.
            text = self.tok.decode(pending, skip_special_tokens=True)
            if text.endswith("\ufffd"):
                continue
            if text:
                yield text
                pending = []
        if pending:
            tail = self.tok.decode(pending, skip_special_tokens=True)
            if tail:
                yield tail

    def generate(self, prompt_ids: Sequence[int]) -> str:
        return "".join(self.stream_text(prompt_ids)).strip()
