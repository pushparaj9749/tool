# ANKIT LLM v0.1 — release report

Generated from `reports/*.json` by `evaluation/report_summary.py`. Values are copied verbatim from runs in this repository.

## Model

- Measured trainable parameters: **97,435,392** (97.435M), analytic estimate matches: True
- Architecture: 10 layers, d_model 768, 12 heads, d_ff 2112, vocab 32768

## Training runs (from logs/*-summary.json)

- `ankit-100m-pilot` (run id pilot03-resume): 97435392 params, steps=150, tokens=153600, final val loss=6.846, duration=537.3s, stop=max_steps
- `ankit-nano-pretrain-v0.1` (run id nano01): 11798784 params, steps=1332, tokens=2727936, final val loss=4.763, duration=2409s, stop=time_budget
- `ankit-sft-v0.1` (run id sft02): 11798784 params, steps=189, tokens=—, final val loss=1.863, duration=275.4s, stop=max_steps

## Language modelling

- validation: loss 3.774, perplexity 43.54, docs 1500
- test: loss 3.792, perplexity 44.35

| language | docs | loss | perplexity |
|---|---|---|---|
| hi | 1387 | 3.592 | 36.3 |
| en | 77 | 6.354 | 574.5 |
| mixed | 36 | 5.267 | 193.8 |

## Conversation

- instruction/expectation hit rate: **0.125**
- multi-turn context hit rate: **0**
- mean 3-gram repetition rate: 0
- contradiction probe identical answers: False

| probe | expectation hit | response (truncated) |
|---|---|---|
| greet_en | False | I can be your name to the way. I do not know you like, and my own name or your right? |
| greet_hi | False | मार्ग, सिविल लॉक है और उनकी इलेक्ट्रोने का पता खुद जाता है। |
| instruction_list | True | A / 2)  । |
| explain | False | I am I can be a little to you, and know that I have the next number. |
| math | False | 4) ANP CKK353. |
| clarify | False | P" H35, G. S + 151064) CPE02500 percent of 4-11, 20387) 211224 है, लेकिन लाइन कीमत में स्थ |
| uncertain | False | C / 4! |
| hinglish | False | 8) 25 minutes a new number of KC/NN =0 am not the same. |

## Multilingual

- overall language consistency: **0.889**

| expected language | probes | consistency | mean chars |
|---|---|---|---|
| hi | 3 | 1 | 47.3 |
| en | 3 | 0.667 | 39.7 |
| hinglish | 2 | 1 | 56 |
| roman_hi | 1 | 1 | 39 |

## Personality

- adaptive language match rate: **0.833**
- mode separation (1 - lexical overlap, professional vs friendly): 0.738

| mode | responses | mean chars | formality ratio |
|---|---|---|---|
| professional | 6 | 47.7 | 1 |
| friendly | 6 | 42.5 | 1 |
| adaptive | 6 | 50.5 | 1 |

## Engineering

- reload weight identity: True
- greedy output reproducible across two loads: True
- peak RSS: 787.2 MB; threads: 1
- long context: {'turns': 2, 'dropped_turns': 19, 'history_tokens': 124, 'context_budget': 128, 'still_answers': True}
- 16 new tokens in 0.15s (≈106.72 tok/s, CPU)
- 64 new tokens in 0.471s (≈135.9 tok/s, CPU)
- checkpoints verified: 15 ok, 0 failed integrity

## Data validation

- status: **PASS**
- errors: []
- leakage: {'train_val': 0, 'train_test': 0, 'val_test': 0}
- token shards: {'train': {'tokens': 24100344, 'max_token_id': 32767}, 'val': {'tokens': 402704, 'max_token_id': 32763}}

---

**Interpretation warning.** A passing software test is not evidence of language intelligence. The scores above come from small, deterministic probes over an undertrained model on CPU-only hardware. See `LIMITATIONS.md`.
