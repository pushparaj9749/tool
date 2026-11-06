#!/usr/bin/env bash
# Full evaluation suite.
#   bash scripts/run_evaluation.sh [checkpoint]
set -euo pipefail
cd "$(dirname "$0")/.."
PY=${PYTHON:-.venv/bin/python}
CKPT=${1:-checkpoints/sft-v0.1/final.pt}

echo "== unit tests"
$PY -m pytest -q tests/ || echo "[warn] some tests failed — see reports/"

echo "== tokenizer tests"
$PY tokenizer/tokenizer_tests.py || true

echo "== language modelling evaluation"
$PY evaluation/evaluate_lm.py --checkpoint "$CKPT" || true

echo "== chat / conversation evaluation"
$PY evaluation/evaluate_chat.py --checkpoint "$CKPT" || true

echo "== multilingual evaluation"
$PY evaluation/evaluate_languages.py --checkpoint "$CKPT" || true

echo "== personality evaluation"
$PY evaluation/evaluate_personality.py --checkpoint "$CKPT" || true

echo "== engineering evaluation"
$PY evaluation/evaluate_engineering.py --checkpoint "$CKPT" || true

echo "== collecting raw chat transcripts"
$PY evaluation/collect_examples.py --checkpoint "$CKPT" || true

echo "== assembling release report"
$PY evaluation/report_summary.py || true

echo "== reports written to reports/"
ls -1 reports/
