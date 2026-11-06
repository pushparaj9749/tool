# ANKIT LLM v0.1 — Tesla T4 benchmark (MEASURED, 54 cells)

Source: `benchmarks/bench_gpu.py --warmup 2 --steps 5` run **on the user's Colab T4**
(2026-11-06, session 2), copied to `MyDrive/ankit-llm/reports/gpu_benchmark.{json,md}`.
Every row below is a real measurement; `oom` means the allocation genuinely failed.

Environment: Tesla T4, cc 7.5, **15.64 GB** (14.56 GiB usable), torch **2.11.0+cu130**,
Python 3.13, cuDNN 92700, driver 580.82.07. Model: **97,435,392 params** (nothing shrunk).

## Results

| dtype | bs | seq | status | s/step | tok/s | peak VRAM (GB) | GPU util % |
|---|---|---|---|---|---|---|---|
| float32 | 1 | 256 | ok | 0.0904 | 2,832 | 1.93 | 85.2 |
| float32 | 2 | 256 | ok | 0.1200 | 4,267 | 1.97 | 96.6 |
| float32 | 4 | 256 | ok | 0.2111 | 4,851 | 2.42 | 98.2 |
| float32 | 8 | 256 | ok | 0.3740 | 5,475 | 3.61 | 99.2 |
| float32 | 16 | 256 | ok | 0.7312 | 5,602 | 6.05 | 99.8 |
| float32 | 32 | 256 | ok | 1.4670 | 5,584 | 10.87 | 100.0 |
| float32 | 1 | 512 | ok | 0.1271 | 4,027 | 1.97 | 97.4 |
| float32 | 2 | 512 | ok | 0.2236 | 4,579 | 2.42 | 97.6 |
| float32 | 4 | 512 | ok | 0.4011 | 5,106 | 3.62 | 100.0 |
| float32 | 8 | 512 | ok | 0.7740 | 5,292 | 6.05 | 100.0 |
| float32 | 16 | 512 | ok | 1.5574 | 5,260 | 10.87 | 99.8 |
| float32 | 32 | 512 | **oom** | — | — | — | — |
| float32 | 1 | 1024 | ok | 0.2430 | 4,214 | 2.42 | 98.4 |
| float32 | 2 | 1024 | ok | 0.4379 | 4,677 | 3.62 | 99.8 |
| float32 | 4 | 1024 | ok | 0.8490 | 4,825 | 6.05 | 99.8 |
| float32 | 8 | 1024 | ok | 1.7124 | 4,784 | 10.87 | 100.0 |
| float32 | 16 | 1024 | **oom** | — | — | — | — |
| float32 | 32 | 1024 | **oom** | — | — | — | — |
| **float16** | 1 | 256 | ok | 0.0814 | 3,143 | 1.92 | 80.4 |
| **float16** | 2 | 256 | ok | 0.0833 | 6,145 | 1.93 | 85.4 |
| **float16** | 4 | 256 | ok | 0.1067 | 9,601 | 2.33 | 90.2 |
| **float16** | 8 | 256 | ok | 0.1600 | 12,804 | 3.26 | 97.0 |
| **float16** | 16 | 256 | ok | 0.2628 | 15,586 | 5.08 | 98.6 |
| **float16** | 32 | 256 | ok | 0.4856 | **16,870** | 8.78 | 99.8 |
| **float16** | 1 | 512 | ok | 0.0839 | 6,103 | 1.93 | 86.2 |
| **float16** | 2 | 512 | ok | 0.1059 | 9,671 | 2.33 | 95.8 |
| **float16** | 4 | 512 | ok | 0.1612 | 12,706 | 3.26 | 97.6 |
| **float16** | 8 | 512 | ok | 0.2798 | 14,637 | 5.08 | 98.6 |
| **float16** | 16 | 512 | ok | 0.5077 | **16,137** | 8.78 | 100.0 |
| **float16** | 32 | 512 | **oom** | — | — | — | — |
| **float16** | 1 | 1024 | ok | 0.1155 | 8,863 | 2.34 | 91.6 |
| **float16** | 2 | 1024 | ok | 0.1679 | 12,197 | 3.26 | 97.8 |
| **float16** | 4 | 1024 | ok | 0.2855 | 14,349 | 5.08 | 99.0 |
| **float16** | 8 | 1024 | ok | 0.5252 | 15,599 | 8.78 | 99.8 |
| **float16** | 16 | 1024 | **oom** | — | — | — | — |
| **float16** | 32 | 1024 | **oom** | — | — | — | — |
| bfloat16 | 1 | 256 | ok | 0.1150 | 2,227 | 1.91 | 95.0 |
| bfloat16 | 2 | 256 | ok | 0.1728 | 2,963 | 1.96 | 97.0 |
| bfloat16 | 4 | 256 | ok | 0.3006 | 3,407 | 2.51 | 98.8 |
| bfloat16 | 8 | 256 | ok | 0.5577 | 3,672 | 3.61 | 99.8 |
| bfloat16 | 16 | 256 | ok | 1.0845 | 3,777 | 5.77 | 99.8 |
| bfloat16 | 32 | 256 | ok | 2.1408 | 3,827 | 10.16 | 99.8 |
| bfloat16 | 1 | 512 | ok | 0.1846 | 2,773 | 2.02 | 98.0 |
| bfloat16 | 2 | 512 | ok | 0.3234 | 3,167 | 2.64 | 99.6 |
| bfloat16 | 4 | 512 | ok | 0.6069 | 3,374 | 3.86 | 100.0 |
| bfloat16 | 8 | 512 | ok | 1.1933 | 3,433 | 6.27 | 100.0 |
| bfloat16 | 16 | 512 | ok | 2.4338 | 3,366 | 11.15 | 99.8 |
| bfloat16 | 32 | 512 | **oom** | — | — | — | — |
| bfloat16 | 1 | 1024 | ok | 0.3761 | 2,723 | 2.89 | 99.8 |
| bfloat16 | 2 | 1024 | ok | 0.7047 | 2,906 | 4.36 | 100.0 |
| bfloat16 | 4 | 1024 | ok | 1.3529 | 3,028 | 7.28 | 99.6 |
| bfloat16 | 8 | 1024 | ok | 2.6229 | 3,123 | 13.17 | 100.0 |
| bfloat16 | 16 | 1024 | **oom** | — | — | — | — |
| bfloat16 | 32 | 1024 | **oom** | — | — | — | — |

54 cells: 45 `ok`, 9 `oom`, no NaN anywhere.

## What this says

1. **fp16 is the only sane dtype on a T4.** Best fp16 cell 16,870 tok/s vs best fp32
   5,602 tok/s = **3.0×**. Best bf16 cell 3,827 tok/s = **4.4× slower than fp16** —
   bf16 remains disabled for cc < 8, as `training/device.py` predicts.
2. **vs the 89 tok/s CPU baseline: 190× faster** (16,870 / 89).
3. **Scaling flattens around 8 GB of VRAM.** bs16/seq512 (16,137) and bs32/seq256
   (16,870) are within 4.5 % of each other while bs32/seq256 is 4.5 % shorter context;
   bs8/seq1024 (15,599) is only 3 % behind bs16/seq512 with 2× the context.
   The autopilot therefore prefers the **longest context within 5 % of the best tok/s**,
   which lands on fp16 / bs16 / seq512 / accum 1 = exactly 8,192 tokens per step.
4. **GPU utilisation is 96–100 %** for every fp16 cell with bs ≥ 8: the GPU is the
   bottleneck, so `num_workers: 0` is fine and there is nothing to win from the loader.
5. **A benchmark peak is not a training peak.** fp16/bs32/seq256 "measured 8.78 GB" and
   then real training OOM'd at **13.44 GB** — a 1.53× under-read, because the old bench
   reset its peak counter after warm-up and so never saw the first-step allocations
   (Adam moments + CE temporaries). `bench_gpu.py` no longer resets, reports both
   `peak_vram_gb` (true) and `steady_peak_vram_gb`, and the autopilot now budgets
   `0.80 × total VRAM` against `peak × 1.35`, with a pilot OOM retry as the backstop.

## Projection for the full run (2.00 B tokens, 244,141 steps × 8,192)

| config | tok/s | wall clock | 8 h sessions |
|---|---|---|---|
| fp16 bs16 seq512 (chosen) | 16,137 | **≈ 34.4 h** | 5 |
| fp16 bs32 seq256 | 16,870 | ≈ 32.9 h | 5 |

Colab free tier gives roughly 8 h of T4 at a time, so the full 2 B-token run needs
**about 5 sessions**; each session resumes from the newest Drive-mirrored checkpoint.
