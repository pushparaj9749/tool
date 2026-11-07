"""ANKIT LLM pretraining: causal next-token prediction from random initialisation.

Engineering features: gradient accumulation, cosine LR with warmup, gradient
clipping, mixed precision when a supported accelerator exists, periodic
validation, resumable + integrity-checked checkpoints, graceful interrupt
handling, storage checks, per-run config snapshot, JSONL metric logs.

Example (100M model, genuine run):
  python training/pretrain.py --config configs/pretraining.yaml --resume auto
Pilot bounded by wall clock:
  python training/pretrain.py --config configs/pretraining_nano.yaml --time-budget-sec 900
"""
from __future__ import annotations

import argparse
import json
import math
import os
import random
import signal
import sys
import time
from pathlib import Path

import numpy as np
import torch
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.architecture import AnkitLM                      # noqa: E402
from model.configuration import AnkitConfig                 # noqa: E402
from tokenizer.ankit_tokenizer import AnkitTokenizer        # noqa: E402
from training.checkpoint import (                           # noqa: E402
    list_checkpoints, load_checkpoint, move_optimizer_state_to, prune_checkpoints,
    require_free_space,
    resolve_resume, save_checkpoint,
)
from training.data_loader import PackedTokenDataset         # noqa: E402
from training.device import (                               # noqa: E402
    describe_environment, make_grad_scaler, needs_grad_scaler, pick_device, pick_dtype,
)
from training.metrics import RunLogger, perplexity          # noqa: E402
from training.mirror import (                                # noqa: E402
    BackgroundMirror, read_heartbeat, restore_from_mirror, write_heartbeat,
)
from training.optimizer import build_optimizer, clip_gradients, set_lr  # noqa: E402
from training.scheduler import lr_at_step                   # noqa: E402


def set_seed(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)


# pick_device / pick_dtype live in training/device.py (T4-aware)


@torch.no_grad()
def evaluate(model: AnkitLM, dataset: PackedTokenDataset, cfg: dict, device: torch.device,
             dtype: torch.dtype) -> dict:
    model.eval()
    losses = []
    for x, y in dataset.batches(cfg["batch_size"], cfg["seq_len"], str(device),
                                max_batches=cfg["eval_batches"], seed=12345):
        with torch.autocast(device_type=device.type, dtype=dtype, enabled=dtype != torch.float32):
            out = model(x, targets=y)
        losses.append(float(out.loss.item()))
    model.train()
    mean = float(np.mean(losses)) if losses else float("nan")
    return {"val_loss": mean, "val_ppl": perplexity(mean), "val_batches": len(losses)}


def _watch_mirror(mirror, step: int, cfg: dict) -> None:
    """Shout if training is outrunning what is actually persisted.

    The previous session kept training while every checkpoint silently failed to
    reach Drive: the only trace was one warning line in a 21 KB log, and when the
    runtime stopped nobody could tell how far the model had got. This watchdog is
    the missing signal.
    """
    if mirror is None:
        return
    h = mirror.health(step=step)
    max_lag = int(cfg.get("mirror_max_lag_steps", 3 * int(cfg.get("save_every", 200))))
    max_age = float(cfg.get("mirror_max_age_s", 1800))
    lagged = h["steps_behind"] is not None and h["steps_behind"] > max_lag
    stale = h["last_ok_age_s"] is not None and h["last_ok_age_s"] > max_age
    never = h["copied"] == 0 and h["failed"] > 0
    if not (lagged or stale or never):
        return
    last = _watch_mirror_state.get("last_warn", -10 ** 9)
    if step - last < max_lag:
        return                                   # throttle: once per max_lag steps
    _watch_mirror_state["last_warn"] = step
    print("\n" + "!" * 78, flush=True)
    print(f"!!! MIRROR IS NOT KEEPING UP — step {step}, last checkpoint on Drive: "
          f"step {h['last_ok_step']} ({h['last_ok_age_s']}s ago), "
          f"failed={h['failed']} retried={h['retried']}", flush=True)
    print(f"!!! last error: {h['last_error']}", flush=True)
    print("!!! Training is fine but NOTHING is being saved. If the runtime stops now, "
          "every step since the last mirrored checkpoint is lost.", flush=True)
    print("!!! Usual cause: Google Drive out of space (empty the Drive trash) or the "
          "Drive mount went away. Check the log above for the copy error.", flush=True)
    print("!" * 78 + "\n", flush=True)


_watch_mirror_state: dict = {}


def _heartbeat(mirror_dir, mirror, payload: dict) -> None:
    if not mirror_dir:
        return
    write_heartbeat(mirror_dir, payload, mirror)


def _flush_mirror(mirror, cfg: dict) -> None:
    """Wait for the background Drive copy so the last checkpoint is really on Drive.

    Without this the process can exit - or the runtime can be stopped - while the
    newest copy is still in flight, and the session's last hours stay on a disk that
    is about to be wiped.
    """
    if mirror is None:
        return
    timeout = float(cfg.get("mirror_flush_timeout_s", 1800))
    t0 = time.time()
    ok = mirror.close(timeout=timeout)
    stats = mirror.stats
    print(f"[pretrain] mirror: {stats['copied']} copied, {stats['coalesced']} superseded, "
          f"{stats['failed']} failed, {stats['bytes_copied']/1e9:.2f} GB, "
          f"{time.time()-t0:.0f}s to flush"
          + ("" if ok else " (WARNING: flush timed out)"))
    if stats.get("last_error"):
        print(f"[pretrain] mirror last error: {stats['last_error']}")
    if stats["copied"] == 0 and (stats["failed"] or stats["retried"]):
        print("!" * 78)
        print("[pretrain] NO CHECKPOINT REACHED DRIVE IN THIS SESSION. The run itself "
              "was fine; persistence was not. Check Drive space / the mount.")
        print("!" * 78)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default="configs/pretraining.yaml")
    ap.add_argument("--max-steps", type=int, default=None)
    ap.add_argument("--time-budget-sec", type=int, default=None,
                    help="stop cleanly (with checkpoint) after this wall-clock budget")
    ap.add_argument("--resume", default=None, help="auto|none|<path to .pt>")
    ap.add_argument("--device", default=None)
    ap.add_argument("--run-id", default=None)
    args = ap.parse_args()

    cfg = yaml.safe_load(open(args.config, encoding="utf-8"))
    if args.max_steps:
        cfg["max_steps"] = args.max_steps
    if args.device:
        cfg["device"] = args.device
    run_id = args.run_id or time.strftime("%Y%m%d-%H%M%S")

    device = pick_device(cfg["device"])
    dtype = pick_dtype(cfg["dtype"], device)
    set_seed(cfg["seed"])
    torch.set_num_threads(max(1, os.cpu_count() or 1))

    require_free_space(cfg["checkpoint_dir"], cfg["storage_min_free_gb"])
    Path(cfg["checkpoint_dir"]).mkdir(parents=True, exist_ok=True)

    model_config = AnkitConfig.from_yaml(cfg["model_config"])
    tokenizer = AnkitTokenizer.load(cfg["tokenizer_dir"])
    if model_config.vocab_size != tokenizer.vocab_size:
        raise ValueError(
            f"model vocab_size ({model_config.vocab_size}) != tokenizer vocab_size "
            f"({tokenizer.vocab_size}); retrain/fix config before training"
        )
    train_ds = PackedTokenDataset(cfg["train_bin"])
    val_ds = PackedTokenDataset(cfg["val_bin"])
    model = AnkitLM(model_config).to(device)
    n_params = model.num_parameters()
    optimizer = build_optimizer(model, cfg)
    scaler = make_grad_scaler(dtype, device)      # only enabled for fp16 on CUDA
    mirror_dir = cfg.get("mirror_dir") or None
    # Copies to Drive run on a daemon thread: a 1.27 GB FUSE copy took 5-8 min and
    # used to stall the GPU loop (that is how the first long run lost its history).
    mirror = None
    if mirror_dir:
        try:
            mirror = BackgroundMirror(mirror_dir, keep=cfg.get("mirror_keep", 2))
            print(f"[pretrain] mirroring checkpoints asynchronously to {mirror_dir}")
        except OSError as exc:
            print(f"[pretrain] WARNING cannot mirror to {mirror_dir}: {exc} (continuing locally)")
    logger = RunLogger(cfg["log_dir"], cfg["run_name"], run_id)
    env_info = describe_environment()
    print(f"[pretrain] env: {json.dumps(env_info)}")
    if needs_grad_scaler(dtype, device):
        print("[pretrain] fp16 detected -> dynamic loss scaling enabled (Turing-class GPU)")

    # config snapshot for reproducibility
    snapshot = Path(cfg["log_dir"]) / f"{cfg['run_name']}-{run_id}-config.json"
    snapshot.write_text(json.dumps({"run": cfg, "model": model_config.to_dict(),
                                    "run_id": run_id, "params": n_params,
                                    "train_tokens_available": len(train_ds),
                                    "torch": torch.__version__,
                                    "device": str(device), "dtype": str(dtype)},
                                   indent=2) + "\n", encoding="utf-8")

    start_step, tokens_seen, best_val = 0, 0, None
    resume_mode = args.resume if args.resume is not None else cfg.get("resume", "auto")
    if resume_mode and resume_mode not in ("none", "false"):
        path = Path(resume_mode) if resume_mode not in ("auto",) else resolve_resume(cfg["checkpoint_dir"])
        if path is None and resume_mode == "auto" and mirror_dir:
            # a fresh Colab VM has an empty disk: the newest checkpoint is on Drive
            try:
                path = restore_from_mirror(mirror_dir, cfg["checkpoint_dir"])
            except OSError as exc:
                print(f"[pretrain] mirror restore failed: {exc}")
        if path:
            payload = load_checkpoint(path, map_location=str(device))
            model.load_state_dict(payload["model"])
            if payload.get("optimizer"):
                optimizer.load_state_dict(payload["optimizer"])
                moved = move_optimizer_state_to(optimizer, device)
                if moved:
                    print(f"[pretrain] moved {moved} optimizer-state tensors to {device}")
            if scaler.is_enabled() and payload.get("scaler"):
                scaler.load_state_dict(payload["scaler"])
            start_step = payload["step"]
            tokens_seen = payload.get("tokens_seen", 0)
            best_val = payload.get("best_val_loss")
            logger.log(event="resumed", step=start_step, checkpoint=str(path))
            print(f"[pretrain] resumed from {path} at step {start_step}")

    print(f"[pretrain] params={n_params:,} ({n_params/1e6:.2f}M) device={device} dtype={dtype} "
          f"train_tokens={len(train_ds):,} val_tokens={len(val_ds):,}")
    logger.log(event="start", step=start_step, params=n_params, device=str(device),
               dtype=str(dtype), train_tokens=len(train_ds), val_tokens=len(val_ds),
               model_config=model_config.to_dict(), run_config=cfg, run_id=run_id)

    interrupted = {"flag": False}

    def handle(signum, _frame):
        interrupted["flag"] = True
        print(f"\n[pretrain] signal {signum} received — will checkpoint and exit after this step")

    signal.signal(signal.SIGINT, handle)
    signal.signal(signal.SIGTERM, handle)

    model.train()
    _last = {"step": start_step, "tokens_seen": tokens_seen}
    t_start = time.time()
    tokens_per_step = cfg["batch_size"] * cfg["grad_accum_steps"] * cfg["seq_len"]
    step = start_step
    stop_reason = "max_steps"
    running_loss = 0.0
    micro = 0

    try:
        while step < cfg["max_steps"]:
            lr = lr_at_step(step, cfg["learning_rate"], cfg["warmup_steps"], cfg["max_steps"],
                            cfg["min_lr_ratio"], cfg["lr_schedule"])
            set_lr(optimizer, lr)
            optimizer.zero_grad(set_to_none=True)
            step_loss = 0.0
            step_t0 = time.time()
            for _ in range(cfg["grad_accum_steps"]):
                x, y = train_ds.get_batch(cfg["batch_size"], cfg["seq_len"], str(device))
                with torch.autocast(device_type=device.type, dtype=dtype,
                                    enabled=dtype != torch.float32):
                    out = model(x, targets=y)
                    loss = out.loss / cfg["grad_accum_steps"]
                scaler.scale(loss).backward()
                step_loss += float(loss.item())
                micro += 1
            if scaler.is_enabled():
                scaler.unscale_(optimizer)          # required before clipping in fp16
            grad_norm = clip_gradients(model.parameters(), cfg["grad_clip"])
            scaler.step(optimizer)
            scaler.update()
            tokens_seen += tokens_per_step
            step += 1
            running_loss += step_loss

            if step % cfg["log_every"] == 0 or step == start_step + 1:
                elapsed = time.time() - t_start
                steps_done = step - start_step
                tok_per_s = (tokens_seen - (start_step * tokens_per_step)) / max(elapsed, 1e-6)
                eta_min = (cfg["max_steps"] - step) * elapsed / max(steps_done, 1) / 60
                gpu_mem = (torch.cuda.max_memory_allocated() / 1e9) if device.type == "cuda" else 0.0
                logger.log(event="train", step=step, loss=round(running_loss / cfg["log_every"], 4),
                           lr=lr, grad_norm=round(grad_norm, 4), tokens_seen=tokens_seen,
                           tokens_per_s=round(tok_per_s, 1), gpu_mem_gb=round(gpu_mem, 3),
                           elapsed_s=round(elapsed, 1), eta_min=round(eta_min, 1))
                print(f"step {step:6d} loss={running_loss/cfg['log_every']:.4f} lr={lr:.2e} "
                      f"gnorm={grad_norm:.2f} tok/s={tok_per_s:7.1f} eta={eta_min:6.1f}m", flush=True)
                if mirror_dir:
                    hb_every = int(cfg.get("heartbeat_every", 100))
                    if hb_every > 0 and step % hb_every == 0:
                        _heartbeat(mirror_dir, mirror, {
                            "run_id": run_id, "step": step, "tokens_seen": tokens_seen,
                            "loss": round(running_loss / cfg["log_every"], 4),
                            "tokens_per_s": round(tok_per_s, 1),
                            "max_steps": cfg["max_steps"],
                            "pid": os.getpid(),
                        })
                        _watch_mirror(mirror, step, cfg)
                running_loss = 0.0

            if step % cfg["eval_every"] == 0:
                metrics = evaluate(model, val_ds, cfg, device, dtype)
                is_best = best_val is None or (metrics["val_loss"] < best_val)
                if is_best:
                    best_val = metrics["val_loss"]
                logger.log(event="eval", step=step, **metrics, best_val_loss=best_val, is_best=is_best)
                print(f"  [eval] step {step} val_loss={metrics['val_loss']:.4f} "
                      f"val_ppl={metrics['val_ppl']:.2f} best={best_val:.4f}", flush=True)
                if is_best:
                    # local only: mirroring best-step too doubled the Drive traffic and
                    # made the newest *step* checkpoint lag behind even further
                    save_checkpoint(cfg["checkpoint_dir"], f"best-step{step}", model, optimizer, step,
                                    tokens_seen, model_config, cfg, best_val,
                                    extra={"eval": metrics, "run_id": run_id},
                                    scaler=scaler)

            if step % cfg["save_every"] == 0:
                save_checkpoint(cfg["checkpoint_dir"], f"step{step}", model, optimizer, step,
                                tokens_seen, model_config, cfg, best_val,
                                extra={"run_id": run_id}, scaler=scaler, mirror=mirror)
                pruned = prune_checkpoints(cfg["checkpoint_dir"], cfg["keep_last_checkpoints"])
                if pruned:
                    logger.log(event="pruned", step=step, removed=pruned)

            if args.time_budget_sec and (time.time() - t_start) > args.time_budget_sec:
                stop_reason = "time_budget"
                break
            if interrupted["flag"]:
                stop_reason = "interrupted"
                break

    except BaseException as exc:  # noqa: BLE001 - always leave a recoverable checkpoint
        crash_path = save_checkpoint(
            cfg["checkpoint_dir"], "crashed", model, optimizer, step, tokens_seen,
            model_config, cfg, best_val,
            extra={"run_id": run_id, "error": f"{type(exc).__name__}: {exc}"},
            scaler=scaler, mirror=mirror)
        logger.log(event="crash", step=step, error=f"{type(exc).__name__}: {exc}",
                   checkpoint=str(crash_path))
        print(f"[pretrain] crashed at step {step}: {exc} -> checkpoint {crash_path}")
        _flush_mirror(mirror, cfg)
        raise

    final_metrics = evaluate(model, val_ds, cfg, device, dtype)
    final_path = save_checkpoint(
        cfg["checkpoint_dir"], "final", model, optimizer, step, tokens_seen,
        model_config, cfg, final_metrics["val_loss"],
        extra={"eval": final_metrics, "run_id": run_id, "stop_reason": stop_reason},
        scaler=scaler, mirror=mirror,
    )
    logger.log(event="end", step=step, tokens_seen=tokens_seen, stop_reason=stop_reason,
               final_val_loss=final_metrics["val_loss"], checkpoint=str(final_path))
    logger.summary(
        run_id=run_id, run_name=cfg["run_name"], params=n_params, steps=step,
        tokens_seen=tokens_seen, tokens_per_step=tokens_per_step,
        final_val_loss=final_metrics["val_loss"], final_val_ppl=final_metrics["val_ppl"],
        best_val_loss=best_val, stop_reason=stop_reason,
        duration_s=round(time.time() - t_start, 1),
        checkpoints=[m["tag"] for m in list_checkpoints(cfg["checkpoint_dir"])],
    )
    print(f"[pretrain] done: step={step} tokens={tokens_seen:,} "
          f"val_loss={final_metrics['val_loss']:.4f} stop={stop_reason} -> {final_path}")
    _flush_mirror(mirror, cfg)


if __name__ == "__main__":
    main()
