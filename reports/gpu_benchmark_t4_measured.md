# ANKIT LLM v0.1 — Tesla T4 benchmark (MEASURED, not estimated)

Source of truth: `reports/gpu_benchmark.json` / `gpu_benchmark.md` produced **on the user's
Colab T4** by `benchmarks/bench_gpu.py` on 2026-11-06 06:13 UTC, and copied by hand into
`MyDrive/ankit-llm/reports/`. Nothing in this file is extrapolated except the explicitly
labelled "projection" section at the bottom.

## Environment actually measured

```json
{
  "torch": "2.11.0+cu130",
  "cuda_available": true,
  "gpu_name": "Tesla T4",
  "compute_capability": "7.5",
  "total_vram_gb": 15.64,
  "bf16_accelerated": false,
  "auto_dtype": "torch.float16",
  "grad_scaler_needed": true,
  "cudnn_version": 92700,
  "driver": "580.82.07"
}
```

Parameters under test: **97,435,392** (full 100M architecture — nothing shrunk).
Warm-up 2 steps, **6 timed steps** per cell, 4 batch sizes × 2 seq lengths × 3 dtypes.

## Results (s/step · tokens/s · peak VRAM · GPU util · last loss)

| dtype | batch | seq | s/step | tokens/s | peak VRAM (GB) | GPU util % | loss (last) | finite |
|---|---|---|---|---|---|---|---|---|
| float32 | 1 | 256 | 0.0864 | 2,963 | 1.93 | 90.5 | 8.3788 | yes |
| float32 | 2 | 256 | 0.1202 | 4,260 | 1.97 | 97.0 | 8.8373 | yes |
| float32 | 4 | 256 | 0.2092 | 4,895 | 2.42 | 98.2 | 8.3629 | yes |
| float32 | 8 | 256 | 0.3749 | 5,463 | 3.61 | 99.8 | 8.7612 | yes |
| float32 | 1 | 512 | 0.1250 | 4,097 | 1.97 | 97.5 | 8.2261 | yes |
| float32 | 2 | 512 | 0.2198 | 4,659 | 2.42 | 98.0 | 8.8108 | yes |
| float32 | 4 | 512 | 0.3935 | 5,205 | 3.62 | 99.8 | 8.2098 | yes |
| float32 | 8 | 512 | 0.7639 | 5,362 | 6.05 | 100.0 | 8.5033 | yes |
| **float16** | 1 | 256 | 0.0787 | 3,251 | 1.92 | 70.2 | 8.3788 | yes |
| **float16** | 2 | 256 | 0.0917 | 5,581 | 1.93 | 75.7 | 8.8373 | yes |
| **float16** | 4 | 256 | 0.1045 | 9,803 | 2.33 | 89.3 | 8.3629 | yes |
| **float16** | 8 | 256 | 0.1500 | 13,654 | 3.26 | 97.8 | 8.7613 | yes |
| **float16** | 1 | 512 | 0.0814 | 6,288 | 1.93 | 81.5 | 8.2261 | yes |
| **float16** | 2 | 512 | 0.1009 | 10,152 | 2.33 | 96.0 | 8.8107 | yes |
| **float16** | 4 | 512 | 0.1556 | 13,160 | 3.26 | 96.3 | 8.2098 | yes |
| **float16** | 8 | 512 | **0.2524** | **16,230** | **5.08** | **98.7** | 8.5033 | yes |
| bfloat16 | 1 | 256 | 0.1097 | 2,334 | 1.91 | 96.7 | 8.3786 | yes |
| bfloat16 | 2 | 256 | 0.1649 | 3,105 | 1.96 | 97.7 | 8.8371 | yes |
| bfloat16 | 4 | 256 | 0.2832 | 3,616 | 2.51 | 98.3 | 8.3630 | yes |
| bfloat16 | 8 | 256 | 0.5220 | 3,923 | 3.61 | 100.0 | 8.7610 | yes |
| bfloat16 | 1 | 512 | 0.1728 | 2,962 | 2.02 | 98.0 | 8.2254 | yes |
| bfloat16 | 2 | 512 | 0.3026 | 3,384 | 2.64 | 99.0 | 8.8109 | yes |
| bfloat16 | 4 | 512 | 0.5559 | 3,684 | 3.86 | 100.0 | 8.2100 | yes |
| bfloat16 | 8 | 512 | 1.0792 | 3,795 | 6.27 | 99.8 | 8.5033 | yes |

No OOM and no NaN appeared anywhere in this matrix — every row is a real measurement.

## What the numbers say

1. **fp16 wins, and by a lot.** 16,230 tok/s vs 5,362 tok/s in fp32 at the same
   batch/seq = **3.03×**. Peak VRAM actually *drops* (5.08 GB vs 6.05 GB).
2. **bf16 is the worst option here**, exactly as `training/device.py` predicted for
   compute capability 7.5: 3,795 tok/s, i.e. 4.3× slower than fp16 and slower than fp32.
   Never enable bf16 auto-selection on a T4.
3. **fp16 needs the GradScaler** (`grad_scaler_needed: true`) — and it was used; all 8
   fp16 cells produced finite losses, no overflow, scale stayed healthy.
4. **VRAM is not the limit.** The best cell only used 5.08 GB of 15.64 GB. The old matrix
   stopped at batch 8, so it never tested the region the card can actually afford.
   `benchmarks/bench_gpu.py` now also sweeps **batch 16 and 32 and seq 1024**, so the
   autopilot can find the real optimum instead of stopping at 8.
5. **Speed vs the CPU baseline:** 16,230 / 89 = **182× faster** than the 89 tok/s
   local CPU baseline.
6. GPU utilisation is 96–100 % for every fp16 cell of batch ≥ 4 — the GPU is the
   bottleneck, not the data loader, so `num_workers: 0` is fine on Colab.

## Projection for the full run (explicitly a projection)

| run | tokens | at 16,230 tok/s | sessions of ~7.5 h |
|---|---|---|---|
| pilot, 300 steps × 8,192 | 2.46 M | **~2.5 min** | 1 |
| full, 244,141 steps × 8,192 | 2.00 B | **~34 h** | 5 |
| SFT, 3 epochs on 462 conversations | ~2.6 M | **~3 min** | 1 |

If the wider benchmark finds batch 16 or 32 at seq 512 (likely, given 5 GB of 15.6 GB
used), the full run drops well below 34 h. The autopilot recomputes these numbers from
its own measurement, so this table is only a sanity check.

## Colab environment caveat

The T4 run reported **torch 2.11.0+cu130** with **Python 3.13**, while this repo's
`requirements.txt`/`ENVIRONMENT_REPORT.md` were written against torch 2.8.0 on Python
3.11. The measured run is evidence that the training code runs unmodified on the newer
stack (`torch.autocast`, `torch.amp.GradScaler`, checkpoint load all worked), but the
pinned versions in `scripts/setup_environment.sh` remain the *reproducible* reference;
Colab's preinstalled torch is intentionally not downgraded there.
