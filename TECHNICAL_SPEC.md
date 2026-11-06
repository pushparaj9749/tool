# TECHNICAL_SPEC — ANKIT LLM v0.1

## 1. Architecture

Decoder-only autoregressive Transformer, implemented in `model/` with no third-party model code.

| Choice | Value (100M config) | Rationale |
|---|---|---|
| Layers | 10 | parameter budget at d_model=768 |
| d_model | 768 | width that keeps 12 heads × 64 dims |
| Heads | 12 (head_dim 64) | standard ratio |
| FFN | SwiGLU, d_ff = 2112 | better quality/parameter than GELU MLP at equal FLOPs |
| Norm | RMSNorm (pre-norm), eps 1e-5 | no mean-centering, cheaper, stable at depth 10 |
| Position | **RoPE** (theta 10000), applied to Q/K | zero parameters, better length behaviour than learned positions |
| Attention | causal MHA via `F.scaled_dot_product_attention(is_causal=True)` | fused kernel, no custom CUDA |
| Biases | none | saves ~0.1M params, improves stability |
| Embeddings | input embedding **tied** to output projection | saves 25.2M parameters, helps small models |
| Dropout | 0.0 (pretrain), configurable | dataset is small; dropout would slow convergence |
| Init | N(0, 0.02), residual projections scaled by 1/sqrt(2·L) | GPT-2 style stability |
| Vocab | 32,768 | fits uint16 shards; Hindi+English+Hinglish BPE |

**Measured parameter count** (`python model/parameter_count.py --model-config configs/model.yaml`):

```
embedding (tied) : 25,165,824
per block        : 7,227,648   (attn 2,359,296 + mlp 4,866,048 + norms 1,536)
blocks x 10      : 72,276,480
final norm       : 768
output projection: 0 (tied)
TOTAL            : 97,435,392  (97.44M)   analytic estimate matches measured: True
```

Deviation from 100M: −2.56%. Documented, not hidden: going to 100.0M would need either
d_ff≈2300 (odd/unfriendly) or 10.4 layers. 97.4M sits inside the "approximately 100M" target
and keeps every parameter used by the forward pass.

Second, smaller configuration `configs/model_nano.yaml` (11.80M params) exists purely as the
CPU-feasible pilot; it is never presented as the 100M model.

## 2. Tokenizer

Byte-level BPE (HuggingFace `tokenizers` BPE *trainer* only; the vocabulary is learned from
this project's corpus, nothing is imported).

- Vocab 32,768, specials: `<pad> <unk> <bos> <eos> <|system|> <|user|> <|assistant|> <|end|>`
- `initial_alphabet` = all 256 bytes → **no `<unk>` is possible for any Unicode input**
  (verified in `tests/test_tokenizer.py::test_no_unknown_tokens_for_unseen_unicode`).
- Byte-level was chosen over SentencePiece/BPE-on-codepoints specifically because Devanagari
  combining marks, Hinglish Latin text and emoji all share one lossless representation.
- Chat template:
  `<bos><|system|>…<|end|><|user|>…<|end|><|assistant|>…<|end|>`
- Training corpus: 63 MB mixed-language sample (Hindi 45%, English 35%, Hinglish 20%).
- Round-trip and special-token behaviour verified by `tokenizer/tokenizer_tests.py`.

## 3. Data

Sources and licences: `data/dataset_manifest.json`. Pipeline (`data/prepare_data.py`):

1. NFKC normalisation, whitespace collapse, control-char and replacement-char removal
2. quality filters: length, alpha-ratio, word count, repetition, script consistency
3. **exact dedupe** via blake2b of the normalised text (407,745 duplicates removed)
4. script-based language tagging (Devanagari / Latin / Hinglish-marker heuristic / mixed)
5. **content-hash split** (98/1/1) → no leakage by construction (verified: 0 overlap)
6. English capped at 1.15× Hindi (646,585 English records thinned deterministically)

Result: 697,520 train documents → **24,100,344 train tokens**, 402,704 val tokens, 404,848 test tokens.

Instruction data (`data/build_sft.py`): 183 authored seed examples (61 conversations ×
3 personality modes) + 360 HDRS Hindi dialogues → 509 train / 34 val, assistant-masked loss.

## 4. Training

`training/pretrain.py`:
- AdamW (β 0.9/0.95, wd 0.1 on matrices only — norms/embeddings excluded)
- cosine schedule with linear warmup (`training/scheduler.py`)
- gradient clipping 1.0, gradient accumulation, bf16 autocast when CUDA is present
- validation every N steps (loss + perplexity), best-checkpoint retention
- atomic checkpoint writes + SHA-256 sidecars + `latest.json` pointer + retention pruning
- resume from checkpoint (`--resume auto`), SIGINT/SIGTERM → checkpoint-then-exit
- per-run config snapshot, seed, run id, JSONL metric log, throughput/ETA, storage check

`training/finetune.py`: masked SFT (loss only on assistant tokens), personality system prompts,
same checkpoint machinery, separate validation loss.

Scaling law note: for 97.4M params a Chinchilla-style budget is ≈2B tokens. The 24.1M-token
corpus is therefore only ~1.2% of a compute-optimal budget even if fully consumed — which is
why the release is labelled a pilot (see `PROJECT_STATUS.md`).

## 5. Inference

`inference/generate.py`: KV-cached token-by-token decoding, temperature, top-k, top-p,
repetition penalty, stop tokens, UTF-8-safe streaming.
`inference/conversation.py`: multi-turn state, context budgeting (drops oldest turns and
counts them), three personality modes via mode-tagged system prompts, refusal to switch mode
mid-conversation, batch inference. Memory = context window only; no long-term memory claim.

## 6. Evaluation

`evaluation/` produces JSON in `reports/`:
- `evaluate_lm.py` — held-out loss / perplexity per language (val + test), next-token probes
- `evaluate_chat.py` — instruction-following hits, multi-turn context probes, contradiction probe,
  3-gram repetition rate, raw generations
- `evaluate_languages.py` — script/language consistency for hi/en/hinglish/roman-Hindi + switching
- `evaluate_personality.py` — mode separation, formality markers, adaptive language matching
- `evaluate_engineering.py` — checkpoint inventory/integrity, reload determinism, greedy
  reproducibility across loads, decoding speed, RSS, long-context behaviour

Every report embeds a `note` describing what the metric does *not* prove.

## 7. Reproducibility

- seeds recorded per run (`seed` in config, saved in the run snapshot)
- config snapshot + dataset statistics + token shard report written next to the logs
- dataset acquisition pinned to GitHub repos (no moving `main` tags are used for scoring; the
  clone date is recorded in the manifest)
- checkpoints carry their own `model_config` so inference never guesses hyper-parameters
