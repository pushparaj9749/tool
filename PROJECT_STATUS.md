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

## Update 2026-11-06 (later) — session 3 stopped at step 400, silently

The first genuine long run reached **step 400 (3,276,800 tokens, loss 4.3542, 13.7k tok/s)**
and the resume path was proven on hardware. Then **everything stopped being written to
Drive at 11:23:35Z**: the last checkpoint, the last log line
(`step 400 loss=4.3542 ... eta=2437.0m`) and the summary all end at the same instant. The
long run had only been alive 4.3 minutes.

**Survived (verified by listing Drive):** `t4-full/{step200,step400}.pt`,
`t4-pilot/{final,step300,best-step300}.pt`. The "~5,520 steps" reported afterwards has no
artefact behind it; if the GPU did run on, it ran with zero durability — which is the bug.

**Correction:** an earlier entry blamed the mirror for ~80 % of wall time. That was wrong.
`step200.json`→`step400.json` `created_at` is 129.0 s for 200 steps against 111.5 s of pure
compute, so a 1.27 GB copy costs **~17 s (~7 %)**, and the log's own 240 s at step 400
agrees. Copies were fast; the mirror was never the bottleneck.

**Two real bugs, both fixed:** (1) silent failure — no heartbeat, no watchdog, one warning
line per failed copy, so a run can persist nothing while the console prints healthy losses;
(2) the mirror leaked Drive quota, because pruning a checkpoint on a Drive mount only moves
it to the **trash**, which still counts — 16 trashed 1.27 GB checkpoints (~20.3 GB) are
sitting there now, and a full 244,141-step run would have leaked ~1.5 TB.

**Fix:** one rolling `latest.pt` (overwrite, never prune), `heartbeat.json` every 100 steps,
a watchdog that shouts when the mirror falls >600 steps behind or goes 30 min without a
successful copy, retries with backoff, size verification after rename, a preflight write
probe, and a restore path that reports "heartbeat says step X, newest checkpoint is step Y".
Verified on CPU: **71 tests passed**, `--self-test` PASS, restore e2e PASS, dead-mirror drill
PASS (training exits 0, heartbeat still lands, alarm printed).

**Not yet proven:** none of it has run on a real T4. `reports/T4_PILOT_INCIDENT.md`
(Session 3) and `reports/SESSION3_RECOVERY.md` hold the full reconstruction.

## Update 2026-11-07 — session 4 saved into the wrong Google account

A run reached **step ~4,800** (loss 2.88, val_loss 3.8075 @4000 → 3.7673 @4500) and its log
showed `[mirror] mirrored stepNNNN.pt` every 200 steps — copies reporting success.

The connected Drive (validated credentials, `ankitmahato4321@gmail.com`) contains **nothing
modified after 2026-11-06T20:00Z**: no `step4800`, no `step4200`, no `heartbeat.json`, still
only `step200/step400` from yesterday, and exactly one `ankit-llm` folder. Both things cannot
be true at once → that Colab session was signed into a **different Google account**, so its
`/content/drive/MyDrive` was a different Drive.

**Fix:** cell 2 now prints `DRIVE ACCOUNT: <email>` and writes `ankit-llm/WHOAMI.txt`; cell 3
echoes it into the mirrored log and lists the checkpoints it actually wrote; the notebook's
build gate now also requires the rolling-mirror + watchdog markers, so the step-tagged build
(no heartbeat, trash leak) is refused.

**Also:** `max_steps` 244,141 → **64,000** (524M tokens ≈ 21.8 epochs over 24.1M tokens),
printed and recorded as `reports/autopilot_training_plan.json` with a >30-epoch warning.
Tests: **72 passed**, `--self-test` PASS.

## Update 2026-11-07 (later) — 60-minute chunks

Long sessions are the thing that keeps dying, so a run is now a **60-minute chunk**:
`SESSION_BUDGET_MIN = 60` → ~53 min of training plus a tail for the final eval, save and
Drive flush, then a clean `stop=time_budget` exit. Each chunk prints
`CHUNK DONE — step X / 64,000 (Y%)`, writes `reports/autopilot_chunk_progress.json`, and the
next chunk is simply the same Cell 3 again (~20-30 s to restore the checkpoint).

To stop a chunk from being eaten by preparation, the built data (tokenizer + 3 token bins +
SFT files, ~50 MB) is now **cached on Drive** with a `manifest.json`; a fresh VM restores it
in seconds instead of re-downloading and re-tokenising for 10-20 minutes. A short or missing
cache file falls back to a rebuild rather than training on bad data.

60 min ≈ ~5,000 steps ⇒ the 64,000-step target is **~12-13 chunks**. Tests: **75 passed**,
`--self-test` PASS.

## Update 2026-11-07 (03:40Z) — the "lost" run was found: step 5,800 is on Drive

Two Google accounts were in play. The checks in this project were made against
`ankitmahato4321@gmail.com` (which really does stop at `step400.pt`), while the Colab run
was signed into **`ankitmahato5533@gmail.com`**, where `ankit-llm/checkpoints/t4-full` holds
`step5600.pt` + **`step5800.pt` + `latest.json` (step 5800)** from 19:56–19:58Z on 2026-11-06.
**Max recoverable step is 5,800, not 400** — the tail was never lost, it was just being read
from the wrong Drive. Full read-out: `reports/DRIVE_AUDIT_2026_11_07.md`.

That run used a **pre-PR#6 checkout** (proof on Drive: 129-byte `latest.json` with only
`mirrored_at`, step-tagged copies, no `latest.pt`, no `heartbeat.json`, no `WHOAMI.txt`, no
`artifacts/` cache), so its mirror is the old synchronous one. Measured from file timestamps:
5,600 steps in 58 min = **1.60 steps/s**, loss `4000 → 3.8075`, `4500 → 3.7673`.

To make that impossible to misread again, every run now writes and prints
**`reports/build_stamp.json`** (local + `Drive/ankit-llm/reports/`): git sha, branch, commit
date, torch/python, and whether the five durability markers are present. `stage_restore()`
also prints the Drive mirror's contents before it decides. Tests: **76 passed**,
`--self-test` PASS (`float16 bs16 seq512 accum1, 16136.6 tok/s, 8.78 GB`).

## Update 2026-11-07 (04:00Z) — training paused at step 5,800; resume proven, not assumed

Training is parked for the day at **step 5,800** (`ankitmahato5533@gmail.com` →
`ankit-llm/checkpoints/t4-full/step5800.pt`, mirrored 19:58:19Z, verified against
`latest.json`: 1,270,001,459 bytes). Nothing else will be trained today; tomorrow continues
from that step.

Three things were finished so that tomorrow is one cell:

1. **The legacy Drive layout is now covered by tests.**
   `tests/test_legacy_drive_layout.py` builds the *exact* 2026-11-06 layout — a 129-byte
   legacy pointer plus step-tagged `step5600.pt` / `step5800.pt`, a stale sidecar and a
   truncated `step6000.pt` — and then runs a real `training/pretrain.py` resume on it.
   Result: `restored step5800.pt … resumed … at step 5800`, truncated copy ignored.
   So the 5,800 steps are not just present on Drive, they are provably resumable.

2. **`notebooks/PASTE_ONE_CELL.py` + a 3-line notebook cell.** The 2026-11-06 session ran a
   three-day-old notebook copy; the launcher lives in git, hard-syncs to `origin/main`,
   verifies `HEAD == git ls-remote origin main`, refuses to run if a durability marker is
   missing, prints the Drive account, picks `resume` from Drive, runs one 60-min chunk and
   prints the measured tail. `git fetch` is no longer best-effort.

3. **`eval_every: 0` no longer crashes** (`step % 0` → ZeroDivisionError, hit while writing
   the resume test). 0 now means "no evals", as intended.

Tests: **78 passed**, `--self-test` PASS.

## Update 2026-11-07 (03:50Z) — parked for the day at step 5,800

Training stopped on purpose after **5,800 steps** (9% of 64,000). Source of truth:
`reports/DAY_END_2026_11_07.md` (also on Drive as
`ankit-llm/reports/DAY_END_2026_11_07.md`). Re-verified on Drive at 03:49Z: `step5800.pt`
1,270,001,459 bytes matching `latest.json`, untouched since 19:58:19Z.

Remaining: 58,200 steps ÷ 1.60 steps/s ≈ 10.1 h GPU ≈ **11 chunks**. Tomorrow = one cell,
`notebooks/PASTE_ONE_CELL.py`, which hard-syncs `origin/main`, proves `HEAD == ls-remote`,
gates on all five durability markers, and prints the Drive account before it trains.

Two bugs were caught by dry-running that launcher against a fresh clone rather than trusting
it: `git ls-remote` output is TAB-separated (`split(" ")` sent `git reset --hard` a bogus
revision), and `MARKERS` as a dict silently dropped one of the two markers inside
`colab_autopilot.py` (the gate said "4"). Both fixed and pinned by tests. **81 passed**,
`--self-test` PASS.

## Update 2026-11-07 (03:55Z) — "can I test the model now?" — yes, one cell

`notebooks/TRY_MODEL.py` loads whatever checkpoint is best (SFT final → local t4-full → newest
on Drive, restored with the same code the trainer uses) and prints what the model continues
with, at two temperatures, plus an optional chat round trip. It writes `reports/model_tryout.md`
and copies it to Drive. No training, no GPU requirement, no artefact download.

Honest expectation, printed in the report itself: step 5,800 ≈ **2 epochs** has learned
spelling, common words and short phrases. It **continues text**, it does not answer questions.
Real chat needs the SFT stage on a much better base, so the notebook's "Chat try karo" snippet is
now marked SFT-only.

Tests: **84 passed** (`test_model_tryout.py` runs the whole path on a tiny CPU checkpoint:
generation, chat mode, and the clear error when no checkpoint exists), `--self-test` PASS.

## Update 2026-11-07 (04:10Z) — GPU quota moved accounts: `scripts/import_checkpoint.py`

Colab's GPU quota is per Google account, but the checkpoint lives in the Drive of the account
that trained. Running the next chunk on a second account would therefore start at step 0 again —
the same accident class as 2026-11-06.

`scripts/import_checkpoint.py` moves the checkpoint between accounts **inside Google's network**
(`files().copy`, ~30-60 s, no bytes through the VM), or by `curl` from a public link as a
fallback. It writes `stepNNNN.pt` + sidecar + `latest.json` in exactly the layout
`newest_mirrored_checkpoint()` reads, is idempotent, and refuses to write to the source account.
`ANKIT_DRIVE_DIR` now overrides the Drive root in both `colab_autopilot.py` and
`PASTE_ONE_CELL.py` (second account, shared folder, hand-made shortcut).

Why the checkpoint is **not** on git: repo files are hard-blocked at 100 MB (this one is 1.27 GB),
LFS free tier is 1 GB/month, and Releases would mean a fresh 1.27 GB upload every chunk
(~14 GB across 11 chunks) with a token. Measured trade-off and the 3-step sharing procedure:
`reports/NEW_ACCOUNT_MIGRATION.md`.

Tests: **91 passed** (7 new for import: link parsing, newest-file selection, pointer shape,
resumable-layout integration, idempotency, env override), `--self-test` PASS.
