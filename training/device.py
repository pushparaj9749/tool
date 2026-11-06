"""Device / precision selection, GPU-aware.

Why this module exists: on a Tesla T4 (compute capability 7.5) bfloat16 has no
tensor-core support, so `auto -> bf16` is the wrong default there. fp16 with a
GradScaler is both faster and stable on Turing. This module encodes that rule in
one place so training and benchmarking cannot disagree.
"""
from __future__ import annotations

from typing import Dict, Optional

import torch


def pick_device(cfg_device: Optional[str]) -> torch.device:
    if cfg_device in ("auto", None):
        return torch.device("cuda" if torch.cuda.is_available() else "cpu")
    return torch.device(cfg_device)


def gpu_capability(device: torch.device) -> Optional[tuple[int, int]]:
    if device.type != "cuda" or not torch.cuda.is_available():
        return None
    major, minor = torch.cuda.get_device_capability(device)
    return int(major), int(minor)


def supports_bf16(device: torch.device) -> bool:
    """bf16 tensor cores need Ampere (8.0)+ on NVIDIA hardware."""
    cap = gpu_capability(device)
    return bool(cap and cap[0] >= 8)


def pick_dtype(cfg_dtype: str, device: torch.device) -> torch.dtype:
    """Resolve 'auto' to the fastest *stable* dtype for this device.

    cpu            -> fp32
    cuda, cc >= 8  -> bf16   (Ampere+, no loss scaling needed)
    cuda, cc < 8   -> fp16   (Turing/Volta: bf16 is not accelerated -> fp16 + GradScaler)
    """
    if cfg_dtype in ("auto", None):
        if device.type != "cuda":
            return torch.float32
        return torch.bfloat16 if supports_bf16(device) else torch.float16
    mapping = {
        "fp32": torch.float32, "float32": torch.float32,
        "bf16": torch.bfloat16, "bfloat16": torch.bfloat16,
        "fp16": torch.float16, "float16": torch.float16,
    }
    if cfg_dtype not in mapping:
        raise ValueError(f"unknown dtype {cfg_dtype!r}")
    return mapping[cfg_dtype]


def needs_grad_scaler(dtype: torch.dtype, device: torch.device) -> bool:
    """fp16 needs dynamic loss scaling; bf16 and fp32 do not."""
    return device.type == "cuda" and dtype == torch.float16


def make_grad_scaler(dtype: torch.dtype, device: torch.device):
    """GradScaler with the signature that works on this torch version."""
    enabled = needs_grad_scaler(dtype, device)
    try:
        return torch.amp.GradScaler(device.type, enabled=enabled)
    except (TypeError, AttributeError):           # torch < 2.4
        return torch.cuda.amp.GradScaler(enabled=enabled)


def describe_environment() -> Dict[str, object]:
    """Everything the compatibility audit / benchmark report wants to record."""
    info: Dict[str, object] = {
        "torch": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "torch_threads": torch.get_num_threads(),
    }
    if torch.cuda.is_available():
        dev = torch.device("cuda")
        cap = gpu_capability(dev)
        props = torch.cuda.get_device_properties(0)
        info.update({
            "gpu_name": props.name,
            "compute_capability": f"{cap[0]}.{cap[1]}" if cap else None,
            "total_vram_gb": round(props.total_memory / 1e9, 2),
            "bf16_accelerated": supports_bf16(dev),
            "auto_dtype": str(pick_dtype("auto", dev)),
            "grad_scaler_needed": needs_grad_scaler(pick_dtype("auto", dev), dev),
            "cudnn_version": torch.backends.cudnn.version(),
        })
    return info
