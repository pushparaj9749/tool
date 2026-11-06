# Checkpoints

Checkpoints are **not committed to git** (`.gitignore` excludes `checkpoints/*/`): a single
97.4M-parameter checkpoint with AdamW state is ~1.1 GB.

Layout produced by the pipeline:

```
checkpoints/
  pretrain-100m/                 # 100M pilot run (configs/pretraining_100m_pilot.yaml)
    step25.pt  step25.json       # periodic checkpoint + SHA-256 sidecar
    best-step25.pt               # best validation loss so far
    final.pt                     # written at the stopping criterion
    latest.json                  # resume pointer
  pretrain-nano/                 # CPU-feasible pilot (configs/pretraining_nano.yaml)
  sft-v0.1/                      # instruction-tuned checkpoint used by the chat CLI
    final.pt
```

Every `.pt` has a sibling `.json` with `sha256`, `bytes`, `step`, `tokens_seen`.
`training/checkpoint.py::load_checkpoint(verify=True)` re-hashes before loading and refuses a
corrupted file. `latest.json` is what `--resume auto` follows.

To reproduce them:

```bash
bash scripts/run_pretraining.sh configs/pretraining_100m_pilot.yaml
bash scripts/run_pretraining.sh configs/pretraining_nano.yaml
bash scripts/run_finetuning.sh
```

To ship a checkpoint elsewhere (release artefacts), copy the directory out — do not `git add`
it. Record the checkpoint `sha256` from the sidecar in your release notes so others can verify
they have the same weights.
