"""Engineering evaluation: load, checkpoint integrity, restore, speed, memory,
long-context behaviour and reproducibility."""
from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from evaluation.common import load_engine, save_report  # noqa: E402
from training.checkpoint import list_checkpoints, load_checkpoint, verify_checkpoint  # noqa: E402


def measure_generation(engine, prompt: str, max_new_tokens: int) -> dict:
    engine.gen_cfg.max_new_tokens = max_new_tokens
    t0 = time.time()
    text = engine.chat_once([{"role": "user", "content": prompt}], mode="adaptive")
    dt = time.time() - t0
    return {
        "prompt": prompt,
        "max_new_tokens": max_new_tokens,
        "seconds": round(dt, 3),
        "chars": len(text),
        "tokens_per_second_approx": round(max_new_tokens / max(dt, 1e-6), 2),
        "output_preview": text[:120],
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    engine = load_engine(args.checkpoint, args.device)
    model = engine.model

    # 1. checkpoint inventory + integrity
    inventory = []
    for pattern in ("checkpoints/pretrain-nano", "checkpoints/pretrain-100m",
                    "checkpoints/sft-v0.1"):
        for meta in list_checkpoints(ROOT / pattern):
            inventory.append({
                "tag": meta["tag"],
                "path": meta["path"].replace(str(ROOT) + "/", ""),
                "step": meta.get("step"),
                "tokens_seen": meta.get("tokens_seen"),
                "bytes": meta.get("bytes"),
                "integrity_ok": verify_checkpoint(meta),
            })

    # 2. reload determinism: same weights -> same greedy output
    payload = load_checkpoint(args.checkpoint, map_location=args.device, with_optimizer=False)
    from model.architecture import AnkitLM
    from model.configuration import AnkitConfig
    clone = AnkitLM(AnkitConfig.from_dict(payload["model_config"]))
    clone.load_state_dict(payload["model"])
    same_weights = all(
        torch.equal(p.detach(), q.detach()) for p, q in zip(model.parameters(), clone.parameters())
    )

    engine.gen_cfg.temperature = 0.0                      # greedy
    engine.gen_cfg.repetition_penalty = 1.0
    probe = "What is a tokenizer?"
    a1 = engine.chat_once([{"role": "user", "content": probe}], mode="adaptive")
    from inference.conversation import ChatEngine
    engine2 = ChatEngine.from_checkpoint(args.checkpoint, device=args.device)
    engine2.gen_cfg.temperature = 0.0
    engine2.gen_cfg.repetition_penalty = 1.0
    a2 = engine2.chat_once([{"role": "user", "content": probe}], mode="adaptive")

    # 3. speed / memory
    speed = [measure_generation(engine, "Explain what a database is.", n) for n in (16, 64)]
    max_rss_mb = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024

    # 4. long context behaviour
    conv = engine.new_conversation("adaptive")
    for i in range(12):
        engine.reply(conv, f"Turn {i}: please remember the number {i * 7}.")
    long_context = {
        "turns": len(conv.history) // 2,
        "dropped_turns": conv.dropped_turns,
        "history_tokens": len(engine.tok.encode_chat(conv.to_messages(), add_generation_prompt=True)),
        "context_budget": engine._budget(),
        "still_answers": bool(engine.reply(conv, "What number did I mention in turn 3?")),
    }

    report = {
        "checkpoint": args.checkpoint,
        "params": model.num_parameters(),
        "model_config": model.config.to_dict(),
        "checkpoint_inventory": inventory,
        "reload_weight_identity": same_weights,
        "greedy_reproducible_across_loads": a1 == a2,
        "greedy_output": a1,
        "speed": speed,
        "peak_rss_mb": round(max_rss_mb, 1),
        "torch_threads": torch.get_num_threads(),
        "cuda_available": torch.cuda.is_available(),
        "long_context": long_context,
        "note": ("Speed is CPU-only single-stream decoding with a KV cache; it is not representative "
                 "of GPU inference."),
    }
    save_report("eval_engineering.json", report)
    print(json.dumps({k: report[k] for k in
                      ("reload_weight_identity", "greedy_reproducible_across_loads", "speed",
                       "peak_rss_mb", "long_context")}, indent=2)[:2000])


if __name__ == "__main__":
    main()
