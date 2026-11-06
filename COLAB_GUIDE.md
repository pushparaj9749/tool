# COLAB T4 GUIDE — ANKIT LLM v0.1

Step-by-step guide for training the existing **97,435,392-parameter** model on a free
Colab **Tesla T4** (15 GB VRAM, ~12.7 GB RAM, ~112 GB disk).

> **Nothing about the model changes.** Same architecture, tokenizer, dataset pipeline,
> optimizer and objectives. Only the *runtime* changes.

---

## 0. What was fixed for GPU (compatibility audit results)

| # | Problem found in the repo | Why it breaks on Colab T4 | Fix |
|---|---|---|---|
| 1 | `dtype: auto` resolved to **bf16** on any CUDA device | T4 is Turing (cc 7.5): **no bf16 tensor cores** → slow, and mixed results | `training/device.py` now picks **fp16** for cc < 8.0, bf16 for Ampere+ |
| 2 | Training had **no `GradScaler`** | fp16 without loss scaling → gradient underflow → `nan` loss | added scaler to `pretrain.py` + `finetune.py`, `unscale_()` before clipping, scaler state saved in checkpoints |
| 3 | Checkpoints saved `state_dict()` as-is (CUDA tensors on a GPU host) | Not portable CPU↔GPU; awkward to inspect without GPU | `save_checkpoint()` now moves weights/optimizer state to **CPU** before writing |
| 4 | No persistent storage option | Colab disconnects → all checkpoints lost | `mirror_dir` config: every checkpoint atomically copied to Drive (`.partial` → rename) + mirror pruning to 3 files |
| 5 | Mirror could be left truncated by a disconnect | Corrupt "latest" checkpoint | atomic write + SHA-256 sidecar verification on load |

Empty `data/`, `checkpoints/` are **not** in git (by design, 1.1 GB each). The notebook
gives you two ways to get them onto Colab.

---

## 1. Open the notebook

`notebooks/ANKIT_LLM_Colab_T4.ipynb` — upload it to Colab
(*File → Upload notebook*) or open it from GitHub.

**Runtime → Change runtime type → Hardware accelerator: T4 GPU → Save.**

Then run cells top-to-bottom, **except** the gated full-training cell (keep `RUN_FULL = False`).

The first cell prints `gpu: Tesla T4 | cc: 7.5 | vram GB: 15.4` and
`bf16 accelerated: False` — that is correct and expected.

---

## 2. Get data + tokenizer onto Colab (choose ONE)

### Option A — upload a zip to Drive (recommended, one-time, ~130 MB)

On the machine that has the repo artifacts:

```bash
bash scripts/package_artifacts.sh          # -> ankit-artifacts.zip
# optional: include a checkpoint you want to continue from
bash scripts/package_artifacts.sh --with-checkpoint checkpoints/pretrain-100m-main/final.pt
```

Upload it to **My Drive / ankit-llm / ankit-artifacts.zip** (Colab's file browser or Drive UI).
The notebook's "restore from Drive" cell unpacks it into the repo.

### Option B — rebuild inside Colab (~5-8 min, no upload)

Uncomment/run the "OPTION B" cell. It runs `download_data.sh → prepare_data.py →
train_tokenizer.py → build_token_shards.py → build_sft.py → validate_data.py`.
Downloads come from GitHub (allowed on Colab).

⚠️ Never mix an old checkpoint with a rebuilt tokenizer. The trainer refuses to start if the
tokenizer `vocab_size` != the model `vocab_size`.

---

## 3. Benchmark first (Phase 3) — **do not skip**

Cell: `python benchmarks/bench_gpu.py --out reports/gpu_benchmark --warmup 2 --steps 6`

It tests **fp32 / fp16 / bf16 × batch 1,2,4,8 × seq 256,512** on the real 97.4M model and writes:

* `reports/gpu_benchmark.md` + `.json` (also copied to Drive)
* per config: `seconds_per_step` (median of N timed steps), `tokens_per_second`,
  `peak_vram_gb`, `gpu_utilization_pct`, `system_ram_gb`, every loss, every grad-norm,
  `loss_finite`, and the fp16 `scaler_scale`
* OOM configs appear as `status: oom` — **not** silently dropped

**How to choose the training config from the table**

1. Take the row with the **highest `tokens_per_second`** where `status == ok` and `loss_finite`.
2. `peak_vram_gb` must stay **≤ ~13.5** so validation/checkpointing have headroom.
3. On a T4, fp16 should beat fp32 ~2-3×; bf16 will likely be **slower** — expected, not a bug.
4. If `scaler_scale` collapses to 1.0 or losses are `nan`, drop to fp32 for that batch size.
5. Put the chosen `batch_size` into `configs/pretraining_colab_pilot.yaml`.

Reference points measured on the CPU-only builder host (for the speed comparison):

| Host / config | tokens/s |
|---|---|
| CPU 2 vCPU, fp32, bs2/seq256 | 120 |
| CPU 2 vCPU, fp32, bs1/seq512 | 274 |
| CPU 2 vCPU, fp32, bs2/seq512 | 311 |
| CPU 2 vCPU, **bfloat16 autocast** | **89** ← the "89 tok/s" baseline in the brief |
| T4 fp16 (expected range, **not yet measured**) | ~20,000-30,000 |

The GPU numbers are filled in by running the benchmark cell — the report cannot invent them.

---

## 4. Pilot training (Phase 5, ~2-5 min)

```bash
python training/pretrain.py --config configs/pretraining_colab_pilot.yaml --run-id t4pilot
```

300 steps × 8,192 tokens = ~2.46M tokens. Check:

* every logged loss is finite and trending down
* an `[eval] val_loss=...` line exists
* `checkpoints/t4-pilot/latest.json` has a `sha256`
* `My Drive/ankit-llm/checkpoints/t4-pilot/` contains the mirrored `.pt`

Then the **resume test** cell (`--max-steps 320 --resume auto`) must print
`[pretrain] resumed from ... at step 300`.

---

## 5. Stop and report

Send back: `reports/gpu_benchmark.md` + the pilot log tail. The full run is ~2B tokens
(~19-28 GPU-hours → 2-3 Colab sessions) and must not be started before approval.

---

## 6. Full pretraining (resumable across sessions)

Set `RUN_FULL = True` in the gated cell and run
`configs/pretraining_colab_t4.yaml` (max_steps 244,141 ≈ 2.0B tokens).

**Each new session:** mount Drive → clone repo → restore artifacts → **restore the latest
checkpoint from Drive** (cell provided) → run the same command with `--resume auto`.
The cosine LR schedule is anchored to `max_steps`, so you continue on the same curve.

Colab realities handled:
* `save_every: 200` ≈ every 1.6M tokens (~8-10 min) → at most ~10 min of work lost
* mirror keeps only the 3 newest files (Drive quota is 15 GB)
* a SIGKILL (hard timeout) leaves the last periodic checkpoint valid; a graceful
  interrupt (stop button) checkpoints and exits
* `latest.pt` on Drive is written atomically, so a disconnect mid-copy cannot corrupt it

---

## 7. Instruction tuning + evaluation

```bash
python training/finetune.py --config configs/finetuning_colab_t4.yaml --run-id t4sft
python evaluation/evaluate_lm.py       --checkpoint checkpoints/t4-sft/final.pt
python evaluation/evaluate_chat.py     --checkpoint checkpoints/t4-sft/final.pt
python evaluation/evaluate_languages.py --checkpoint checkpoints/t4-sft/final.pt
python evaluation/evaluate_personality.py --checkpoint checkpoints/t4-sft/final.pt
python evaluation/collect_examples.py  --checkpoint checkpoints/t4-sft/final.pt
python evaluation/report_summary.py    # -> reports/RELEASE_REPORT.md
```

Chat on the GPU (inference is cheap):

```python
from inference.conversation import ChatEngine
eng = ChatEngine.from_checkpoint("checkpoints/t4-sft/final.pt", device="cuda")
print(eng.chat_once([{"role": "user", "content": "नमस्ते अंकित"}], mode="adaptive"))
```

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `CUDA out of memory` at pilot start | batch too large for 15 GB | halve `batch_size`, double `grad_accum_steps` (keeps tokens/step constant) |
| loss becomes `nan` | fp16 without scaler, or lr too high | ensure `dtype: auto` (fp16 + scaler), lower `learning_rate` to 3e-4 |
| `insufficient disk space` | Colab disk full | delete old checkpoints in `checkpoints/`, keep Drive mirror as the archive |
| `tokenizer vocab_size != model vocab_size` | rebuilt tokenizer with an old checkpoint | restore the matching tokenizer, or retrain the model |
| Drive copy very slow / fails | Drive hiccup | training continues, warning printed; the local checkpoint is still authoritative |
| session died at ~12 h | Colab limit | normal — resume in a new session |

---

## 9. What is still missing (honest)

* The GPU benchmark table, peak VRAM and pilot numbers **have not been produced yet** —
  there is no GPU in the environment that built this repo. The notebook produces them, and
  nothing in `reports/` will claim them until then.
* Long-run quality at 100M params is bounded: expect basic grammar and short turns, not a
  ChatGPT-like assistant. See `LIMITATIONS.md`.
