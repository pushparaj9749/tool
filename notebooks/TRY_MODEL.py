"""Try the model you already have — no GPU required, no retraining, no download.

In Colab (after Cell 2 has mounted Drive) run this one cell:

    !cd /content/ankit-llm && python notebooks/TRY_MODEL.py

It finds the best checkpoint by itself, in this order:
  1. `--checkpoint` if you passed one
  2. `checkpoints/t4-sft/final.pt`   (instruction-tuned, the real chat model)
  3. the newest checkpoint in `checkpoints/t4-full/`   (local, this VM)
  4. the newest checkpoint on Drive (`MyDrive/ankit-llm/checkpoints/t4-full`) — restored
     with the same code the trainer uses, so a fresh VM can try the model in ~2 minutes

Then it prints, for a few prompts, what the model continues with at a couple of
temperatures, and writes `reports/model_tryout.md` (plus a Drive copy) so the output can be
pasted back here.

Honesty note it also prints: a pretrained checkpoint at ~2 epochs (step 5,800 of 64,000) has
learned spelling, common words and short phrases — not answers. Ask it a question and it will
*continue text*, not reply to you. Coherent chat needs the SFT stage on top of a much
better base.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

DRIVE = Path("/content/drive/MyDrive/ankit-llm")

CONTINUE_PROMPTS = [
    "भारत की राजधानी",
    "धरती सूरज के चारों ओर",
    "The quick brown fox",
    "नेहरू जी ने कहा था कि",
    "def fibonacci(n):",
]
CHAT_PROMPTS = ["नमस्ते अंकित, तुम कैसे हो?", "What is Python?"]


# ------------------------------------------------------------------ checkpoints
def _local_newest(ckpt_dir: Path) -> Path | None:
    best: tuple[int, Path] | None = None
    if not ckpt_dir.is_dir():
        return None
    for sidecar in ckpt_dir.glob("*.json"):
        if sidecar.name == "latest.json":
            continue
        ckpt = sidecar.with_suffix(".pt")
        if not ckpt.exists():
            continue
        try:
            meta = json.loads(sidecar.read_text(encoding="utf-8"))
        except ValueError:
            continue
        if "bytes" in meta and ckpt.stat().st_size != int(meta["bytes"]):
            continue                                   # truncated copy, never resume it
        step = int(meta.get("step", -1))
        if best is None or step > best[0]:
            best = (step, ckpt)
    return best[1] if best else None


def _restore_from_drive(name: str = "t4-full") -> Path | None:
    mirror = DRIVE / "checkpoints" / name
    if not mirror.exists():
        return None
    from training.mirror import newest_mirrored_checkpoint, restore_from_mirror
    remote = newest_mirrored_checkpoint(mirror)
    if remote is None:
        return None
    print(f"[tryout] restoring {remote.name} from Drive (this is the slow part)", flush=True)
    return restore_from_mirror(mirror, ROOT / "checkpoints" / name)


def pick_checkpoint(explicit: str | None) -> Path:
    if explicit:
        p = Path(explicit)
        if not p.exists():
            raise SystemExit(f"checkpoint nahi mila: {p}")
        return p
    for candidate in (ROOT / "checkpoints/t4-sft/final.pt",):
        if candidate.exists():
            return candidate
    local = _local_newest(ROOT / "checkpoints/t4-full")
    if local:
        return local
    restored = _restore_from_drive()
    if restored:
        return restored
    raise SystemExit(
        "koi checkpoint nahi mila. Colab me pehle Cell 2 (Drive mount) chalao, ya "
        "--checkpoint <path> do. Training abhi step 5,800 par hai — Drive par "
        "ankit-llm/checkpoints/t4-full/step5800.pt maujood hai.")


# ------------------------------------------------------------------ model
def build_engine(ckpt: Path, tok_dir: str, device: str):
    import torch
    import yaml
    from inference.conversation import ChatEngine
    from inference.generate import GenerationConfig
    from model.architecture import AnkitLM
    from model.configuration import AnkitConfig
    from tokenizer.ankit_tokenizer import AnkitTokenizer
    from training.checkpoint import load_checkpoint

    payload = load_checkpoint(ckpt, map_location=device, with_optimizer=False)
    cfg = AnkitConfig.from_dict(payload["model_config"])
    model = AnkitLM(cfg)
    model.load_state_dict(payload["model"])
    model.to(device).eval()
    tok = AnkitTokenizer.load(tok_dir)
    gen_raw = yaml.safe_load((ROOT / "configs/generation.yaml").read_text(encoding="utf-8"))
    gen = GenerationConfig.from_dict(gen_raw)
    engine = ChatEngine(
        model, tok, gen,
        personalities=gen_raw.get("personalities", {}),
        max_context_tokens=min(gen_raw.get("max_context_tokens", 384), cfg.max_seq_len),
        reserve_for_generation=gen_raw.get("reserve_for_generation", 128),
    )
    info = {
        "checkpoint": str(ckpt),
        "step": payload.get("step"),
        "tokens_seen": payload.get("tokens_seen"),
        "best_val_loss": payload.get("best_val_loss"),
        "params": model.num_parameters(),
        "vocab_size": cfg.vocab_size,
        "max_seq_len": cfg.max_seq_len,
        "torch": torch.__version__,
    }
    return engine, info


def main() -> None:
    ap = argparse.ArgumentParser(description="try ANKIT LLM on an existing checkpoint")
    ap.add_argument("--checkpoint", default=None)
    ap.add_argument("--tokenizer-dir", default="tokenizer/ankit_bpe")
    ap.add_argument("--device", default=None, help="cuda / cpu (default: auto)")
    ap.add_argument("--max-new-tokens", type=int, default=60)
    ap.add_argument("--temperatures", default="0.8,1.0")
    ap.add_argument("--chat", action="store_true", help="also a chat-style round trip")
    ap.add_argument("--prompts", type=int, default=len(CONTINUE_PROMPTS))
    ap.add_argument("--out", default="reports/model_tryout.md")
    ap.add_argument("--seed", type=int, default=1234)
    args = ap.parse_args()

    import torch
    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    torch.manual_seed(args.seed)
    ckpt = pick_checkpoint(args.checkpoint)
    engine, info = build_engine(ckpt, args.tokenizer_dir, device)
    temps = [float(t) for t in args.temperatures.split(",") if t.strip()]

    from inference.generate import Generator
    lines: list[str] = []
    def say(text: str) -> None:
        print(text, flush=True)
        lines.append(text)

    epochs = (info["tokens_seen"] or 0) / 24_100_344 if info.get("tokens_seen") else None
    say(f"# ANKIT LLM tryout — {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}")
    say("")
    say(f"- checkpoint: `{info['checkpoint']}`")
    say(f"- step **{info['step']}** | tokens seen {info['tokens_seen']:,} "
        f"| ~{epochs:.2f} epochs over the 24.1M-token corpus" if epochs else
        f"- step {info['step']} | tokens seen {info['tokens_seen']}")
    say(f"- params {info['params']/1e6:.2f}M | vocab {info['vocab_size']} "
        f"| device {device} | torch {info['torch']}")
    say("")
    say("> Ye base (pretrained) model hai — sawaal ka jawab nahi degi, text *continue* "
        "karegi. ~2 epochs par sirf spelling, common shabd aur chhote vaakya aate hain. "
        "Asli chat ke liye SFT + zyada steps chahiye.")
    say("")

    def sample(prompt: str, temperature: float, max_new: int) -> str:
        gen_cfg = engine.gen_cfg
        gen_cfg.temperature = temperature
        gen_cfg.max_new_tokens = max_new
        ids = engine.tok.encode(prompt)
        try:
            return Generator(engine.model, engine.tok, gen_cfg).generate(ids).strip()
        except Exception as exc:                              # noqa: BLE001
            return f"<generation failed: {type(exc).__name__}: {exc}>"

    say("## Completions")
    for prompt in CONTINUE_PROMPTS[:max(1, args.prompts)]:
        for t in temps:
            out = sample(prompt, t, args.max_new_tokens)
            block = (f"**prompt:** `{prompt}`  \n**temp {t}:** "
                     f"{out}".replace("\n", " "))
            say(block)
            say("")

    if args.chat:
        say("## Chat-style (base model — expect nonsense, this is the honest baseline)")
        for prompt in CHAT_PROMPTS:
            try:
                answer = engine.chat_once([{"role": "user", "content": prompt}])
            except Exception as exc:                          # noqa: BLE001
                answer = f"<chat failed: {type(exc).__name__}: {exc}>"
            say(f"**you:** {prompt}  \n**ankit:** {answer}".replace("\n", " "))
            say("")

    out_path = ROOT / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n[tryout] written to {out_path}", flush=True)
    if DRIVE.exists():
        try:
            (DRIVE / "reports").mkdir(parents=True, exist_ok=True)
            shutil.copy(out_path, DRIVE / "reports" / out_path.name)
            print(f"[tryout] copied to {DRIVE}/reports/{out_path.name}", flush=True)
        except OSError as exc:
            print(f"[tryout] Drive copy failed: {exc}", flush=True)


if __name__ == "__main__":
    main()
