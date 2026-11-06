# ROADMAP — what ANKIT LLM still needs

Ordered by value per hour of compute. "Done" items are complete in this repo.

## Done (this release)
- [x] Architecture + parameter calculator (97.44M measured)
- [x] Custom byte-level BPE tokenizer, chat template, round-trip tests
- [x] Licence-audited dataset pipeline, dedupe, split, 24.1M train tokens
- [x] Pretraining loop with resume, checkpoints, eval, logging
- [x] Instruction tuning with assistant-masked loss and 3 personality modes
- [x] Inference engine, CLI chat, HTTP API
- [x] Evaluation suites (LM / chat / languages / personality / engineering)
- [x] 38 unit tests passing

## Next (needs a GPU — options in ENVIRONMENT_REPORT.md §4)

1. **Pretrain to a real budget (highest priority).**
   ~2B tokens on the 97.4M model. On one 24 GB GPU: ~2-4 days, ~15-60 USD rent.
   Command already exists: `bash scripts/run_pretraining.sh configs/pretraining.yaml`.
   Expected: validation perplexity drops from the current pilot level into a range where
   short conversations are grammatical (do not promise more than that at 100M params).

2. **Instruction tuning at a sane ratio.** Re-run `data/build_sft.py` with more authored
   conversations (target 2-5k) so Hindi restaurant dialogues are <20% of the SFT mix, then
   `bash scripts/run_finetuning.sh` for 2-3 epochs.

3. **Unblock the dataset sources that are currently host-blocked.** HuggingFace
   (`IndicCorp`, `Samanantar`, OSCAR) and Wikimedia dumps would take the corpus from 24M to
   2B+ tokens. This needs the egress allowlist relaxed — a one-line infra change, not code.

4. **Human evaluation.** Replace the heuristic probes in `evaluation/` with a small human-rated
   set (50 prompts × 3 languages × 3 modes). The current probes measure *behaviour presence*,
   not quality.

5. **Quantisation + faster CPU inference.** int8 dynamic quantisation of the 97.4M model would
   roughly halve latency on CPU (`torch.quantization.quantize_dynamic`) — not implemented yet.

6. **Long-context extension.** Model is trained at 512 tokens. RoPE scaling (NTK / YaRN) and a
   short long-context SFT stage would allow 2k+, but only after step 1.

## Deliberately out of scope for v0.1
- Retrieval / long-term memory (the conversation engine says "context window only", and means it).
- Tool use, function calling, RAG.
- Safety alignment beyond the small refusal examples in the SFT seed set.
- Chinese/other languages, multimodal input.
