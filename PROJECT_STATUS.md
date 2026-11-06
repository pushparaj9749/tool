# PROJECT_STATUS — ANKIT LLM v0.1

_Last updated: 2026-11-06 (end of build session). Status vocabulary:
**DONE** = implemented, executed and verified here · **PARTIAL** = implemented and executed at
pilot scale only · **BLOCKED** = cannot be completed on this hardware/network · **NOT DONE** = no work yet._

Hardware reality check (measured, `ENVIRONMENT_REPORT.md`): **2 vCPU, 3.8 GB RAM, no GPU,
20 GB disk, restricted egress** (huggingface.co / wikimedia / pytorch CDN blocked).

## Headline measured results (see `reports/`)

| Metric | Value | Source |
|---|---|---|
| Trainable parameters (100M config) | **97,435,392** (97.44M), measured | `reports/parameter_count.json` |
| Tokenizer | custom byte-level BPE, vocab 32,768, 0 UNK on unseen scripts | `tokenizer/`, `logs/tokenizer_training_log.json` |
| Corpus | 24.10M train / 0.40M val / 0.40M test tokens, leakage 0 | `reports/data_validation.json` |
| 100M pilot | 150 steps, 153,600 tokens, val loss 7.34 → **6.85** (ppl 940) | `logs/ankit-100m-pilot-*-summary.json` |
| Nano pretrain | 1,332 steps, 2.73M tokens, val loss → **4.76** (ppl 117) | `logs/ankit-nano-*-summary.json` |
| SFT | 189 steps, masked loss → **1.863** | `logs/ankit-sft-*-summary.json` |
| LM eval (released checkpoint) | val ppl **43.5**, test ppl **44.4** | `reports/eval_lm.json` |
| Chat behaviour | 1/8 single-turn hits, 0/3 context hits | `reports/eval_chat.json` |
| Language consistency | hi 1.00, roman-hi 1.00, en 0.33, hinglish 0.00 | `reports/eval_languages.json` |
| Personality | mode separation 0.738, adaptive language match 0.833 | `reports/eval_personality.json` |
| Engineering | greedy reproducible across loads, 787 MB RSS, ~110-136 tok/s CPU | `reports/eval_engineering.json` |
| Unit tests | **42 passed** | `pytest -q tests/` |

---

## GPU / Colab status (added after the T4 became available)

| Item | Status | Notes |
|---|---|---|
| GPU compatibility audit | **DONE** | 5 real defects found and fixed; see `COLAB_GUIDE.md` §0 |
| T4-aware dtype policy | **DONE** | `training/device.py`: fp16+GradScaler for cc<8.0, bf16 for Ampere+ |
| fp16 loss scaling | **DONE** | scaler in pretrain + finetune, `unscale_()` before clipping, state checkpointed |
| Portable checkpoints (CPU<->GPU) | **DONE** | tensors moved to CPU on save; `map_location` on load |
| Drive mirroring + atomic write + mirror pruning | **DONE** | `mirror_dir`, `.partial` -> rename, keep 3 |
| Colab notebook | **DONE** | `notebooks/ANKIT_LLM_Colab_T4.ipynb` (25 cells, benchmark + gated training) |
| GPU benchmark (fp32/fp16/bf16 x bs1-8 x seq256/512) | **READY, NOT RUN** | `benchmarks/bench_gpu.py`; requires the user's T4 — no GPU exists in this build environment |
| T4 pilot training | **READY, NOT RUN** | `configs/pretraining_colab_pilot.yaml` (300 steps) |
| Full T4 pretraining (~2B tokens) | **GATED** | `configs/pretraining_colab_t4.yaml`, needs explicit approval |

CPU-side training continues in parallel (`checkpoints/pretrain-100m-main/`).

## Phase-by-phase

| Phase | Item | Status | Evidence |
|---|---|---|---|
| 1 | Environment audit | **DONE** | `ENVIRONMENT_REPORT.md`, network probes, torch install logs |
| 2 | Architecture + parameter calculator | **DONE** | `model/`, `reports/parameter_count.json` = 97,435,392 params |
| 2 | Custom tokenizer trained from scratch | **DONE** | `tokenizer/ankit_bpe/`, `logs/tokenizer_training_log.json`, 32,768 vocab |
| 2 | Tokenizer tests incl. round-trip + no-UNK | **DONE** | `tokenizer/tokenizer_tests.py` 7/7 PASS, `tests/test_tokenizer.py` |
| 3 | Dataset pipeline, manifest, statistics | **DONE** | `data/`, `data/dataset_manifest.json`, `data/processed/data_statistics.json` |
| 3 | Data validation (schema, leakage, shards) | **DONE** | `reports/data_validation.json` → PASS, leakage 0/0/0 |
| 4 | Model implementation + unit tests | **DONE** | `tests/` → 38 passed |
| 4 | Reference-free correctness checks (causality, KV cache, tied weights) | **DONE** | `tests/test_architecture.py` |
| 5 | Pilot training run (100M, real) | **DONE** | `checkpoints/pretrain-100m/final.pt`, val loss 7.34→6.85, 153,600 tokens |
| 5 | Resume-from-checkpoint verified in anger | **DONE** | crash at step 50 → `crashed.pt` auto-saved → resumed to step 150 |
| 6 | **Full pretraining of the 100M model to a useful budget** | **BLOCKED** | Needs ~2B tokens on a GPU. 2 vCPU at ~200 tok/s ⇒ ~115 days. Blocker = hardware, not code. |
| 6 | CPU-feasible longer reference run (nano config) | **DONE** | `checkpoints/pretrain-nano/`, `logs/*-summary.json` |
| 7 | Instruction fine-tuning executed | **DONE** | `checkpoints/sft-v0.1/`, `logs/ankit-sft-*-summary.json` |
| 7 | SFT quality (a model that reliably follows instructions) | **PARTIAL** | 543 examples, 11.8M-param base, CPU-only ⇒ behaviour appears, quality low |
| 8 | Evaluation suites (LM / chat / language / personality / engineering) | **DONE** | `reports/eval_*.json`, `reports/RELEASE_REPORT.md` |
| 8 | Human evaluation | **NOT DONE** | Needs human raters; see `ROADMAP.md` #4 |
| 9 | Inference engine, CLI chat, HTTP API | **DONE** | `inference/`, transcripts in `reports/chat_examples.md` |
| 9 | Three personality modes | **PARTIAL** | Implemented + tested functionally; measured separation weak (`reports/eval_personality.json`) |
| 10 | Documentation, model card, limitations, reproduction | **DONE** | this file + README, TECHNICAL_SPEC, MODEL_CARD, LIMITATIONS, ROADMAP, EXECUTION_LOG |

## Definition-of-done checklist (from the assignment brief)

| Requirement | Status |
|---|---|
| Architecture implemented | **DONE** |
| Parameter count measured and documented | **DONE** — 97.44M measured |
| Custom tokenizer trained | **DONE** |
| Model starts from random initialisation | **DONE** — seed recorded per run, no pretrained weights anywhere |
| Actual pretraining executed | **DONE at pilot scale** (153,600 tokens for 100M; nano run longer) |
| Pretraining completed to a *documented useful* criterion | **BLOCKED** (compute) — exact blocker reported below |
| Validation results recorded | **DONE** |
| Instruction fine-tuning executed | **DONE** |
| Chat interface generates responses | **DONE** — see `reports/chat_examples.md` (quality is poor; stated as such) |
| Hindi / English / Hinglish tests run | **DONE** — `reports/eval_languages.json` |
| Three personality modes tested | **DONE (functional) / PARTIAL (quality)** |
| Checkpoint loading and recovery work | **DONE** — tests + a real crash→resume cycle |
| Release documented and reproducible | **DONE** |

**This release is explicitly NOT a fully trained model.** It is a complete, working,
reproducible pipeline with real pilot training runs, published honestly.

## The one blocking issue

Compute. Details in `ENVIRONMENT_REPORT.md` §4:
- 97.44M params × ~20 tokens/param (Chinchilla) ≈ **2B tokens** for a compute-optimal run.
- This host: ~120-200 tokens/s (100M) → **~115-190 days** for that budget.
- A single rented 24 GB GPU (A10/L4/4090) does it in **2-4 days (~15-60 USD)** with zero code
  changes: `bash scripts/run_pretraining.sh configs/pretraining.yaml`.
- Secondary blocker: corpus is 24.1M tokens (not 2B) because HuggingFace/Wikimedia are
  network-blocked in this sandbox. Unblocking egress is the single highest-value fix.

Nothing was fabricated to hide this: every metric in `reports/` is a real measurement, and all
of them reflect an undertrained model.

## What a continuation needs from the human

1. A CUDA machine (any of the options in `ENVIRONMENT_REPORT.md` §4) — or authorisation to rent one.
2. (Optional but important) egress to huggingface.co so the corpus can grow ~100×.
3. Nothing else: the code, configs and scripts are ready.

## Update 2026-11-06 — first real T4 run (measured, and it found a bug)

The user ran the Colab T4 notebook. Results, all measured on hardware:

- **Benchmark:** 24/24 cells, best **fp16 / bs8 / seq512 = 16,230 tok/s, 5.08 GB peak VRAM,
  98.7 % GPU util** — **182× the 89 tok/s CPU baseline**, 3.03× fp32 on the same cell.
- **bf16 is 4.3× slower than fp16 on this T4** (cc 7.5), confirming the dtype logic in
  `training/device.py`. Auto-selection correctly chose fp16 + GradScaler.
- **Pilot training:** 15.4k–16.5k tok/s, loss 7.70 → 4.98, val_loss 6.0989 at step 100,
  checkpoints + Drive mirror written.
- **Then it crashed** at the first checkpoint boundary: `Expected all tensors to be on the
  same device ... cuda:0 and cpu`, because `_optimizer_to_cpu()` mutated the live Adam
  moments while making the checkpoint portable. CPU-only runs could never see it.
  Root cause, evidence and fix: **`reports/T4_PILOT_INCIDENT.md`**. Fixed + regression test
  (`52 passed`); existing `t4-pilot` checkpoints remain usable.
- Full T4 measurements: **`reports/gpu_benchmark_t4_measured.md`**.
