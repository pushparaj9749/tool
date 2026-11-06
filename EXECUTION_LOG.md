# EXECUTION_LOG — ANKIT LLM v0.1

Chronological record of what was actually executed in this repository.
Timestamps are the session clock (2026-11-06, UTC). Every number here comes from
a command that was run, not from estimation.

---

### 00 — Environment audit
- `nproc` = 2, `free -h` = 3.8 GB RAM, `df -h` = 20 GB free, `nvidia-smi` → not found.
- Python 3.11.2, PEP-668 managed; created `.venv`.
- Network probe: pypi/github reachable; huggingface.co, raw.githubusercontent.com,
  download.pytorch.org, dumps.wikimedia.org, www.gutenberg.org → blocked (HTTP 000).
- `torch==2.2.2 --no-deps` failed (`libcudart.so.12` missing at import) →
  installed `torch==2.8.0` with its CUDA dependency set, running in CPU mode.
- First action in the repo: removed all pre-existing project files (as instructed by the user),
  keeping `.git`.

### 01 — Data acquisition (GitHub only, licence-audited)
- `kumardeepak/nmt-anuvada` (MIT) → 1,561,833 Hindi + 1,561,833 English sentences.
- `nltk_data` Gutenberg selections (public domain) → 20 books, 47,618 paragraphs.
- `google-research-datasets/Hinglish-TOP-Dataset` (Apache-2.0) → 180,979 Hinglish rows.
- `skmalviya/HDRS-Corpus` (MIT) → Hindi restaurant dialogues (SFT only).
- Dropped sources without a licence file (e.g. `KartikGarg19/Hindi-Text-Corpus`).

### 02 — Data preparation (`data/prepare_data.py`)
- seen 3,352,263 records → kept 1,371,427 (40.9%).
- rejects: low_alpha_ratio 709,101; too_short 645,522; too_few_words 217,688;
  decoding_error 30; repetitive 79; too_long 150.
- 407,745 exact duplicates removed.
- language mix before balancing: en 1,009,187 / hi 303,893 / hinglish 54,097 / mixed 4,250.
- balancing: English thinned by 646,585 records → hi 297,797 / en 342,498 / hinglish 53,068 /
  mixed 4,157 (English capped at 1.15× Hindi).
- split (content-hash, leakage-free): train 1,344,105 → after balancing 697,520 records.

### 03 — Tokenizer (`tokenizer/train_tokenizer.py`)
- byte-level BPE, vocab 32,768, min_frequency 2, max_token_length 16,
  initial_alphabet = all 256 bytes, trained on a 63.5 MB / 34.7M-character mixed corpus.
- specials: `<pad>`0 `<unk>`1 `<bos>`2 `<eos>`3 `<|system|>`4 `<|user|>`5 `<|assistant|>`6 `<|end|>`7.
- fixes during the session: `ByteLevelBPETokenizer.train(length=…)` is unsupported in
  tokenizers 0.23.3 → switched to an explicit `BpeTrainer`; `encode_supervised` was missing the
  `<bos>` token in the segment-wise path → assertion caught it, fixed.
- `tokenizer/tokenizer_tests.py`: 7/7 samples round-trip exactly, 0 `<unk>` on unseen scripts.

### 04 — Token shards (`data/build_token_shards.py`)
- naive per-line encoding was too slow (~7 min without finishing) → batched
  `encode_batch` path, finished in ~60 s.
- **train 24,100,344 tokens / val 402,704 / test 404,848**, uint16, max id 32,767.

### 05 — SFT dataset (`data/build_sft.py`)
- 61 authored conversations × 3 personality modes = 183 examples.
- HDRS dialogues: initially 1,400 (67% of the SFT mix — too restaurant-heavy) → capped to
  120 dialogues per file → 360 dialogues.
- final: 543 unique examples → 509 train / 34 val; total 3,889 turns.

### 06 — Data validation (`data/validate_data.py`)
- status **PASS**, split leakage 0/0/0, all token ids < vocab, no U+FFFD in any record.

### 07 — Model + unit tests
- `python model/parameter_count.py`: **97,435,392 measured** trainable params, analytic
  estimate matches.
- `pytest`: initially 7 failures (analytic count over-counted FFN biases, `generate` mixed
  batch/sequence dims, KV-cache test compared the wrong logits, context budget not enforced
  after the assistant turn) → all fixed → **38 passed**.

### 08 — Throughput measurement on this host
```
ankit-100m  97,435,392 params  bs=2  seq=256  → 4.25 s/step,  120 tok/s
ankit-nano  11,798,784 params  bs=8  seq=256  → 2.07 s/step,  991 tok/s
```

*(continued below — pretraining, SFT and evaluation results are appended as they complete)*

---

### 09 — Pretraining, run 1 (100M model, real)
- `python training/pretrain.py --config configs/pretraining_100m_pilot.yaml`
- First attempt (`pilot01`) crashed at step 50: `evaluate()` referenced an undefined loop
  variable. Fix: `enumerate(... seed=12345 + i)` → `seed=12345`.
- The crash **saved `checkpoints/pretrain-100m/crashed.pt`** via the new crash-safe handler —
  this is what makes the resume below a real test rather than a rehearsal.
- Second attempt resumed from `crashed.pt` at step 50 ("resumed from … at step 50"), then
  crashed again at step 75 on a second bug: `prune_checkpoints` did `str / str`
  (`TypeError: unsupported operand type(s) for /`). Fixed with `Path(ckpt_dir)`.
- Third attempt (`pilot03-resume`) resumed at step 50 and ran to completion:

```
params=97,435,392  device=cpu  dtype=fp32  ~200 tok/s
step  50 val_loss=7.1705  ppl=1300.4
step 100 val_loss=7.1473  ppl=1270.7
step 125 val_loss=6.9545  ppl=1047.9
step 150 val_loss=6.8460  ppl= 940.1     <- final.pt
total: 150 steps, 153,600 tokens, ~9 min train time
```
- Determinism check: `pilot01` and `pilot02` produced identical losses at steps 5/10/15/20
  (same seed → same batches).

### 10 — Pretraining, run 2 (nano model, CPU-feasible reference run)
- `python training/pretrain.py --config configs/pretraining_nano.yaml --run-id nano01`
- 1332 steps, **2,727,936 tokens**, ~1,100 tok/s, stopped by the wall-clock budget:
```
step  100 val_loss=6.1592  ppl=473.0
step  400 val_loss=5.3262  ppl=205.7
step 1250 val_loss=4.7921  ppl=120.6
final    val_loss=4.7633  ppl=117.0
```

### 11 — Instruction tuning
- `python training/finetune.py --init checkpoints/pretrain-nano/final.pt`
- Bug found and fixed before the run: the SFT loss mask was not shifted with the targets
  (off-by-one → the first assistant token was unsupervised and one extra token was supervised).
  Added `tests/test_finetune_data.py` (4 tests) so this cannot regress.
- Missing `beta1/beta2` in `configs/finetuning.yaml` → `KeyError` → added.
- Executed: 189 steps (3 epochs over 509 examples),
  `sft_val_loss 3.49 → 1.863`, 275 s, checkpoint `checkpoints/sft-v0.1/final.pt`.

### 12 — Evaluation suite (all reports in `reports/`)
```
LM (SFT checkpoint):  val loss 3.774 / ppl 43.54   test loss 3.792 / ppl 44.35
                      hi  ppl  36.3 (1387 docs)
                      en  ppl 574.5 (77 docs)
                      mixed ppl 193.8 (36 docs)
chat expectations:    1/8 single-turn hits (0.125), 0/3 multi-turn context hits,
                      contradiction probe: answers differed
languages:            hi consistency 1.00, roman-Hindi 1.00, en 0.33, hinglish 0.00 (empty answers)
personality:          mode separation 0.738, adaptive language match 0.833
engineering:          weights reload identical, greedy reproducible across two loads,
                      ~107-136 tok/s CPU decoding, 787 MB peak RSS,
                      context budget enforced (19 turns dropped in a 12-turn overflow probe)
data validation:      PASS (0 leakage, all token ids valid)
```
Interpretation: the loss numbers show the pipeline learns; the conversation numbers show the
model does **not** yet hold a conversation. Both are reported, neither is dressed up.

### 13 — API smoke test
```
GET  /health -> {"status":"ok","params":11798784,"modes":[...],"max_seq_len":256,...}
POST /chat   -> {"response":"The Kha, D. K.0, 15/2)","personality":"friendly"}
```

### 14 — Final state
- 42 unit tests passing (`pytest -q tests/`).
- Checkpoints: `pretrain-100m/` (97.44M), `pretrain-nano/` (11.80M), `sft-v0.1/` (chat).
- Repository contains code, configs, docs, logs and reports. Datasets and checkpoints are
  git-ignored by design; regenerate them with the scripts in `scripts/`.
