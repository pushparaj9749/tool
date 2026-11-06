"""Device/precision selection tests — the rules that keep a T4 from training in bf16."""
import sys
from pathlib import Path

import pytest
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from training.device import (  # noqa: E402
    describe_environment, make_grad_scaler, needs_grad_scaler, pick_device, pick_dtype,
    supports_bf16,
)

CPU = torch.device("cpu")


def test_auto_on_cpu_is_fp32():
    assert pick_dtype("auto", CPU) == torch.float32


def test_explicit_dtypes_resolve():
    assert pick_dtype("fp16", CPU) == torch.float16
    assert pick_dtype("bf16", CPU) == torch.bfloat16
    assert pick_dtype("fp32", CPU) == torch.float32


def test_unknown_dtype_rejected():
    with pytest.raises(ValueError):
        pick_dtype("fp8", CPU)


def test_cpu_has_no_bf16_acceleration():
    assert supports_bf16(CPU) is False


def test_no_grad_scaler_on_cpu_or_bf16():
    assert needs_grad_scaler(torch.float32, CPU) is False
    assert needs_grad_scaler(torch.float16, CPU) is False      # scaler is a CUDA concept here


def test_grad_scaler_is_disabled_when_not_needed():
    scaler = make_grad_scaler(torch.float32, CPU)
    assert scaler.is_enabled() is False


def test_device_selection_auto_matches_availability():
    dev = pick_device("auto")
    assert (dev.type == "cuda") == torch.cuda.is_available()
    assert pick_device("cpu").type == "cpu"


def test_describe_environment_reports_required_fields():
    info = describe_environment()
    assert "torch" in info and "cuda_available" in info
