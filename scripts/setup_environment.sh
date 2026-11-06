#!/usr/bin/env bash
# Reproducible environment setup for ANKIT LLM v0.1
#
# Verified environment (this release): Debian 12, Python 3.11.2, 2 vCPU,
# 3.8 GB RAM, NO GPU. torch 2.8.0 was installed CPU-only from PyPI.
# On a CUDA host the same script installs a CUDA-enabled torch wheel.
set -euo pipefail
cd "$(dirname "$0")/.."

PY=${PYTHON:-python3}
VENV=${VENV_DIR:-.venv}

echo "== creating virtualenv at $VENV"
$PY -m venv "$VENV"
"$VENV/bin/pip" install --upgrade -q pip

echo "== installing requirements (CPU wheel by default; PyPI only)"
"$VENV/bin/pip" install -q -r requirements.txt

echo "== environment audit"
"$VENV/bin/python" - <<'PY'
import platform, shutil, os
import torch
print("python  :", platform.python_version(), platform.platform())
print("torch   :", torch.__version__)
print("cuda    :", torch.cuda.is_available(), torch.cuda.device_count())
print("threads :", torch.get_num_threads(), "cpus:", os.cpu_count())
du = shutil.disk_usage(".")
print(f"disk    : {du.free/1e9:.1f} GB free of {du.total/1e9:.1f} GB")
PY

echo "== next steps"
cat <<'EOF'
 1) bash scripts/download_data.sh                 # fetch licensed sources
 2) python data/prepare_data.py                   # normalise/dedupe/split
 3) python tokenizer/train_tokenizer.py           # train BPE from scratch
 4) python data/build_token_shards.py             # packed uint16 shards
 5) python data/build_sft.py                      # instruction dataset
 6) bash scripts/run_pretraining.sh               # pretrain (configurable)
 7) bash scripts/run_finetuning.sh                # instruction tuning
 8) bash scripts/run_evaluation.sh                # evaluation reports
EOF
