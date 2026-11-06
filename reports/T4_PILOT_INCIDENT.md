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

# Session 3 — the runtime was stopped and the mirror was 13× behind the GPU

## What happened

Session 3 was the first genuine long run. It started at 10:56Z and was healthy:

| evidence | value |
|---|---|
| prepare | PASS (24,100,344 train / 402,704 val tokens, leakage 0) |
| benchmark | 54 cells, all finite |
| auto config | fp16 / bs16 / seq512 / accum 1 = 8,192 tok/step |
| pilot | 300 steps, val_loss **5.0357**, loss 9.5613 → 3.8324 |
| resume test | **PASS** — `resumed from checkpoints/t4-pilot/final.pt at step 300` |
| long run | `autopilot-full-1119`, step 400 reached, loss 4.35, 13.2–14.7k tok/s |

Then the Colab runtime was stopped (accidentally). **Colab wipes `/content` when a
runtime stops.** Everything that was only on the VM's disk is gone.

## What actually survived (verified on Drive, not assumed)

| file | Drive id | step | tokens |
|---|---|---|---|
| `checkpoints/t4-full/step400.pt` | `1ij1Tw9wDnTWMLQ_BHKLgLLRkLbnrpO2E` | 400 | 3,276,800 |
| `checkpoints/t4-full/step200.pt` | `1gONUgUZIUHI4_o-i5oQTtY0MCMP1FUKK` | 200 | 1,638,400 |
| `checkpoints/t4-pilot/final.pt` | `15Bytmo2_fWHLqSvH2p2pa9wYLqiSGLnc` | 320 | 2,621,440 |
| `checkpoints/t4-pilot/{step300,best-step300}.pt` | — | 300 | 2,457,600 |

Last Drive write in `t4-full`: **11:23:35Z**. Nothing newer exists anywhere. Any step
beyond 400 lived only on the VM and is unrecoverable — that is the honest accounting.

## Root cause — the mirror was the bottleneck (bug 3)

`save_checkpoint(..., mirror_dir=...)` copied the **1.27 GB** checkpoint to Drive
**synchronously, inside the training loop**, every 200 steps:

* 200 steps of fp16/bs16/seq512 ≈ **110 s** of GPU time (0.55 s/step)
* one Drive copy through the FUSE mount ≈ **5–8 min**

So ~80 % of the paid session was spent waiting for Drive, and Drive stayed many
checkpoints behind the GPU. Measured effect: ~0.37 steps/s wall clock vs **1.67 steps/s**
pure compute — the run looked ~6× slower than the benchmark promised, and when the
runtime died the newest durable checkpoint was 400 steps while the GPU had gone much
further. `best-step{step}` was mirrored too, doubling the traffic, and the two-mirror
plus prune interaction (`keep=3`) meant the mirror directory only ever held a couple of
snapshots.

## Fixes

1. **`training/mirror.py` — `BackgroundMirror`**: the copy runs on a daemon thread, so the
   GPU loop never waits for Drive. Submissions **coalesce**: only the newest pending
   checkpoint is kept, so the mirror can never fall further behind than one copy no matter
   how slow Drive is (`stats["coalesced"]` counts the ones that were superseded, which is
   correct behaviour, not lost work — local checkpoints keep the full history).
2. **Atomic, self-describing pointer**: `.partial` → `os.replace`, then `latest.json` is
   written last inside the mirror directory. A truncated file can therefore never be
   offered as resumable — `newest_mirrored_checkpoint()` also re-checks the recorded byte
   size before trusting any `.pt`.
3. **Automatic restore on every training entry point**: `stage_train()` calls
   `stage_restore()`, which copies the newest complete checkpoint from Drive back into the
   local directory (repointing `latest.json`, whose `path` still names the old session).
   `training/pretrain.py` repeats the same restore as a second safety net before
   `--resume auto`. A fresh VM can no longer silently restart from step 0.
4. **`--mode resume`**: restore + train only; skips prepare/benchmark/pilot/resume-test.
   The measured config choice is cached on Drive (`reports/autopilot_config_choice.json`)
   so a new VM does not re-benchmark 54 cells. Missing token shards are still rebuilt
   (they are gitignored, so a fresh VM really does not have them).
5. **`best-step{step}.pt` is no longer mirrored** — local only. It doubled Drive traffic and
   made the newest *step* checkpoint lag further behind.
6. **Session budget cap 5.5 h → 8 h** (`MAX_SESSION_SEC = 28800`, still under Colab's ~12 h
   ceiling) with a 420 s tail reserved for the final eval + save + Drive flush. The old cap
   threw away ~2.5 h of GPU time every session.
7. **Pilot `loss_improved` is now honest**: median of the first tenth vs the median of the
   last tenth instead of step 1 vs step N (step 1 of session 3 was a lucky 1.0564 and made
   a perfectly healthy run report `loss_improved: false`).

## Verification (measured, CPU-only host)

```
python -m pytest tests/ -q                       -> 62 passed
python scripts/colab_autopilot.py --self-test     -> PASS
    [self-test] async mirror OK: ['final.pt', 'step3.pt']
    [self-test] chooser on real T4 data -> float16 bs16 seq512 accum1 (16136.6 tok/s, 8.78 GB)
tests/test_resume_from_mirror_e2e.py              -> PASS
    sess1: [mirror] mirrored step5.pt  ->  sess2: [mirror] restored final.pt (step 5)
    [pretrain] resumed from checkpoints/_mirror_e2e/final.pt at step 5
```

The e2e test reproduces the failure exactly: train into a mirror, delete the whole local
checkpoint directory (what a stopped runtime does), run again — it restores from the
mirror and resumes at the mirrored step instead of step 0.

## What is still not proven

The async path has **not** run on a real T4 yet. Until the next GPU session completes,
"the mirror keeps up with the GPU" is a design claim plus a CPU proof, not a measured T4
result. Expected (not measured): with the mirror off the critical path, the run should sit
near the compute rate of ~1.6–1.8 steps/s, i.e. ~45–48k steps in an 8 h session instead of
~5.5k — the full 244,141-step / 2 B-token target then needs ~5–6 sessions.
