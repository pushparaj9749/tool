# ANKIT LLM v0.1

**A Hindi / English / Hinglish conversational language model built completely from scratch.**

Random initialisation → custom byte-level BPE tokenizer → decoder-only Transformer →
causal pretraining → supervised instruction tuning → three personality modes →
evaluation → CLI chat + HTTP API.

> **Status: honest, work-in-progress release.** The full pipeline is implemented, tested and
> reproducible, and real training runs have been executed in this repository. The model is
> **not** a competitive chat model: it was trained on **CPU only** (2 vCPU, 3.8 GB RAM, no GPU)
> for a few million tokens. See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for exactly what is
> done, what is partial, and what is blocked, and [`LIMITATIONS.md`](LIMITATIONS.md) before
> using any output.

---

## What is actually here

| Component | File(s) | Status |
|---|---|---|
| Model architecture (~100M params, RoPE + RMSNorm + SwiGLU, tied embeddings) | `model/` | implemented, tested |
| Measured parameter count | `model/parameter_count.py`, `reports/parameter_count.json` | measured |
| Custom tokenizer (byte-level BPE, 32k vocab, trained from scratch) | `tokenizer/` | trained, tested |
| Dataset pipeline (licence-audited, deduped, split) | `data/`, `data/dataset_manifest.json` | run |
| Pretraining (resume, checkpoints, LR schedule, eval) | `training/pretrain.py` | executed |
| Instruction tuning with masked loss | `training/finetune.py` | executed |
| Inference engine (KV cache, sampling, streaming) | `inference/` | implemented, tested |
| Multi-turn conversation + 3 personalities | `inference/conversation.py` | implemented, tested |
| CLI chat | `inference/chat.py` | working |
| Lightweight HTTP API | `inference/api.py` | working |
| Evaluation suites (LM, chat, languages, personality, engineering) | `evaluation/` | executed |
| Unit tests | `tests/` | 38 passing |

## Quick start (no GPU required for inference)

```bash
bash scripts/setup_environment.sh        # venv + dependencies (CPU wheel)
bash scripts/download_data.sh            # fetch licensed corpora into data/raw/
.venv/bin/python data/prepare_data.py    # normalise / dedupe / split
.venv/bin/python tokenizer/train_tokenizer.py
.venv/bin/python data/build_token_shards.py
.venv/bin/python data/build_sft.py
bash scripts/run_pretraining.sh configs/pretraining_nano.yaml
bash scripts/run_finetuning.sh
bash scripts/run_evaluation.sh
.venv/bin/python inference/chat.py --checkpoint checkpoints/sft-v0.1/final.pt --mode adaptive
```

Chat with the trained checkpoint in Python:

```python
from inference.conversation import ChatEngine

engine = ChatEngine.from_checkpoint("checkpoints/sft-v0.1/final.pt")
answer = engine.chat_once([{"role": "user", "content": "नमस्ते अंकित"}], mode="adaptive")
print(answer)
```

HTTP API:

```bash
.venv/bin/python inference/api.py --checkpoint checkpoints/sft-v0.1/final.pt --port 8000
curl -s localhost:8000/chat -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"Hello ANKIT"}],"personality":"friendly"}'
```

## Documentation map

- [`PROJECT_STATUS.md`](PROJECT_STATUS.md) — phase-by-phase status with evidence
- [`TECHNICAL_SPEC.md`](TECHNICAL_SPEC.md) — architecture, tokenizer, data, training, inference design
- [`ENVIRONMENT_REPORT.md`](ENVIRONMENT_REPORT.md) — hardware, network restrictions, compute options
- [`EXECUTION_LOG.md`](EXECUTION_LOG.md) — chronological log of real runs and results
- [`ROADMAP.md`](ROADMAP.md) — what remains, with concrete compute requirements
- [`MODEL_CARD.md`](MODEL_CARD.md) — model card for the released checkpoint
- [`LIMITATIONS.md`](LIMITATIONS.md) — known limitations (read this)
- `reports/` — machine-generated evaluation reports (JSON)

## Non-negotiables honoured

- No pretrained weights of any kind. `AnkitLM` is randomly initialised (`training/pretrain.py` logs the seed).
- No pretrained tokenizer: the BPE vocabulary is trained on this project's corpus only.
- Every metric in `reports/` was produced by a run in this repository; nothing is hand-written.
- Checkpoints are SHA-256 sidecar-verified; `checkpoints/*` and `data/*` are git-ignored so the
  repository never carries multi-hundred-MB binaries.

## Licence

Code: see [`LICENSE`](LICENSE). Datasets keep their own licences — see
[`data/dataset_manifest.json`](data/dataset_manifest.json).
