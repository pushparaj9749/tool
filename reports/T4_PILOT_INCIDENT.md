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
