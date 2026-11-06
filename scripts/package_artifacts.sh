#!/usr/bin/env bash
# Package the non-git artefacts (tokenizer + token shards + optional checkpoint)
# into ONE zip for Google Drive, so Colab does not have to rebuild everything.
#
#   bash scripts/package_artifacts.sh                 # data + tokenizer only  (~130 MB)
#   bash scripts/package_artifacts.sh --with-checkpoint checkpoints/pretrain-100m-main/final.pt
#
# Then upload the resulting zip to  My Drive/ankit-llm/ankit-artifacts.zip
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${OUT:-ankit-artifacts.zip}
CKPT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --with-checkpoint) CKPT="$2"; shift 2 ;;
    *) echo "unknown arg $1"; exit 1 ;;
  esac
done

rm -f "$OUT"
FILES=(
  tokenizer/ankit_bpe/tokenizer.json
  tokenizer/ankit_bpe/tokenizer_config.json
  tokenizer/ankit_bpe/vocab.json
  data/processed/pretrain_train.bin
  data/processed/pretrain_val.bin
  data/processed/pretrain_test.bin
  data/processed/token_shard_report.json
  data/processed/data_statistics.json
  data/processed/balance_report.json
  data/sft/sft_train.jsonl
  data/sft/sft_val.jsonl
  data/sft/sft_stats.json
)
EXISTING=()
for f in "${FILES[@]}"; do [ -f "$f" ] && EXISTING+=("$f"); done

if [ -n "$CKPT" ]; then
  [ -f "$CKPT" ] || { echo "checkpoint not found: $CKPT"; exit 1; }
  EXISTING+=("$CKPT")
  # ship the integrity sidecar too, so the hash can be verified on Colab
  [ -f "${CKPT%.pt}.json" ] && EXISTING+=("${CKPT%.pt}.json")
fi

zip -q -9 "$OUT" "${EXISTING[@]}"
echo "wrote $OUT ($(du -h "$OUT" | cut -f1)) with ${#EXISTING[@]} files"
echo "upload it to: My Drive/ankit-llm/ankit-artifacts.zip"
