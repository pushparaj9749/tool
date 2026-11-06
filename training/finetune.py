"""ANKIT LLM supervised instruction / conversational fine-tuning.

Adds a chat format on top of the pretrained checkpoint and trains with a masked
loss (only assistant tokens contribute), which is the standard SFT recipe.
Personality modes are learned through the mode system prompt, so a single set of
weights serves all three personalities.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import time
from pathlib import Path
from typing import List, Tuple

import numpy as np
import torch
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.architecture import AnkitLM                       # noqa: E402
from model.configuration import AnkitConfig                  # noqa: E402
from tokenizer.ankit_tokenizer import AnkitTokenizer         # noqa: E402
from training.checkpoint import (                             # noqa: E402
    list_checkpoints, load_checkpoint, prune_checkpoints, require_free_space,
    resolve_resume, save_checkpoint,
)
from training.metrics import RunLogger, perplexity            # noqa: E402
from training.optimizer import build_optimizer, clip_gradients, set_lr  # noqa: E402
from training.device import make_grad_scaler, needs_grad_scaler      # noqa: E402
from training.pretrain import pick_device, pick_dtype, set_seed       # noqa: E402
from training.scheduler import lr_at_step                     # noqa: E402


class SFTDataset:
    """Packs chat examples into fixed-length tensors with an assistant-only loss mask."""

    def __init__(self, path: str | Path, tokenizer: AnkitTokenizer, seq_len: int) -> None:
        self.tokenizer = tokenizer
        self.seq_len = seq_len
        self.examples: List[Tuple[List[int], List[int]]] = []
        skipped = 0
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                ids, mask = tokenizer.encode_supervised(rec["messages"])
                if len(ids) > seq_len:              # truncate, keep the tail of the dialogue
                    ids, mask = ids[-seq_len:], mask[-seq_len:]
                if sum(mask) == 0:
                    skipped += 1
                    continue
                self.examples.append((ids, mask))
        if not self.examples:
            raise ValueError(f"no usable SFT examples in {path}")
        self.skipped = skipped

    def __len__(self) -> int:
        return len(self.examples)

    def batch(self, batch_size: int, indices: List[int], pad_id: int, device: str,
              rng: random.Random) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        rows = [self.examples[i] for i in indices]
        T = max(len(ids) for ids, _ in rows)
        T = min(T, self.seq_len)
        x = torch.full((len(rows), T), pad_id, dtype=torch.long)
        y = torch.full((len(rows), T), -100, dtype=torch.long)
        m = torch.zeros((len(rows), T), dtype=torch.bool)
        for i, (ids, mask) in enumerate(rows):
            ids = ids[:T]
            n = len(ids)
            # x[t] = ids[t]; the model predicts ids[t+1] at position t, so both the
            # targets AND the loss mask must be shifted left by one position.
            targets = ids[1:] + [-100]
            mask_shifted = mask[1:] + [0]
            x[i, :n] = torch.tensor(ids, dtype=torch.long)
            y[i, :n] = torch.tensor(targets, dtype=torch.long)
            m[i, :n] = torch.tensor([bool(v) for v in mask_shifted], dtype=torch.bool)
            y[i][~m[i]] = -100
        return x.to(device), y.to(device), m.to(device)


@torch.no_grad()
def evaluate_sft(model: AnkitLM, dataset: SFTDataset, cfg: dict, device: str,
                 dtype: torch.dtype, pad_id: int) -> dict:
    model.eval()
    rng = random.Random(7)
    losses = []
    n = min(len(dataset), cfg.get("eval_batches", 20) * cfg["batch_size"])
    for start in range(0, n, cfg["batch_size"]):
        idx = list(range(start, min(start + cfg["batch_size"], len(dataset))))
        if not idx:
            break
        x, y, _ = dataset.batch(len(idx), idx, pad_id, device, rng)
        with torch.autocast(device_type=(device.type if hasattr(device, "type") else str(device)),
                            dtype=dtype, enabled=dtype != torch.float32):
            out = model(x, targets=y)
        losses.append(float(out.loss.item()))
    model.train()
    mean = float(np.mean(losses)) if losses else float("nan")
    return {"sft_val_loss": mean, "sft_val_ppl": perplexity(mean)}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/finetuning.yaml")
    ap.add_argument("--init-checkpoint", default=None)
    ap.add_argument("--epochs", type=float, default=None)
    ap.add_argument("--time-budget-sec", type=int, default=None)
    ap.add_argument("--device", default=None)
    ap.add_argument("--run-id", default=None)
    args = ap.parse_args()

    cfg = yaml.safe_load(open(args.config, encoding="utf-8"))
    if args.epochs:
        cfg["epochs"] = args.epochs
    if args.device:
        cfg["device"] = args.device
    run_id = args.run_id or time.strftime("%Y%m%d-%H%M%S")
    device = pick_device(cfg["device"])
    dtype = pick_dtype(cfg["dtype"], device)
    set_seed(cfg["seed"])
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    require_free_space(cfg["checkpoint_dir"], cfg["storage_min_free_gb"])

    tokenizer = AnkitTokenizer.load(cfg["tokenizer_dir"])
    train_ds = SFTDataset(cfg["sft_data"], tokenizer, cfg["seq_len"])
    val_ds = SFTDataset(cfg["sft_val_data"], tokenizer, cfg["seq_len"])
    print(f"[sft] train examples={len(train_ds)} val examples={len(val_ds)} "
          f"(skipped {train_ds.skipped} truncated/empty)")

    init_path = args.init_checkpoint or cfg.get("init_checkpoint", "auto")
    if init_path == "auto":
        # prefer a fine-tuning checkpoint if resuming, else the pretraining 'final'
        candidates = [p for p in Path("checkpoints").glob("pretrain-*/final.pt")]
        if not candidates:
            candidates = [Path(m["path"]) for m in list_checkpoints("checkpoints/pretrain-nano")]
        if not candidates:
            raise FileNotFoundError("no pretraining checkpoint found; run pretraining first")
        init_path = sorted(candidates)[-1]
    payload = load_checkpoint(init_path, map_location=str(device), with_optimizer=False)
    model_config = AnkitConfig.from_dict(payload["model_config"])
    model = AnkitLM(model_config).to(device)
    model.load_state_dict(payload["model"])
    init_step = payload.get("step", 0)
    print(f"[sft] initialised from {init_path} (pretrain step {init_step}, "
          f"{model.num_parameters():,} params)")

    optimizer = build_optimizer(model, cfg)
    scaler = make_grad_scaler(dtype, device)     # fp16 on Turing-class GPUs
    logger = RunLogger(cfg["log_dir"], cfg["run_name"], run_id)

    steps_per_epoch = max(1, len(train_ds) // (cfg["batch_size"] * cfg["grad_accum_steps"]))
    max_steps = max(1, int(steps_per_epoch * cfg["epochs"]))
    snapshot = Path(cfg["log_dir"]) / f"{cfg['run_name']}-{run_id}-config.json"
    snapshot.write_text(json.dumps({"run": cfg, "model": model_config.to_dict(),
                                    "init_checkpoint": str(init_path), "init_step": init_step,
                                    "train_examples": len(train_ds), "max_steps": max_steps,
                                    "run_id": run_id}, indent=2) + "\n", encoding="utf-8")
    logger.log(event="start", run_id=run_id, init_checkpoint=str(init_path),
               train_examples=len(train_ds), max_steps=max_steps, run_config=cfg)

    interrupted = {"flag": False}

    def handle(signum, _frame):
        interrupted["flag"] = True
        print(f"[sft] signal {signum} — checkpointing then exiting")

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)

    model.train()
    rng = random.Random(cfg["seed"])
    t0 = time.time()
    step, best_val = 0, None
    stop_reason = "max_steps"
    running = 0.0

    while step < max_steps:
        lr = lr_at_step(step, cfg["learning_rate"], cfg["warmup_steps"], max_steps,
                        cfg["min_lr_ratio"], cfg["lr_schedule"])
        set_lr(optimizer, lr)
        optimizer.zero_grad(set_to_none=True)
        step_loss = 0.0
        for _ in range(cfg["grad_accum_steps"]):
            idx = [rng.randrange(len(train_ds)) for _ in range(cfg["batch_size"])]
            x, y, _ = train_ds.batch(cfg["batch_size"], idx, tokenizer.pad_id, str(device), rng)
            with torch.autocast(device_type=device.type, dtype=dtype, enabled=dtype != torch.float32):
                out = model(x, targets=y)
                loss = out.loss / cfg["grad_accum_steps"]
            scaler.scale(loss).backward()
            step_loss += float(loss.item())
        if scaler.is_enabled():
            scaler.unscale_(optimizer)          # required before clipping in fp16
        gnorm = clip_gradients(model.parameters(), cfg["grad_clip"])
        scaler.step(optimizer)
        scaler.update()
        step += 1
        running += step_loss

        if step % cfg["log_every"] == 0 or step == 1:
            print(f"step {step:4d}/{max_steps} loss={running/cfg['log_every']:.4f} "
                  f"lr={lr:.2e} gnorm={gnorm:.2f}", flush=True)
            logger.log(event="train", step=step, loss=round(running / cfg["log_every"], 4),
                       lr=lr, grad_norm=round(gnorm, 4), elapsed_s=round(time.time() - t0, 1))
            running = 0.0

        if step % cfg["eval_every"] == 0:
            metrics = evaluate_sft(model, val_ds, cfg, device, dtype, tokenizer.pad_id)
            is_best = best_val is None or metrics["sft_val_loss"] < best_val
            best_val = metrics["sft_val_loss"] if is_best else best_val
            logger.log(event="eval", step=step, **metrics, best_val_loss=best_val)
            print(f"  [eval] step {step} sft_val_loss={metrics['sft_val_loss']:.4f}", flush=True)
            if is_best:
                save_checkpoint(cfg["checkpoint_dir"], f"best-step{step}", model, optimizer, step,
                                step * cfg["batch_size"] * cfg["grad_accum_steps"], model_config, cfg,
                                best_val, extra={"eval": metrics, "run_id": run_id,
                                                 "stage": "sft", "init_checkpoint": str(init_path)},
                                scaler=scaler)

        if step % cfg["save_every"] == 0:
            save_checkpoint(cfg["checkpoint_dir"], f"step{step}", model, optimizer, step,
                            step * cfg["batch_size"] * cfg["grad_accum_steps"], model_config, cfg,
                            best_val, extra={"run_id": run_id, "stage": "sft"}, scaler=scaler)
            prune_checkpoints(cfg["checkpoint_dir"], 3)

        if args.time_budget_sec and (time.time() - t0) > args.time_budget_sec:
            stop_reason = "time_budget"
            break
        if interrupted["flag"]:
            stop_reason = "interrupted"
            break

    metrics = evaluate_sft(model, val_ds, cfg, device, dtype, tokenizer.pad_id)
    final_path = save_checkpoint(cfg["checkpoint_dir"], "final", model, optimizer, step,
                                 step * cfg["batch_size"] * cfg["grad_accum_steps"], model_config, cfg,
                                 metrics["sft_val_loss"],
                                 extra={"eval": metrics, "run_id": run_id, "stage": "sft",
                                        "init_checkpoint": str(init_path), "stop_reason": stop_reason},
                                 scaler=scaler)
    logger.log(event="end", step=step, stop_reason=stop_reason, **metrics)
    logger.summary(run_id=run_id, run_name=cfg["run_name"], steps=step, init_checkpoint=str(init_path),
                   sft_val_loss=metrics["sft_val_loss"], stop_reason=stop_reason,
                   duration_s=round(time.time() - t0, 1), params=model.num_parameters(),
                   train_examples=len(train_ds))
    print(f"[sft] done step={step} sft_val_loss={metrics['sft_val_loss']:.4f} -> {final_path}")


if __name__ == "__main__":
    main()
