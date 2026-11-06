# Model card — ANKIT LLM v0.1

## Overview

| Field | Value |
|---|---|
| Name | ANKIT LLM v0.1 |
| Type | Decoder-only autoregressive Transformer (from scratch, random init) |
| Primary parameters | 97,435,392 (97.44M) — measured, `reports/parameter_count.json` |
| Secondary (CPU pilot) | 11,798,784 (11.80M) — `configs/model_nano.yaml` |
| Languages | Hindi (Devanagari), English, Hinglish / romanised Hindi |
| Personalities | professional, friendly, adaptive (one set of weights, mode-tagged system prompt) |
| Tokenizer | custom byte-level BPE, 32,768 vocab, trained in this repo |
| Context | 512 tokens trained; 384-token prompt budget + 128 generation reserve |
| Released checkpoints | `checkpoints/pretrain-100m/final.pt` (LM), `checkpoints/sft-v0.1/final.pt` (chat) |
| Licence | MIT for code and weights; dataset attributions in `data/dataset_manifest.json` |

## Intended use

- Research and engineering demonstration of a from-scratch Hindi/English/Hinglish LM pipeline.
- Teaching: architecture, tokenizer training, data engineering, pretraining, SFT, evaluation.
- Baseline for anyone continuing training on a GPU.

## Out-of-scope / prohibited use

- Any factual, medical, legal, financial or safety-critical advice.
- User-facing deployment of any kind.
- Presenting outputs as the work of a capable assistant; the model is undertrained.

## Training data

Licence-audited and listed in `data/dataset_manifest.json`:
IITB English–Hindi parallel corpus (MIT repo), Project Gutenberg selections (public domain),
Hinglish-TOP (Apache-2.0), and for SFT, HDRS Hindi dialogue corpus (MIT) plus 61
project-authored seed conversations replicated across three personality modes.

Pipeline: NFKC normalisation → quality filtering → exact dedupe (407,745 removed) →
language tagging → content-hash 98/1/1 split (verified zero leakage) → English capped at
1.15× Hindi. Result: **24,100,344 training tokens**, 402,704 validation, 404,848 test.

## Training procedure as executed

| Run | Model | Steps | Tokens seen | Val loss | Wall clock | Status |
|---|---|---|---|---|---|---|
| `ankit-100m-pilot` | 97.44M | 150 (incl. a real crash→resume at step 50) | 153,600 | 7.34 → **6.85** (ppl 940) | ~9 min @ ~200 tok/s | pilot only |
| `ankit-nano` | 11.80M | 1,332 | 2,727,936 | 6.16 → **4.76** (ppl 117) | ~40 min @ ~1,100 tok/s | CPU reference run |
| `ankit-sft-v0.1` | from nano | 189 (3 epochs, 509 examples) | masked assistant tokens only | **1.863** | ~5 min | executed |

Hardware for all three: 2 vCPU, fp32, no GPU.

Measured language-modelling quality of the released SFT checkpoint (held-out):

| split | loss | perplexity |
|---|---|---|
| validation (1,500 docs) | 3.774 | 43.5 |
| test (1,500 docs) | 3.792 | 44.4 |
| Hindi-only validation | 3.592 | 36.3 |
| English-only validation | 6.354 | 574.5 |

Conversation quality is **poor**: 1/8 single-turn expectation hits, 0/3 multi-turn context
hits (`reports/eval_chat.json`). Raw transcripts: `reports/chat_examples.md`.

A compute-optimal budget for 97.44M parameters is ≈2B tokens. The executed runs are
**0.008%–0.1%** of that. This is why the release is a pilot.

## Evaluation

Machine-generated reports in `reports/` (`eval_lm.json`, `eval_chat.json`,
`eval_languages.json`, `eval_personality.json`, `eval_engineering.json`) plus the assembled
`reports/RELEASE_REPORT.md`. All numbers come from runs in this repository; none are estimated.

What the numbers mean: whether a behaviour *appears* under a small deterministic probe set.
What they do not mean: that the model understands, is correct, or is safe.

## Limitations (summary — full list in `LIMITATIONS.md`)

1. Severely undertrained (CPU-only host); outputs are often ungrammatical or repetitive.
2. SFT set is small and 66% Hindi restaurant-booking dialogues → strong domain/language bias.
3. Personality separation is weak in practice.
4. Context window only; no memory, no retrieval, no tools.
5. No alignment beyond a handful of refusal examples.
6. Evaluation is heuristic, not human-rated.

## Ethical notes

No private or scraped personal data was used. No pretrained weights or tokenizers were used.
Users of these outputs are responsible for not presenting them as reliable knowledge.

## Citation

```bibtex
@misc{ankit_llm_v01_2026,
  title  = {ANKIT LLM v0.1: a from-scratch Hindi/English/Hinglish conversational model (pilot)},
  year   = {2026},
  note   = {97.44M parameters, CPU-trained pilot release, MIT licence}
}
```
