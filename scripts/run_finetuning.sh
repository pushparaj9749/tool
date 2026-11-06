#!/usr/bin/env bash
# Instruction-tuning launcher.
#   bash scripts/run_finetuning.sh [config] [extra args...]
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG=${1:-configs/finetuning.yaml}
shift || true
PY=${PYTHON:-.venv/bin/python}
echo "== SFT with $CONFIG (extra: $*)"
$PY training/finetune.py --config "$CONFIG" "$@"
