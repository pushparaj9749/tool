"""Batching for packed uint16 token shards."""
from __future__ import annotations

from pathlib import Path
from typing import Iterator, Tuple

import numpy as np
import torch


class PackedTokenDataset:
    def __init__(self, bin_path: str | Path) -> None:
        self.bin_path = Path(bin_path)
        if not self.bin_path.exists():
            raise FileNotFoundError(f"token shard missing: {self.bin_path}")
        self.tokens = np.memmap(self.bin_path, dtype=np.uint16, mode="r")
        self.size = int(self.tokens.shape[0])

    def __len__(self) -> int:
        return self.size

    def get_batch(self, batch_size: int, seq_len: int, device: str,
                  generator: torch.Generator | None = None) -> Tuple[torch.Tensor, torch.Tensor]:
        if self.size < seq_len + 2:
            raise ValueError(f"shard too small ({self.size} tokens) for seq_len={seq_len}")
        max_start = self.size - seq_len - 1
        starts = torch.randint(0, max_start, (batch_size,), generator=generator)
        x = torch.empty((batch_size, seq_len), dtype=torch.long)
        y = torch.empty((batch_size, seq_len), dtype=torch.long)
        for i, s in enumerate(starts.tolist()):
            chunk = np.asarray(self.tokens[s:s + seq_len + 1], dtype=np.int64)
            x[i] = torch.from_numpy(chunk[:-1])
            y[i] = torch.from_numpy(chunk[1:])
        return x.to(device), y.to(device)

    def batches(self, batch_size: int, seq_len: int, device: str,
                max_batches: int | None = None,
                seed: int | None = None) -> Iterator[Tuple[torch.Tensor, torch.Tensor]]:
        gen = torch.Generator()
        if seed is not None:
            gen.manual_seed(seed)
        n = max_batches if max_batches is not None else max(1, self.size // (batch_size * seq_len))
        for _ in range(n):
            yield self.get_batch(batch_size, seq_len, device, gen)
