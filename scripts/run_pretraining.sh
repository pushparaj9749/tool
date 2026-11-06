#!/usr/bin/env bash
# Pretraining launcher.
#   bash scripts/run_pretraining.sh [config] [extra args...]
# Examples:
#   bash scripts/run_pretraining.sh configs/pretraining_nano.yaml
#   bash scripts/run_pretraining.sh configs/pretraining.yaml --time-budget-sec 1200
set -euo pipefail
cd "$(dirname "$0")/.."
CONFIG=${1:-configs/pretraining.yaml}
shift || true
PY=${PYTHON:-.venv/bin/python}
echo "== pretraining with $CONFIG (extra: $*)"
$PY training/pretrain.py --config "$CONFIG" --resume auto "$@"
