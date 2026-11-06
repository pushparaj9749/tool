# Known limitations — read before using ANKIT LLM v0.1

These are measured facts about this release, not caveats added for form.

## 1. The model is heavily undertrained
- Architecture target: 97.44M parameters. A Chinchilla-style budget is ≈2B tokens.
- Actual corpus: 24.1M train tokens (≈1.2% of that budget) and, on this CPU-only host,
  only a small fraction of the corpus was seen during the executed runs.
- Consequence: responses are frequently ungrammatical, repetitive, or off-topic. Validation
  perplexity is high (see `reports/eval_lm.json` for the number — it is not hidden).
- **Do not treat any output as factual.**

## 2. Compute restriction, not a modelling failure
No GPU was available (2 vCPU / 3.8 GB RAM). The full training run spec exists
(`configs/pretraining.yaml`) and needs a single 24 GB GPU. Until then this is a **pilot**.

## 3. Data is small and domain-narrow
- Hindi text comes largely from IITB sentence pairs (translation-flavoured, short sentences).
- English includes 20 public-domain Gutenberg books + IITB English side.
- Hinglish is ~53k short task-oriented utterances (Hinglish-TOP) — not conversational Hinglish.
- HuggingFace/Wikimedia corpora were **network-blocked**, so the corpus is ~100× smaller than
  it should be. See `ENVIRONMENT_REPORT.md` §3.

## 4. Instruction tuning is thin
543 SFT examples (509 train). 66% of them are Hindi restaurant-booking dialogues (HDRS), so the
model is biased toward that domain and toward Hindi. Personality modes are learned from ~61
conversations each — enough to establish the *format*, not to guarantee consistent tone.

## 5. Personality modes
Modes are implemented as mode-tagged system prompts learned in SFT. With so little data the
separation between professional/friendly/adaptive is weak and often collapses into the same
register. Measured separation is reported honestly in `reports/eval_personality.json`.

## 6. Context
- Trained at 512 tokens (`max_context_tokens: 384` in generation config to leave room to answer).
- "Memory" = the current context window. When it overflows, the oldest turns are dropped and
  counted (`Conversation.dropped_turns`). There is **no** persistent memory, no retrieval, no
  cross-session state.

## 7. Safety
Only a handful of refusal examples exist in SFT. The model can produce unsafe, wrong, or
nonsensical text, and has no reliable refusal behaviour. Not suitable for user-facing
deployment, minors, medical/legal/financial advice, or anything consequential.

## 8. Evaluation honesty
The evaluation suites use deterministic heuristics (substring hits, script ratios, lexical
overlap). They show whether a *behaviour appears*, not whether the model is intelligent or
correct. No human evaluation has been done yet (planned, see `ROADMAP.md`).

## 9. Licensing
Trained on research/public-domain corpora with attribution requirements. If you redistribute the
weights, carry the attributions in `data/dataset_manifest.json` and `LICENSE`.
