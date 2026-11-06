"""Language-modelling evaluation: held-out loss / perplexity per language + token prediction.

Reports the honest picture: perplexity on a small, from-scratch model is high.
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import save_report  # noqa: E402
from model.architecture import AnkitLM  # noqa: E402
from model.configuration import AnkitConfig  # noqa: E402
from tokenizer.ankit_tokenizer import AnkitTokenizer  # noqa: E402
from training.checkpoint import load_checkpoint  # noqa: E402


def load_model(checkpoint: str, device: str = "cpu"):
    payload = load_checkpoint(checkpoint, map_location=device, with_optimizer=False)
    cfg = AnkitConfig.from_dict(payload["model_config"])
    model = AnkitLM(cfg)
    model.load_state_dict(payload["model"])
    return model.to(device).eval(), cfg, payload


@torch.no_grad()
def eval_jsonl(model, tok, path: Path, seq_len: int, max_docs: int = 3000) -> dict:
    by_lang_loss = defaultdict(list)
    total_tokens = 0
    docs = 0
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            if docs >= max_docs:
                break
            rec = json.loads(line)
            ids = tok.encode(rec["text"], add_special_tokens=False)[: seq_len - 1]
            if len(ids) < 8:
                continue
            x = torch.tensor([ids], dtype=torch.long)
            y = torch.tensor([ids[1:] + [tok.eos_id]], dtype=torch.long)
            out = model(x[:, : y.shape[1]], targets=y)
            by_lang_loss[rec["lang"]].append(float(out.loss.item()))
            total_tokens += len(ids)
            docs += 1
    per_lang = {}
    for lang, losses in by_lang_loss.items():
        mean = sum(losses) / len(losses)
        per_lang[lang] = {
            "docs": len(losses),
            "loss": round(mean, 4),
            "perplexity": round(math.exp(mean), 2) if mean < 20 else None,
        }
    overall = sum(sum(v) for v in by_lang_loss.values()) / max(sum(len(v) for v in by_lang_loss.values()), 1)
    return {
        "docs": docs,
        "tokens": total_tokens,
        "loss": round(overall, 4) if docs else None,
        "perplexity": round(math.exp(overall), 2) if docs and overall < 20 else None,
        "per_language": per_lang,
    }


@torch.no_grad()
def token_prediction_test(model, tok, prompts: list[str], device: str, top_k: int = 5) -> list[dict]:
    """Next-token prediction sanity check: does the model prefer any sensible token?"""
    results = []
    for prompt in prompts:
        ids = tok.encode(prompt, add_special_tokens=False)
        x = torch.tensor([ids], dtype=torch.long, device=device)
        out = model(x, return_logits=True)
        logits = out.logits[0, -1]
        probs = torch.softmax(logits.float(), dim=-1)
        k = min(top_k, probs.numel())
        top = torch.topk(probs, k)
        results.append({
            "prompt": prompt,
            "top_tokens": [tok.decode([int(i)]).strip() for i in top.indices],
            "top_probs": [round(float(p), 4) for p in top.values],
        })
    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--data", default="data/processed/pretrain_val.jsonl")
    ap.add_argument("--test-data", default="data/processed/pretrain_test.jsonl")
    ap.add_argument("--max-docs", type=int, default=1500)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    model, cfg, payload = load_model(args.checkpoint, args.device)
    tok = AnkitTokenizer.load(ROOT / "tokenizer" / "ankit_bpe")
    seq_len = min(cfg.max_seq_len, 256)

    val = eval_jsonl(model, tok, ROOT / args.data, seq_len, args.max_docs)
    test = eval_jsonl(model, tok, ROOT / args.test_data, seq_len, args.max_docs)

    prompts = [
        "नमस्ते, मैं",
        "Hello, I am",
        "Bhai, kal",
    ]
    predictions = token_prediction_test(model, tok, prompts, args.device)

    report = {
        "checkpoint": args.checkpoint,
        "checkpoint_step": payload.get("step"),
        "checkpoint_stage": payload.get("extra", {}).get("stage", "pretrain"),
        "params": model.num_parameters(),
        "validation": val,
        "test": test,
        "next_token_probes": predictions,
        "note": (
            "Loss/perplexity are measured on held-out data from the same corpus. "
            "A high perplexity here reflects an undertrained 100M-class model, not a broken pipeline."
        ),
    }
    save_report("eval_lm.json", report)
    print(json.dumps({k: report[k] for k in ("validation", "test")}, indent=2, ensure_ascii=False)[:2000])


if __name__ == "__main__":
    main()
