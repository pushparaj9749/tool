# ENVIRONMENT_REPORT — ANKIT LLM v0.1

Audit performed: 2026-11-06 (session start). Everything below was measured in the sandbox, not assumed.

## 1. Hardware actually available

| Resource | Measured value | Command used |
|---|---|---|
| CPU | **2 vCPU** (`nproc` = 2) | `nproc` |
| RAM | **3.8 GiB total, 3.6 GiB available**, no swap | `free -h` |
| GPU | **none** — `nvidia-smi: command not found`, `torch.cuda.device_count() == 0` | `nvidia-smi`, torch audit |
| Disk | 21 GB total, **20 GB free** at start | `df -h` |
| OS / Python | Debian (glibc), **Python 3.11.2**, pip 23.0.1, PEP-668 managed env | `python3 --version` |

Consequence: **full 100M-parameter pretraining is not feasible on this host.** A single
fused step of the 100M model (4 × 512 tokens, fwd+bwd) costs several seconds on 2 vCPUs,
and AdamW state for 100M parameters needs ~1.6 GB on top of activations in a 3.8 GB box.
Budget arithmetic for a *useful* run (Chinchilla-style ≈ 20 tokens/parameter = 2B tokens)
on this host: at ~150 tokens/s that is **~370 days**. This is the primary blocker recorded in
`PROJECT_STATUS.md`.

## 2. Software environment

Installed into `.venv` (git-ignored):

```
torch 2.8.0            (CPU execution; wheel came from PyPI, CUDA runtime present but no device)
tokenizers 0.23.3
numpy, pyyaml, sentencepiece, pytest 9.2.0
```

Notes:
- `download.pytorch.org` is **blocked**, so the CPU-only wheel index could not be used; the
  regular PyPI `torch` wheel was installed instead and runs fine in CPU mode.
- `torch==2.2.2 --no-deps` fails (`OSError: libcudart.so.12`), so the CUDA dependency set was
  installed and only CPU execution is used.

## 3. Network access — exact restrictions (measured)

`curl -s -o /dev/null -w '%{http_code}'` per host:

| Host | Result |
|---|---|
| `pypi.org` | **200** |
| `files.pythonhosted.org` | reachable |
| `github.com`, `codeload.github.com`, `api.github.com` | **reachable (git clone works)** |
| `registry.npmjs.org` | reachable |
| `huggingface.co` | **blocked (000)** |
| `raw.githubusercontent.com` | **blocked (000)** |
| `download.pytorch.org` | **blocked (000)** |
| `dumps.wikimedia.org` | **blocked (000)** |
| `www.gutenberg.org` | **blocked (000)** |

Source: the execution platform's egress allowlist for this sandbox. This is an infrastructure
restriction, not a policy choice of this project. Mitigation used: every dataset was obtained
through GitHub (`git clone` of a repository that redistributes the corpus under a stated
licence). Where a permissive alternative could not be reached through GitHub, the source was
**dropped rather than replaced with fabricated text** — see `data/dataset_manifest.json`.

Workarounds deliberately **not** used: no scraping of blocked hosts via proxies, no
claims of "equivalent quality" from synthetic substitutes.

## 4. Cloud GPU options and what they would cost

No cloud credentials were provided to this session, and none were purchased or provisioned
(explicitly out of scope without authorisation). The pipeline is GPU-ready
(`device: auto`, bf16 autocast, `torch.cuda.max_memory_allocated` logging). What a real run needs:

| Option | Typical spec | What ANKIT v0.1 needs | Indicative cost |
|---|---|---|---|
| Colab / Kaggle free tier | T4 16 GB, session limits | fine for 100M pilot + SFT; sessions expire | free (rate-limited, no guaranteed uptime) |
| Single rented GPU (A10/L4/4090, 24 GB) | 1 GPU | ~2B tokens in ~2-4 days at 100M params | ~0.3-0.6 USD/h → ~15-60 USD |
| RTX 3090/4090 owned hardware | 24 GB | same as above | electricity only |

To use one of these you only need to supply a machine with CUDA + this repo; no code changes:
`bash scripts/run_pretraining.sh configs/pretraining.yaml`.

## 5. What this means for the deliverables

- Architecture, tokenizer, data pipeline, training loop, SFT, evaluation, inference, API and
  tests are **complete and verified on this host**.
- Real (not simulated) training runs were executed at the scale this host allows: a 100M-model
  pilot and a longer nano-model run, both producing checkpoints and measured metrics.
- Nothing in `reports/` is fabricated; anything that could not be measured is marked
  `blocked_by_infrastructure` in `PROJECT_STATUS.md`.
