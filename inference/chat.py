"""CLI chat interface for ANKIT LLM.

Usage:
  python inference/chat.py --checkpoint checkpoints/sft-v0.1/final.pt --mode adaptive
Commands inside the chat: /mode <professional|friendly|adaptive>, /reset, /quit, /stats
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inference.conversation import MODES, ChatEngine  # noqa: E402


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--mode", default="adaptive", choices=list(MODES))
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--max-new-tokens", type=int, default=None)
    ap.add_argument("--no-stream", action="store_true")
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()

    engine = ChatEngine.from_checkpoint(args.checkpoint, device=args.device)
    if args.temperature is not None:
        engine.gen_cfg.temperature = args.temperature
    if args.max_new_tokens:
        engine.gen_cfg.max_new_tokens = args.max_new_tokens
    n_params = engine.model.num_parameters()
    print(f"ANKIT LLM v0.1 — {n_params/1e6:.2f}M parameters, mode={args.mode}")
    print("Type /mode <professional|friendly|adaptive>, /reset, /stats, /quit\n")
    conv = engine.new_conversation(args.mode)
    while True:
        try:
            user = input("you > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not user:
            continue
        if user in ("/quit", "/exit"):
            break
        if user == "/reset":
            conv = engine.new_conversation(conv.mode)
            print("[conversation reset]")
            continue
        if user == "/stats":
            print(f"[mode={conv.mode} turns={len(conv.history)//2} dropped_turns={conv.dropped_turns}"
                  f" temp={engine.gen_cfg.temperature} max_new={engine.gen_cfg.max_new_tokens}]")
            continue
        if user.startswith("/mode"):
            parts = user.split()
            if len(parts) == 2 and parts[1] in MODES:
                conv = engine.new_conversation(parts[1])
                print(f"[mode set to {parts[1]}; conversation reset]")
            else:
                print(f"[usage: /mode {'|'.join(MODES)}]")
            continue
        t0 = time.time()
        print("ankit> ", end="", flush=True)
        answer = engine.reply(conv, user, stream=not args.no_stream)
        if args.no_stream:
            print(answer)
        dt = time.time() - t0
        print(f"[{len(answer)} chars in {dt:.1f}s]")


if __name__ == "__main__":
    main()
