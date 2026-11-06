#!/usr/bin/env bash
# End-to-end CPU pipeline: everything ANKIT LLM does on a machine with no GPU.
# Takes several hours because it actually trains. Every step is resumable.
#
#   bash scripts/run_all_cpu.sh            # full pipeline
#   SKIP_TRAIN=1 bash scripts/run_all_cpu.sh   # data + tokenizer only
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-.venv/bin/python}
SKIP_TRAIN=${SKIP_TRAIN:-0}

echo "== 1. environment"
python3 -m venv .venv 2>/dev/null || true
.venv/bin/pip install -q -r requirements.txt

echo "== 2. data"
bash scripts/download_data.sh
$PY data/prepare_data.py                     # normalise, dedupe, balance, split

echo "== 3. tokenizer (from scratch)"
$PY tokenizer/train_tokenizer.py --config configs/tokenizer.yaml --out-dir tokenizer/ankit_bpe
$PY tokenizer/tokenizer_tests.py

echo "== 4. token shards + validation"
$PY data/build_token_shards.py
$PY data/validate_data.py

echo "== 5. instruction dataset"
$PY data/build_sft.py

if [ "$SKIP_TRAIN" != "1" ]; then
  echo "== 6. pretraining the 100M model (long: ~2 h on 2 vCPU)"
  $PY training/pretrain.py --config configs/pretraining_100m_main.yaml --resume auto

  echo "== 7. instruction tuning on the 100M checkpoint (~40 min)"
  $PY training/finetune.py --config configs/finetuning_100m.yaml

  echo "== 8. evaluation"
  CKPT=checkpoints/sft-100m/final.pt
  for s in evaluate_lm evaluate_chat evaluate_languages evaluate_personality \
           evaluate_engineering collect_examples; do
    $PY evaluation/$s.py --checkpoint "$CKPT" || echo "[warn] $s failed"
  done
  $PY evaluation/report_summary.py
fi

echo "== done. Reports in reports/, logs in logs/, checkpoints in checkpoints/"
