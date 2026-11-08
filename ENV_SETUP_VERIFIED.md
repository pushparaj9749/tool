# ENV_SETUP_VERIFIED — fresh-sandbox install and verification

_Verified: 2026-11-08, in a clean checkout of this repo (Python 3.11.2, Debian, 2 vCPU,
3.9 GB RAM, **no GPU**, `download.pytorch.org` unreachable but PyPI reachable)._

This file records the exact install that was performed and the evidence that the whole
CPU pipeline actually runs — not just that it imports.

## 1. What was installed

```bash
python3 -m venv .venv
.venv/bin/pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
# optional extras used only by benchmarks/bench_gpu.py and scripts/import_checkpoint.py
.venv/bin/pip install psutil pynvml google-api-python-client google-auth-httplib2 google-auth
```

Resolved versions (`.venv/bin/pip freeze`):

| Package | Version | Why |
|---|---|---|
| torch | 2.15.0 (+cu132, runs CPU-only) | model, training, inference |
| numpy | 2.4.6 | uint16 token shards, memmap batching |
| tokenizers | 0.23.3 | load the trained byte-level BPE |
| PyYAML | 6.0.3 | every config in `configs/` |
| sentencepiece | 0.2.3 | optional baseline tokenizer experiment |
| pytest | 9.2.0 | `tests/` |
| psutil | 7.2.2 | CPU RSS in `benchmarks/bench_gpu.py` |
| pynvml | 13.0.1 | GPU utilisation in `benchmarks/bench_gpu.py` (no-op on CPU) |
| google-api-python-client / google-auth / google-auth-httplib2 / httplib2 | 2.201.0 / 2.62.1 / 0.4.4 / 0.32.1 | `scripts/import_checkpoint.py`, Drive restore |

Notes:

- `download.pytorch.org` is blocked here, so the **PyPI `torch` wheel** was used
  (CUDA runtime bundled, no device present). `torch.cuda.is_available()` is `False` and every
  script correctly falls back to CPU — the same situation documented in `ENVIRONMENT_REPORT.md`.
- `.venv/` is already in `.gitignore`; nothing from the install enters git.
- Disk after install: **10.0 GB free of 21.8 GB** (torch + CUDA deps ≈ 6 GB).
- `torch.get_num_threads()` reports 2; one run logged 1 thread on the first start.

## 2. Verification evidence

| Check | Command | Result |
|---|---|---|
| Import + device audit | inline torch audit | `torch 2.15.0+cu132`, `cuda False / 0 devices`, threads 2, 10.0 GB free |
| Tokenizer round-trip / no-UNK | `.venv/bin/python tokenizer/tokenizer_tests.py` | `7/7 PASS`, `total failures=0`, chat encoding 31 tokens / 13 supervised |
| Unit test suite | `.venv/bin/python -m pytest -q tests/` | **103 passed**, 2 warnings, 32 s |
| Autopilot orchestration | `.venv/bin/python scripts/colab_autopilot.py --self-test` | `PASS — orchestration wired correctly` (dtype chooser picks fp16 bs16 seq512 from real T4 data) |
| Model + tokenizer + generation | smoke script (tiny 4.60M model) | greedy reproducible across loads; **KV-cache output == no-cache output**; chat template `<bos><|user|>…<|end|><|assistant|>` correct |
| Pretraining loop (real) | `training/pretrain.py` on 98k-token shards, 11.80M model | 24 steps, `loss 3.49 → 6.35`, val `8.54 → 6.32`, ~950–1,370 tok/s, `stop=max_steps` |
| Checkpoint + **resume** | re-ran same config with `resume: auto` | `resumed from .../final.pt at step 18` → ran to 24, LR schedule continued correctly |
| Instruction tuning | `training/finetune.py`, masked loss | `462 train / 39 val`, loss `1.51`, `sft_val_loss=7.26`, checkpoint written |
| HTTP API | `inference/api.py` + curl | `GET /health` 200, `GET /modes` 200, `POST /chat` 200, `POST /chat/stream` chunked 200 |
| Benchmark harness | `benchmarks/bench_gpu.py --help` | parses CLI (24-cell sweep needs the user's T4) |

The smoke model produces gibberish text, which is the **expected** result for random /
barely-trained weights — this run verifies plumbing, not quality.

### Caveats worth knowing

- Running `evaluation/evaluate_chat.py` **overwrites** the committed
  `reports/eval_chat.json`. That file holds the measured release numbers, so it was restored
  with `git checkout -- reports/eval_chat.json` after the smoke run. Use
  `git stash`/`git checkout` around evaluation runs on a real checkpoint, or point the
  evaluator at a scratch output path.
- `--resume never` is treated as a **checkpoint path**, not a flag; the accepted values are
  `auto`, `none`, `false`, or an explicit `.pt` path. `--resume never` fails with a bare
  `FileNotFoundError: 'never'` rather than a usage message.
- Large artefacts (`data/processed/*.bin`, `data/processed/*.jsonl`, `checkpoints/*`) are
  git-ignored and were **not** in the checkout. The smoke runs rebuilt small shards from
  `data/sft/sft_train.jsonl` into `/tmp`, so nothing large was added to the repo.

## 3. Reproduce from scratch

```bash
bash scripts/setup_environment.sh          # venv + requirements (this is what was run)
.venv/bin/pip install psutil pynvml google-api-python-client google-auth-httplib2  # optional
.venv/bin/python -m pytest -q tests/       # expect: 103 passed
.venv/bin/python tokenizer/tokenizer_tests.py
.venv/bin/python scripts/colab_autopilot.py --self-test
```

To reproduce the training smoke test, build small shards first (the real
`data/processed/pretrain_*.bin` files are git-ignored):

```bash
.venv/bin/python data/build_token_shards.py    # only if data/processed/pretrain_*.jsonl exists
.venv/bin/python training/pretrain.py --config configs/pretraining_nano.yaml --time-budget-sec 300
```
