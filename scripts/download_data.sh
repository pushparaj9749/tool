#!/usr/bin/env bash
# Download the ANKIT LLM data sources into data/raw/.
#
# NOTE ON THIS SANDBOX: outbound network here is restricted by the host to
# pypi.org / files.pythonhosted.org / github.com / codeload.github.com /
# api.github.com / registry.npmjs.org. huggingface.co, raw.githubusercontent.com,
# dumps.wikimedia.org, www.gutenberg.org and download.pytorch.org are blocked at
# the host allowlist (connection attempt returns 000). Every source below is
# therefore reachable through git/github. See ENVIRONMENT_REPORT.md.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
RAW="$PWD/data/raw"

echo "== [1/4] IITB English-Hindi parallel corpus (repo: kumardeepak/nmt-anuvada, MIT)"
if [ ! -f "$RAW/iitb/IITB.en-hi-hi.txt" ]; then
  rm -rf "$RAW/anuvada"
  git clone --depth 1 -q https://github.com/kumardeepak/nmt-anuvada "$RAW/anuvada"
  mkdir -p "$RAW/iitb"
  unzip -o -q "$RAW/anuvada/data/IITB.en-hi-hi.txt.zip" -d "$RAW/iitb"
  unzip -o -q "$RAW/anuvada/data/IITB.en-hi-en.txt.zip" -d "$RAW/iitb"
  cp "$RAW/anuvada/LICENSE" "$RAW/iitb/LICENSE" 2>/dev/null || true
  rm -rf "$RAW/anuvada"
fi
wc -l "$RAW/iitb/IITB.en-hi-hi.txt" "$RAW/iitb/IITB.en-hi-en.txt"

echo "== [2/4] Project Gutenberg selections (public domain, via nltk_data repo)"
if [ ! -d "$RAW/gutenberg" ]; then
  rm -rf "$RAW/nltk_tmp"
  git init -q "$RAW/nltk_tmp"
  ( cd "$RAW/nltk_tmp"
    git remote add origin https://github.com/nltk/nltk_data.git
    git config core.sparseCheckout true
    mkdir -p .git/info
    printf 'packages/corpora/gutenberg.zip\n' > .git/info/sparse-checkout
    git fetch --depth 1 -q origin gh-pages
    git checkout -q FETCH_HEAD )
  mkdir -p "$RAW/gutenberg"
  unzip -o -q "$RAW/nltk_tmp/packages/corpora/gutenberg.zip" -d "$RAW/gutenberg"
  rm -rf "$RAW/nltk_tmp"
fi
ls "$RAW/gutenberg/gutenberg" | head

echo "== [3/4] Hinglish-TOP dataset (Google Research, Apache-2.0) -> Hinglish text"
if [ ! -d "$RAW/hinglish_top" ]; then
  git clone --depth 1 -q https://github.com/google-research-datasets/Hinglish-TOP-Dataset "$RAW/hinglish_top"
fi
du -sh "$RAW/hinglish_top"

echo "== [4/4] HDRS Hindi dialogue corpus (skmalviya, MIT) -> SFT source"
if [ ! -d "$RAW/hdrs" ]; then
  rm -rf "$RAW/hdrs"
  git clone --depth 1 -q https://github.com/skmalviya/HDRS-Corpus "$RAW/hdrs"
  unzip -o -q "$RAW/hdrs/HDRS_Corpus.zip" -d "$RAW/hdrs"
fi
ls "$RAW/hdrs/HDRS_Corpus" | head

echo "All sources present under $RAW"
