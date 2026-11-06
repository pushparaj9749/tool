"""GPU benchmark for the real ANKIT LLM architecture (97,435,392 params).

Measures per (dtype, batch, seq_len): seconds/step (median of N timed steps after
warm-up), tokens/s, peak VRAM, GPU utilisation, system RAM, and numerical
stability (every loss, finite check, grad norms, fp16 scaler scale).

Configs that OOM are recorded as "oom" — nothing is silently skipped or estimated.

    python benchmarks/bench_gpu.py --out reports/gpu_benchmark
    python benchmarks/bench_gpu.py --dtypes fp32 fp16 --batch-sizes 1 2 4 --seq-lens 512
"""
from __future__ import annotations

import argparse
import gc
import json
import math
import statistics
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import torch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from model.architecture import AnkitLM                        # noqa: E402
from model.configuration import AnkitConfig                   # noqa: E402
from training.data_loader import PackedTokenDataset           # noqa: E402
from training.device import (                                 # noqa: E402
    describe_environment, make_grad_scaler, pick_dtype,
)
from training.optimizer import build_optimizer, clip_gradients  # noqa: E402


def system_ram_gb() -> Optional[float]:
    try:
        import psutil
        return round(psutil.Process().memory_info().rss / 1e9, 2)
    except Exception:                                        # noqa: BLE001
        try:
            import resource
            return round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e6, 2)
        except Exception:                                    # noqa: BLE001
            return None


def gpu_utilization() -> Optional[float]:
    try:
        import pynvml
        pynvml.nvmlInit()
        handle = pynvml.nvmlDeviceGetHandleByIndex(0)
        return float(pynvml.nvmlDeviceGetUtilizationRates(handle).gpu)
    except Exception:                                        # noqa: BLE001
        return None


def bench_config(model_config, dataset, dtype, batch_size, seq_len, warmup, steps,
                 device, lr=1e-4) -> Dict[str, object]:
    res: Dict[str, object] = {
        "dtype": str(dtype).replace("torch.", ""), "batch_size": batch_size,
        "seq_len": seq_len, "tokens_per_step": batch_size * seq_len, "status": "ok",
    }
    torch.manual_seed(0)
    if device.type == "cuda":
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()
    model = AnkitLM(model_config).to(device)
    opt = build_optimizer(model, {"weight_decay": 0.1, "learning_rate": lr,
                                 "beta1": 0.9, "beta2": 0.95})
    scaler = make_grad_scaler(dtype, device)
    amp = dtype != torch.float32

    def step():
        x, y = dataset.get_batch(batch_size, seq_len, str(device))
        opt.zero_grad(set_to_none=True)
        with torch.autocast(device_type=device.type, dtype=dtype, enabled=amp):
            out = model(x, targets=y)
        scaler.scale(out.loss).backward()
        if scaler.is_enabled():
            scaler.unscale_(opt)
        gnorm = clip_gradients(model.parameters(), 1.0)
        scaler.step(opt)
        scaler.update()
        return float(out.loss.detach()), float(gnorm)

    try:
        for _ in range(warmup):
            step()
        if device.type == "cuda":
            torch.cuda.synchronize()
            torch.cuda.reset_peak_memory_stats()

        times, losses, gnorms, utils = [], [], [], []
        for _ in range(steps):
            t0 = time.perf_counter()
            loss, gnorm = step()
            if device.type == "cuda":
                torch.cuda.synchronize()
            times.append(time.perf_counter() - t0)
            losses.append(loss)
            gnorms.append(gnorm)
            u = gpu_utilization()
            if u is not None:
                utils.append(u)

        median = statistics.median(times)
        res.update({
            "seconds_per_step": round(median, 4),
            "seconds_per_step_min": round(min(times), 4),
            "seconds_per_step_max": round(max(times), 4),
            "tokens_per_second": round(batch_size * seq_len / median, 1),
            "losses": [round(v, 4) for v in losses],
            "loss_finite": not any(math.isnan(v) or math.isinf(v) for v in losses),
            "grad_norms": [round(v, 3) for v in gnorms],
            "scaler_enabled": bool(scaler.is_enabled()),
            "scaler_scale": float(scaler.get_scale()) if scaler.is_enabled() else None,
            "gpu_utilization_pct": round(statistics.mean(utils), 1) if utils else None,
        })
        if not res["loss_finite"]:
            res["status"] = "nan"
        if device.type == "cuda":
            res["peak_vram_gb"] = round(torch.cuda.max_memory_allocated() / 1e9, 2)
            res["peak_vram_reserved_gb"] = round(torch.cuda.max_memory_reserved() / 1e9, 2)
        res["system_ram_gb"] = system_ram_gb()
    except torch.cuda.OutOfMemoryError:
        res["status"] = "oom"
        torch.cuda.empty_cache()
    except RuntimeError as exc:
        res["status"] = f"error: {type(exc).__name__}: {exc}"[:200]
    finally:
        del model, opt, scaler
        gc.collect()
        if device.type == "cuda":
            torch.cuda.empty_cache()
    return res


def markdown_table(results: List[Dict[str, object]]) -> str:
    head = ("| dtype | batch | seq | status | s/step | tokens/s | peak VRAM (GB) | "
            "GPU util % | loss (last) | finite |")
    sep = "|---|---|---|---|---|---|---|---|---|---|"
    rows = [head, sep]
    for r in results:
        rows.append("| {} | {} | {} | {} | {} | {} | {} | {} | {} | {} |".format(
            r["dtype"], r["batch_size"], r["seq_len"], r["status"],
            r.get("seconds_per_step", "—"), r.get("tokens_per_second", "—"),
            r.get("peak_vram_gb", "—"), r.get("gpu_utilization_pct", "—"),
            (r.get("losses") or ["—"])[-1], r.get("loss_finite", "—")))
    return "\n".join(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-config", default="configs/model.yaml")
    ap.add_argument("--train-bin", default="data/processed/pretrain_train.bin")
    ap.add_argument("--dtypes", nargs="+", default=["fp32", "fp16", "bf16"])
    ap.add_argument("--batch-sizes", nargs="+", type=int, default=[1, 2, 4, 8, 16, 32])
    ap.add_argument("--seq-lens", nargs="+", type=int, default=[256, 512, 1024])
    ap.add_argument("--warmup", type=int, default=2)
    ap.add_argument("--steps", type=int, default=5)
    ap.add_argument("--out", default="reports/gpu_benchmark")
    ap.add_argument("--max-vram-gb", type=float, default=14.0,
                    help="skip a config if the previous one already used more than this")
    args = ap.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    env = describe_environment()
    print(json.dumps(env, indent=2))
    if device.type != "cuda":
        print("[bench] CUDA not available — this benchmark is meant for the Colab T4.")
        print("[bench] Run a 1-step CPU sanity check instead.")
        args.dtypes, args.batch_sizes, args.seq_lens, args.steps = ["fp32"], [1], [256], 1

    model_config = AnkitConfig.from_yaml(args.model_config)
    dataset = PackedTokenDataset(args.train_bin)
    dtype_map = {"fp32": torch.float32, "fp16": torch.float16, "bf16": torch.bfloat16}

    results: List[Dict[str, object]] = []
    for name in args.dtypes:
        dtype = dtype_map[name]
        if device.type == "cuda" and name == "bf16" and not env.get("bf16_accelerated", False):
            print(f"[bench] {name}: this GPU does not accelerate bf16 — testing anyway, "
                  f"expect it to be slower than fp16.")
        for seq_len in args.seq_lens:
            for bs in args.batch_sizes:
                print(f"[bench] dtype={name} bs={bs} seq={seq_len} ...", flush=True)
                r = bench_config(model_config, dataset, dtype, bs, seq_len,
                                 args.warmup, args.steps, device)
                results.append(r)
                print(f"        -> {r['status']} "
                      f"{r.get('seconds_per_step', '—')} s/step, "
                      f"{r.get('tokens_per_second', '—')} tok/s, "
                      f"vram {r.get('peak_vram_gb', '—')} GB", flush=True)

    payload = {
        "environment": env,
        "model_config": model_config.to_dict(),
        "measured_parameters": AnkitLM(model_config).num_parameters(),
        "warmup_steps": args.warmup,
        "timed_steps": args.steps,
        "results": results,
        "cpu_baseline_tokens_per_second": 89.0,
        "note": ("Median-of-N wall-clock timing after warm-up, with cuda.synchronize(). "
                 "OOM configs are recorded, not skipped."),
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.with_suffix(".json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    md = ["# ANKIT LLM v0.1 — GPU benchmark", "",
          "```", json.dumps(env, indent=2), "```", "",
          f"Parameters: **{payload['measured_parameters']:,}** · warm-up {args.warmup} steps · "
          f"{args.steps} timed steps · CPU baseline: 89 tok/s", "",
          markdown_table(results), "",
          "OOM / NaN rows are real measurements, not gaps.", ""]
    out.with_suffix(".md").write_text("\n".join(md), encoding="utf-8")
    print("\n" + markdown_table(results))
    print(f"\n[bench] wrote {out.with_suffix('.json')} and {out.with_suffix('.md')}")


if __name__ == "__main__":
    main()
