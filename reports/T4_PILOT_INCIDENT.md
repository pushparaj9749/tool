# Colab T4 pilot — what actually happened (2026-11-06)

This is an honest record of the first real GPU run, taken from the outputs saved in the
user's `ANKIT_LLM_Colab_T4.ipynb` on Drive (06:11–06:15 UTC) plus the artefacts it left
behind (`gpu_benchmark.json`, `checkpoints/t4-pilot/*`). Nothing here is reconstructed
from memory or estimated.

## What worked on the T4

| step | result |
|---|---|
| environment | Tesla T4, cc 7.5, 15.64 GB, torch 2.11.0+cu130, Python 3.13, driver 580.82.07 |
| dtype selection | `auto → float16` (correct: bf16 is not accelerated on Turing), GradScaler enabled |
| data build | `download_data.sh` + `prepare_data.py` + tokenizer + shards + SFT + validate all passed on Colab: 24,100,344 train / 402,704 val tokens, `status: PASS` |
| benchmark | 24/24 cells measured, best **fp16 / bs8 / seq512 = 16,230 tok/s, 5.08 GB peak, 98.7 % util** |
| training | loss 7.7025 (step 10) → 5.4839 (step 50), **15.4k–16.5k tok/s**, val_loss 6.0989 at step 100 |
| checkpoint write | `step50.pt` + sidecar + `latest.json` + Drive mirror all written (1.2 GB each) |

So the whole CPU→GPU path, the fp16 scaler, the data pipeline and the Drive mirror were
verified on hardware. Throughput measured in training (15.4–16.5k tok/s) matched the
benchmark (16.2k), which is the consistency check we wanted.

## What broke

```
step     50 loss=5.4839 ...
[pretrain] crashed at step 50: Expected all tensors to be on the same device,
           but found at least two devices, cuda:0 and cpu!
  File "training/pretrain.py", line 188, in main
    scaler.step(optimizer)
  File "torch/optim/adam.py", line 705, in _multi_tensor_adam
    torch._foreach_lerp_(device_exp_avgs, device_grads, ...)
RuntimeError: Expected all tensors to be on the same device ...
```

The resume run (`--resume auto`) did resume correctly — `resumed from
checkpoints/t4-pilot/crashed.pt at step 50`, then trained steps 51–100 at 15.7k tok/s —
and crashed again at the next step-50 boundary. That pattern (works until a save, dies on
the step after) was the clue.

## Root cause

`training/checkpoint.py::_optimizer_to_cpu` was written to make checkpoints portable
(CPU-loadable, so a GPU checkpoint can be inspected on a CPU-only machine). It did:

```python
state = optimizer.state_dict()          # shares tensor objects with optimizer.state
for entry in state["state"].values():
    entry[key] = value.detach().cpu()   # ← mutates the LIVE optimizer
```

`Optimizer.state_dict()` does not copy tensors, so this replaced the live Adam moments
(`exp_avg`, `exp_avg_sq`) with CPU tensors. On a CPU-only run that is invisible — the
device is CPU either way, which is why the entire local test suite (50 tests) passed.
On a GPU run the next `optimizer.step()` groups params by device, finds CUDA grads next
to CPU moments and aborts.

Reproduced deterministically on CPU by comparing object identity of the live state
tensors before/after a save: the old implementation mutated them, the new one does not.

## Fix (in this commit)

1. `_to_cpu_copy()` — deep, non-aliasing CPU copy (`obj.detach().to("cpu", copy=True)`)
   used for the saved payload, so the live optimizer is never touched.
2. `move_optimizer_state_to(optimizer, device)` — after `load_state_dict()` on resume,
   every optimizer-state tensor is forced onto the model's device. This also rescues
   checkpoints already written by the buggy build (their moments are CPU-pinned).
3. `pretrain.py` calls it on every resume and logs how many tensors it moved.
4. Regression test `test_save_does_not_mutate_live_optimizer_state` — asserts the save
   path leaves live state objects untouched and that the file still holds CPU copies.
   Verified that this test fails against the old implementation and passes against the new.

## Things this incident changed elsewhere

- `benchmarks/bench_gpu.py` now also sweeps batch **16 / 32** and seq **1024**: the best
  measured cell used only 5.08 GB of 15.6 GB, so the old matrix stopped before the card's
  actual optimum.
- The one-click notebook now (a) `git pull`s an existing clone — otherwise a fixed
  build would never reach a Colab VM that already has `/content/ankit-llm` — and
  (b) streams its output to a live log **inside Drive**, because on the failed run the
  cell produced no visible output at all and the cause had to be dug out of an older
  notebook's saved outputs.
- The autopilot writes `reports/autopilot_error.txt` (and mirrors it to Drive) on any
  crash, so a future failure cannot be invisible.

## State of the checkpoints from that run

`checkpoints/t4-pilot/` contains `step50.pt`, `step100.pt`, `best-step100.pt` and
`crashed.pt` (each ~1.2 GB), plus their JSON sidecars with sha256 hashes. They are
loadable — the model part was always fine — and after this fix they resume cleanly: the
loader casts the CPU-pinned optimizer moments back onto the GPU. Nothing was deleted.

---

# Session 2 (same day, after the checkpoint fix) — OOM at step 1

The crash fix held: the pilot took its first optimiser step with fp16 + GradScaler and
wrote a checkpoint, no device mismatch. It then hit a **second, different** wall:

```
[pretrain] crashed at step 1: CUDA out of memory. Tried to allocate 2.00 GiB.
GPU 0 has a total capacity of 14.56 GiB of which 1.12 GiB is free.
this process has 13.44 GiB memory in use. Of the allocated memory 13.01 GiB is allocated by PyTorch
```

The autopilot had picked **fp16 / bs32 / seq256** because the benchmark reported
`peak_vram_gb: 8.78` for it — the highest tok/s in the whole 54-cell matrix (16,870).

## Root cause of the under-read

`bench_gpu.py` called `torch.cuda.reset_peak_memory_stats()` **after** the warm-up steps,
so `peak_vram_gb` described steady state only. The first real step allocates what the
warm-up already paid for: Adam moments (2 × 97.4M × 4 B ≈ 780 MB), the fp32 cross-entropy
temporaries over an 8,192 × 32,768 logit tensor, and the allocator's first-pass
fragmentation. Real training peaked at 13.44 GB for a config the bench called 8.78 GB —
a **1.53× under-read** that no safety margin of 13.0 GB could absorb.

## Fixes in this commit

1. `bench_gpu.py`: no longer resets the peak counter; reports the **true** peak
   (`peak_vram_gb`, includes the first step) *and* `steady_peak_vram_gb` for comparison.
2. `choose_config()`: the budget is now derived from the actual card
   (`0.80 × total VRAM`) and requires `measured_peak × 1.35` to fit; among the survivors
   it prefers the **longest context** within 5 % of the best throughput, then the fastest.
   On the real 54-cell data this lands on **fp16 / bs16 / seq512 / accum 1** (16,137 tok/s,
   8.78 GB) instead of the 8.78 GB cell that OOM'd.
3. `stage_pilot()`: if the pilot still OOMs it **halves the batch, then the sequence
   length, and retries** (up to 4 attempts), keeping ~8,192 tokens/step. Every attempt is
   written to `reports/autopilot_pilot_attempts.json` and echoed in the summary, so the
   downgrade is visible, not silent. The downgraded config is what the long run then uses.
4. `stage_train()` streams its output as well and records `reports/autopilot_train_status.json`.
5. Training subprocesses get `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True`.
6. **SFT is gated**: a 1-step model is not worth instruction-tuning. Session 2 spent GPU
   time running SFT on `crashed.pt` (a single pretraining step) and produced val_loss 2.637
   and eval numbers that mean nothing. SFT now requires a verified pilot *and* a real
   pretraining checkpoint.

## What session 2 proved anyway

- The device-mismatch fix works on hardware: step 1 completed, no `cuda:0 and cpu` error.
- The honesty guards work: pilot verification failed → resume test skipped → long run
  **refused** with a printed warning, summary + reports still written and mirrored to Drive,
  process exit code 0 (a graceful, explained stop rather than a half-started 2 B-token run).
- 54 benchmark cells measured, including 9 real OOM rows — see
  `reports/gpu_benchmark_t4_measured.md`.

---

# Session 3 — the run stopped at step 400 and nothing said so

## Timeline, reconstructed from the artefacts (not from memory)

| time (UTC) | event | source |
|---|---|---|
| 10:56:56 | notebook cell starts, log file created | Drive log name/mtime |
| — | prepare PASS: 24,100,344 train / 402,704 val tokens, leakage 0 | log |
| — | benchmark 54 cells, all finite; chooser picks fp16/bs16/seq512/accum1 | log |
| 11:11–11:17 | pilot 300 steps, loss 9.5613 → 3.8324, val_loss **5.0357** | log + Drive |
| ~11:17 | resume test **PASS**: `resumed from checkpoints/t4-pilot/final.pt at step 300` | log |
| **11:19:13** | long run `autopilot-full-1119` starts (derived) | 240 s elapsed at step 400 |
| 11:21:05 | step 200 checkpoint written locally (`created_at`) | `step200.json` |
| 11:22:45 | step 200 checkpoint visible on Drive | Drive mtime |
| 11:23:14 | step 400 checkpoint written locally (`created_at`) | `step400.json` |
| **11:23:35** | step 400 on Drive — **the last write of any kind** | Drive mtime |
| — | log's final line: `step    400 loss=4.3542 lr=1.20e-04 gnorm=1.74 tok/s=13655.6 eta=2437.0m` | log (21,803 B, ends here) |

So the long run lived **4.3 minutes**, not hours, and the whole session lasted 27 minutes.
Nothing was written to Drive after 11:23:35Z: no checkpoint, no log line, no summary, no
`autopilot_error.txt`.

## What survived (verified by listing Drive)

| file | step | tokens | Drive id |
|---|---|---|---|
| `t4-full/step400.pt` | 400 | 3,276,800 | `1ij1Tw9wDnTWMLQ_BHKLgLLRkLbnrpO2E` |
| `t4-full/step200.pt` | 200 | 1,638,400 | `1gONUgUZIUHI4_o-i5oQTtY0MCMP1FUKK` |
| `t4-pilot/final.pt` | 320 | 2,621,440 | `15Bytmo2_fWHLqSvH2p2pa9wYLqiSGLnc` |
| `t4-pilot/step300.pt` | 300 | 2,457,600 | `1WoBhHqWl2IrYuyU3xum8j0nBXlsqsWLt` |
| `t4-pilot/best-step300.pt` | 300 | 2,457,600 | `1YObL4NZQXyMHDTyGXZ8mcuHWqQ7PZkd2` |

The "~5,520 steps" figure reported after the session has **no artefact behind it**. If the
GPU really did run on after 11:23:35, then it ran with zero durability - which is the bug
below, and there was no way to see it.

## Correction to an earlier claim in this file

An earlier version of this section said the mirror was ~80 % of wall time and that a 1.27 GB
copy took 5–8 minutes. **That was wrong**, and the numbers disprove it:

* `step200.json.created_at` (11:21:05) → `step400.json.created_at` (11:23:14) = **129.0 s**
  for 200 steps. Pure compute at the measured 14,696 tok/s is 111.5 s → **~17.5 s per copy**.
* The log's own numbers agree: 400 steps in **240 s** total; 223 s of compute + ~17 s of
  copying = **~7 % overhead**.

A 1.27 GB copy at that rate is ~73 MB/s, which is what a healthy Drive mount does. The
async mirror in the previous commit is still worth keeping (it takes the 7 % off the critical
path), but it was never the reason this session lost work.

## The two real bugs

1. **Silent failure with no signal.** From 11:23:35Z nothing persisted, and nothing in the
   system noticed: no heartbeat, no watchdog, one warning line per failed copy inside a
   21 KB log, and the summary is only written at the very end. A run can lose hours while
   the console keeps printing healthy `loss=...` lines.
2. **The mirror leaked Drive quota.** Every new checkpoint pruned an old one, and `unlink`
   on a Drive mount only moves the file to the **trash**, which still counts against the
   quota. Drive currently holds 16 trashed 1.27 GB checkpoints (~20.3 GB) plus 6.35 GB
   live. The full 244,141-step run would have made ~1,220 saves and leaked **~1.5 TB** of
   trash. It only needs ~10 saves to fill a free 15 GB Drive.

## Fixes

1. **One rolling file.** The mirror now overwrites `<run>/latest.pt` (and `latest.json`)
   instead of writing step-tagged files and pruning them. Constant footprint of 1.27 GB per
   run, no trash growth, nothing to clean up.
2. **`heartbeat.json` every 100 steps**: run id, step, tokens_seen, loss, tok/s, and the
   mirror's health. A few hundred bytes, written atomically, and it is the answer to "the
   GPU ran for hours - how far did it actually get?".
3. **Watchdog**: every heartbeat the run compares the current step with what is really on
   Drive and prints a 6-line alarm (`MIRROR IS NOT KEEPING UP`) when the newest mirrored
   checkpoint is more than 600 steps behind, when nothing has landed for 30 minutes, or
   when copies are failing outright.
4. **Loud, retried copies**: 2 retries with 12 s/24 s backoff, size verified after the
   rename, `MIRROR FAILED ... this checkpoint is NOT on Drive` on every permanent failure,
   and a closing banner when a whole session reached Drive zero times.
5. **Preflight probe**: before the long run starts, autopilot writes and deletes a tiny file
   in the mirror directory and refuses to stay quiet if that fails (`Drive is full -> empty
   the Drive trash`).
6. **Restore reports the gap**: on a new VM, the mirror's heartbeat is read and printed next
   to the newest checkpoint step, so "how much did we lose" is answered before training starts.
7. Legacy step-tagged mirrors from the previous build are still resumable (the restore path
   falls back to the highest-step sidecar).

## Verification (CPU-only host, measured)

```
python -m pytest tests/ -q                                   -> 71 passed
python scripts/colab_autopilot.py --self-test                 -> PASS
tests/test_resume_from_mirror_e2e.py                          -> PASS
    sess1 -> [mirror] mirrored step5 -> latest.pt
    (local checkpoints deleted = stopped runtime)
    sess2 -> [mirror] restored latest.pt (tag step5, step 5) -> checkpoints/.../step5.pt
             [pretrain] resumed from ... at step 5
dead-mirror drill (destination blocked, i.e. "Drive full"):
    [mirror] copy of step5.pt failed (attempt 1) ... retrying in 12s
    [mirror] MIRROR FAILED for step5.pt after 3 attempt(s) ... NOT on Drive
    !!! MIRROR IS NOT KEEPING UP — step 5, last checkpoint on Drive: step -1
    [pretrain] NO CHECKPOINT REACHED DRIVE IN THIS SESSION
    heartbeat.json still written -> step 5 survives
    training itself exits 0 (a dead Drive must not kill a healthy run)
```

## What is still not proven

None of this has run on a real T4 yet. The throughput claim is now the modest one that the
measurements support: ~1.7 steps/s, ~7 % mirror overhead, so an 8 h session should reach
~45k steps. Until a GPU session completes with a `heartbeat.json` on Drive, that is an
estimate, not a result.
