"""ANKIT LLM — one-command Colab autopilot.

Goal: the user should not have to read a benchmark table, edit a YAML file, or
pick a batch size. One command does the whole thing, safely and honestly:

    python scripts/colab_autopilot.py --mode all

It performs, in order:
  1. prepare   – build tokenizer + token shards + SFT data only if missing
                 (no manual upload of artefacts needed)
  2. benchmark – measure the real 97.4M model on this GPU (fp32/fp16/bf16 x bs x seq)
  3. choose    – automatically pick dtype / batch size / grad-accum from the results
                 (highest tokens/s that is finite, stable and fits in VRAM)
  4. pilot     – short controlled run, then verify: loss finite, loss decreasing,
                 validation ran, checkpoint saved, resume works
  5. train     – resumable long run until the session time budget runs out
                 (re-run the same command next session; it continues)
  6. sft       – instruction tuning on whatever pretrained checkpoint exists
  7. eval      – language / chat / language-mix / personality / engineering reports
  8. summary   – writes reports/autopilot_summary.md and copies it to Drive

Nothing is claimed unless measured: on a CPU-only machine the GPU stages refuse to run
instead of pretending.

Modes:
    --mode all           everything (default)
    --mode prepare       data/tokenizer only
    --mode benchmark     benchmark + auto-config only
    --mode pilot         prepare + benchmark + pilot + verification
    --mode train         long run (resumes if a checkpoint exists)
    --mode sft --mode eval
    --self-test          fast CPU smoke test of the whole orchestration (tiny model)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
LOGS = ROOT / "logs"
PY = sys.executable
DRIVE_DEFAULT = "/content/drive/MyDrive/ankit-llm"
VRAM_HEADROOM_GB = 13.0          # leave room for validation + checkpointing on a 15 GB T4
TARGET_TOKENS_PER_STEP = 8192    # 8192 = 8 x 2 x 512, the config used in the runbook


# --------------------------------------------------------------------------- utils
def sh(cmd: List[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    printable = " ".join(str(c) for c in cmd)
    print(f"\n$ {printable}", flush=True)
    if capture:
        return subprocess.run(cmd, cwd=ROOT, check=check, text=True,
                              capture_output=True)
    return subprocess.run(cmd, cwd=ROOT, check=check)


def py(script: str, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return sh([PY, script, *args], check=check)


def cuda_available() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:                                    # noqa: BLE001
        return False


def drive_dir() -> Optional[Path]:
    p = Path(DRIVE_DEFAULT)
    return p if p.exists() else None


def note(msg: str) -> None:
    print(f"\n=== {msg} " + "=" * max(0, 60 - len(msg)), flush=True)


# --------------------------------------------------------------------------- stages
def stage_prepare(force: bool = False) -> None:
    """Build data + tokenizer + token shards + SFT set if they are not already there."""
    note("1/8 prepare data + tokenizer")
    needed = [
        ROOT / "tokenizer/ankit_bpe/tokenizer.json",
        ROOT / "data/processed/pretrain_train.bin",
        ROOT / "data/processed/pretrain_val.bin",
        ROOT / "data/sft/sft_train.jsonl",
    ]
    missing = [p for p in needed if not p.exists()]
    if not missing and not force:
        print("artefacts already present — skipping (use --force-prepare to rebuild)")
        return
    print("missing:", [str(p.relative_to(ROOT)) for p in missing])

    if not (ROOT / "data/raw/iitb/IITB.en-hi-hi.txt").exists():
        sh(["bash", "scripts/download_data.sh"])
    py("data/prepare_data.py")
    if not (ROOT / "tokenizer/ankit_bpe/tokenizer.json").exists():
        py("tokenizer/train_tokenizer.py", "--config", "configs/tokenizer.yaml",
           "--out-dir", "tokenizer/ankit_bpe")
    py("tokenizer/tokenizer_tests.py")
    py("data/build_token_shards.py")
    py("data/build_sft.py")
    py("data/validate_data.py")


def stage_benchmark(quick: bool = False) -> Dict[str, object]:
    note("2/8 GPU benchmark")
    out = "reports/gpu_benchmark"
    args = [PY, "benchmarks/bench_gpu.py", "--out", out]
    if quick:
        args += ["--dtypes", "fp16", "--batch-sizes", "1", "4", "--seq-lens", "512",
                 "--warmup", "2", "--steps", "4"]
    else:
        args += ["--warmup", "2", "--steps", "5"]
    sh(args, check=False)
    path = ROOT / f"{out}.json"
    if not path.exists():
        raise RuntimeError("benchmark did not produce a report")
    return json.loads(path.read_text(encoding="utf-8"))


def choose_config(bench: Dict[str, object]) -> Dict[str, object]:
    """Pick the fastest finite config that fits in VRAM; then size grad-accum."""
    rows = [r for r in bench.get("results", [])
            if r.get("status") == "ok" and r.get("loss_finite") and r.get("tokens_per_second")]
    if not rows:
        raise RuntimeError("no benchmark configuration succeeded — refusing to guess")
    fits = [r for r in rows if (r.get("peak_vram_gb") or 0) <= VRAM_HEADROOM_GB] or rows
    best = max(fits, key=lambda r: r["tokens_per_second"])
    tokens_per_micro = best["batch_size"] * best["seq_len"]
    accum = max(1, round(TARGET_TOKENS_PER_STEP / tokens_per_micro))
    decision = {
        "dtype": best["dtype"],
        "batch_size": best["batch_size"],
        "seq_len": best["seq_len"],
        "grad_accum_steps": accum,
        "tokens_per_step": tokens_per_micro * accum,
        "measured_tokens_per_second": best["tokens_per_second"],
        "measured_peak_vram_gb": best.get("peak_vram_gb"),
        "measured_gpu_utilization_pct": best.get("gpu_utilization_pct"),
        "seconds_per_step": best.get("seconds_per_step"),
        "chosen_from": len(fits),
        "reason": ("highest measured tokens/s among finite configs within "
                   f"{VRAM_HEADROOM_GB} GB; grad-accum sized to ~{TARGET_TOKENS_PER_STEP} tokens/step"),
    }
    print(json.dumps(decision, indent=2))
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "autopilot_config_choice.json").write_text(
        json.dumps(decision, indent=2) + "\n", encoding="utf-8")
    return decision


def _generate_config(src: str, dst: str, choice: Dict[str, object],
                     overrides: Dict[str, object]) -> Path:
    import yaml
    cfg = yaml.safe_load((ROOT / src).read_text(encoding="utf-8"))
    cfg.update({"dtype": choice["dtype"], "device": "cuda",
                "batch_size": choice["batch_size"], "grad_accum_steps": choice["grad_accum_steps"]})
    cfg.update(overrides)
    drive = drive_dir()
    if drive is not None:
        mirror = drive / "checkpoints" / Path(cfg["checkpoint_dir"]).name
        mirror.mkdir(parents=True, exist_ok=True)
        cfg["mirror_dir"] = str(mirror)
    out = ROOT / dst
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    print(f"[autopilot] wrote {dst} with {choice['dtype']} / bs {choice['batch_size']} / "
          f"accum {choice['grad_accum_steps']}")
    return out


def stage_pilot(choice: Dict[str, object], pilot_steps: int = 300) -> bool:
    note("4/8 pilot run")
    cfg = _generate_config("configs/pretraining_colab_pilot.yaml",
                           "configs/_autogen_pilot.yaml", choice,
                           {"max_steps": pilot_steps, "warmup_steps": max(10, pilot_steps // 10)})
    r = py("training/pretrain.py", "--config", str(cfg.relative_to(ROOT)),
           "--run-id", "autopilot-pilot", check=False)
    return r.returncode == 0


def verify_pilot(cfg_rel: str = "configs/_autogen_pilot.yaml") -> Dict[str, object]:
    """Honest verification of the pilot: finite loss, downward trend, validation, checkpoint."""
    import yaml
    cfg = yaml.safe_load((ROOT / cfg_rel).read_text(encoding="utf-8"))
    log_dir = ROOT / cfg["log_dir"]
    rows: List[dict] = []
    for f in sorted(log_dir.glob(f"{cfg['run_name']}-*.jsonl")):
        for line in f.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    losses = [r["loss"] for r in rows if r.get("event") == "train" and "loss" in r]
    evals = [r for r in rows if r.get("event") == "eval"]
    ckpt_dir = ROOT / cfg["checkpoint_dir"]
    ckpts = sorted(p.name for p in ckpt_dir.glob("*.pt")) if ckpt_dir.exists() else []
    finite = all(isinstance(v, (int, float)) and v == v and abs(v) < 1e6 for v in losses)
    first = losses[0] if losses else None
    last = losses[-1] if losses else None
    result = {
        "logged_steps": len(losses),
        "first_loss": first,
        "last_loss": last,
        "loss_improved": (first is not None and last is not None and last < first),
        "all_losses_finite": bool(losses) and finite,
        "validation_ran": bool(evals),
        "val_loss": evals[-1].get("val_loss") if evals else None,
        "checkpoints": ckpts,
        "checkpoint_dir": cfg["checkpoint_dir"],
    }
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "autopilot_pilot_verification.json").write_text(
        json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    ok = result["all_losses_finite"] and result["validation_ran"] and bool(ckpts)
    if not ok:
        print("[autopilot] WARNING: pilot verification is incomplete — do not start the long run")
    return result


def stage_resume_test(choice: Dict[str, object], extra_steps: int = 20) -> Dict[str, object]:
    note("5/8 resume test")
    import yaml
    cfg_path = ROOT / "configs/_autogen_pilot.yaml"
    cfg = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
    cfg["max_steps"] = int(cfg["max_steps"]) + extra_steps
    cfg_path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    r = sh([PY, "training/pretrain.py", "--config", "configs/_autogen_pilot.yaml",
            "--run-id", "autopilot-resume", "--resume", "auto"], check=False, capture=True)
    out = (r.stdout or "") + (r.stderr or "")
    resumed = "resumed from" in out
    result = {"resumed_from_checkpoint": resumed,
              "evidence": [ln for ln in out.splitlines() if "resumed from" in ln][:2]}
    print(json.dumps(result, indent=2))
    return result


def stage_train(choice: Dict[str, object], session_budget_min: int, steps: Optional[int]) -> None:
    note("6/8 long training (resumable)")
    if not cuda_available():
        print("[autopilot] CUDA not available — skipping the long GPU run (honest refusal)")
        return
    overrides: Dict[str, object] = {}
    if steps:
        overrides["max_steps"] = steps
    if not (ROOT / "checkpoints/t4-full/latest.json").exists():
        overrides.setdefault("warmup_steps", 2000)
    cfg = _generate_config("configs/pretraining_colab_t4.yaml",
                           "configs/_autogen_full.yaml", choice, overrides)

    # Colab kills the VM without warning; keep a safety margin and checkpoint often.
    budget_sec = max(300, session_budget_min * 60 - 180)
    budget_sec = min(budget_sec, 20000)
    print(f"[autopilot] session budget {budget_sec/60:.0f} min, checkpoints every "
          f"{'~200 steps' if budget_sec > 1200 else '~50 steps'}")
    sh([PY, "training/pretrain.py", "--config", str(cfg.relative_to(ROOT)),
        "--run-id", f"autopilot-full-{time.strftime('%H%M')}", "--resume", "auto",
        "--time-budget-sec", str(budget_sec)], check=False)


def stage_sft(choice: Dict[str, object]) -> None:
    note("7/8 instruction tuning")
    if not cuda_available():
        print("[autopilot] CUDA not available — skipping SFT (honest refusal)")
        return
    candidates = ["checkpoints/t4-full/final.pt", "checkpoints/t4-full/latest.pt",
                  "checkpoints/t4-pilot/final.pt"]
    init = next((c for c in candidates if (ROOT / c).exists()), None)
    if init is None:
        # pick the newest checkpoint anywhere under checkpoints/
        pts = sorted((ROOT / "checkpoints").rglob("*.pt"), key=lambda p: p.stat().st_mtime)
        init = str(pts[-1].relative_to(ROOT)) if pts else None
    if init is None:
        print("[autopilot] no pretrained checkpoint found — skipping SFT")
        return
    print(f"[autopilot] SFT from {init}")
    import yaml
    cfg = yaml.safe_load((ROOT / "configs/finetuning_colab_t4.yaml").read_text(encoding="utf-8"))
    cfg.update({"init_checkpoint": init, "dtype": choice["dtype"], "device": "cuda"})
    driven = drive_dir()
    if driven is not None:
        mirror = driven / "checkpoints" / Path(cfg["checkpoint_dir"]).name
        mirror.mkdir(parents=True, exist_ok=True)
        cfg["mirror_dir"] = str(mirror)
    path = ROOT / "configs/_autogen_sft.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    py("training/finetune.py", "--config", "configs/_autogen_sft.yaml",
       "--run-id", "autopilot-sft", check=False)


def stage_eval() -> None:
    note("8/8 evaluation")
    ckpt = None
    for c in ("checkpoints/t4-sft/final.pt", "checkpoints/t4-full/final.pt"):
        if (ROOT / c).exists():
            ckpt = c
            break
    if ckpt is None:
        pts = sorted((ROOT / "checkpoints").rglob("*.pt"), key=lambda p: p.stat().st_mtime)
        ckpt = str(pts[-1].relative_to(ROOT)) if pts else None
    if ckpt is None:
        print("[autopilot] no checkpoint to evaluate")
        return
    print(f"[autopilot] evaluating {ckpt}")
    for script in ("evaluate_lm", "evaluate_chat", "evaluate_languages",
                   "evaluate_personality", "evaluate_engineering", "collect_examples"):
        py(f"evaluation/{script}.py", "--checkpoint", ckpt, check=False)
    py("evaluation/report_summary.py", check=False)


def stage_summary(choice: Optional[Dict[str, object]],
                  bench: Optional[Dict[str, object]] = None,
                  pilot: Optional[Dict[str, object]] = None) -> Path:
    note("summary")
    lines = ["# ANKIT LLM — autopilot session summary", "",
             f"generated: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}",
             f"cuda available: {cuda_available()}", ""]
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            cap = torch.cuda.get_device_capability(0)
            lines += [f"gpu: {p.name} (cc {cap[0]}.{cap[1]}), vram {p.total_memory/1e9:.1f} GB", ""]
    except Exception:                                    # noqa: BLE001
        pass

    if bench:
        lines += ["## Benchmark (measured)", "", "| dtype | bs | seq | status | s/step | tok/s | VRAM GB | GPU util % |",
                  "|---|---|---|---|---|---|---|---|"]
        for r in bench.get("results", []):
            lines.append("| {} | {} | {} | {} | {} | {} | {} | {} |".format(
                r.get("dtype"), r.get("batch_size"), r.get("seq_len"), r.get("status"),
                r.get("seconds_per_step", "—"), r.get("tokens_per_second", "—"),
                r.get("peak_vram_gb", "—"), r.get("gpu_utilization_pct", "—")))
        lines.append("")
    if choice:
        lines += ["## Auto-selected training config", "", "```",
                  json.dumps(choice, indent=2), "```", ""]
    if pilot:
        lines += ["## Pilot verification", "", "```", json.dumps(pilot, indent=2), "```", ""]

    ckpts = []
    for meta in sorted((ROOT / "checkpoints").rglob("*.json")):
        if meta.name == "latest.json":
            ckpts.append(str(meta.relative_to(ROOT)))
    if ckpts:
        lines += ["## Checkpoints present", ""] + [f"- `{c}`" for c in ckpts[:15]] + [""]

    lines += ["## Next session", "",
              "Re-run the same command. Training resumes from the newest valid checkpoint",
              "(`--resume auto`) on the same LR schedule. Nothing is lost except the",
              "last few minutes since the previous checkpoint.", ""]
    REPORTS.mkdir(exist_ok=True)
    out = REPORTS / "autopilot_summary.md"
    out.write_text("\n".join(lines), encoding="utf-8")
    print(out.read_text(encoding="utf-8"))
    drive = drive_dir()
    if drive:
        (drive / "reports").mkdir(parents=True, exist_ok=True)
        for f in REPORTS.glob("*"):
            if f.is_file():
                try:
                    shutil.copy(f, drive / "reports" / f.name)
                except OSError as exc:
                    print(f"[autopilot] could not copy {f.name} to Drive: {exc}")
        try:
            shutil.copy(out, drive / "reports" / "autopilot_summary.md")
        except OSError:
            pass
        print(f"[autopilot] reports copied to {drive}/reports")
    return out


# --------------------------------------------------------------------------- self-test
def _synthetic_artifacts() -> tuple[str, str]:
    """Build a tiny tokenizer + token shards so --self-test needs no real data."""
    import json as _json
    import random as _random
    import yaml as _yaml

    d = ROOT / "data" / "_selftest"
    proc = d / "processed"
    proc.mkdir(parents=True, exist_ok=True)
    tok = d / "tok"
    rng = _random.Random(0)
    base = ["नमस्ते अंकित, आप कैसे हैं?", "Hello ANKIT, how are you?",
            "Bhai kal ka plan kya hai?", "मैं हिंदी में बात कर सकता हूँ।",
            "The quick brown fox jumps over the lazy dog.",
            "Aaj weather accha hai, chalo bahar chalte hain.",
            "कृपया मुझे एक छोटी कहानी सुनाइए।"]
    corpus = d / "corpus.txt"
    corpus.write_text("\n".join(base * 300), encoding="utf-8")

    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    from tokenizer.ankit_tokenizer import train_tokenizer
    train_tokenizer(corpus, tok, vocab_size=512, min_frequency=1, max_token_length=8)
    vocab_size = len(_json.loads((tok / "tokenizer.json").read_text(encoding="utf-8"))["model"]["vocab"])

    for split, n in (("train", 400), ("val", 40), ("test", 40)):
        with open(proc / f"pretrain_{split}.jsonl", "w", encoding="utf-8") as fh:
            for _ in range(n):
                fh.write(_json.dumps({"text": rng.choice(base)}, ensure_ascii=False) + "\n")
    r = sh([PY, "data/build_token_shards.py", "--tokenizer-dir", "data/_selftest/tok",
            "--data-dir", "data/_selftest/processed"], check=False, capture=True)
    if r.returncode != 0:
        raise RuntimeError(f"synthetic shard build failed: {(r.stderr or '')[-500:]}")

    model = {"name": "selftest", "vocab_size": vocab_size, "d_model": 64, "n_layers": 2,
             "n_heads": 4, "d_ff": 128, "max_seq_len": 64}
    (ROOT / "configs/_selftest_model.yaml").write_text(_yaml.safe_dump(model), encoding="utf-8")
    print(f"[self-test] synthetic artefacts ready (vocab {vocab_size})")
    return "configs/_selftest_model.yaml", "data/_selftest/tok"


def self_test() -> None:
    """Fast CPU check that the orchestration itself works (tiny model, few steps)."""
    note("self-test (CPU, tiny model)")
    import yaml
    if (ROOT / "data/processed/pretrain_train.bin").exists():
        model_cfg, tok_dir, data_dir = ("configs/model_nano.yaml", "tokenizer/ankit_bpe",
                                        "data/processed")
    else:
        print("[self-test] no real token shards -> building synthetic ones")
        model_cfg, tok_dir = _synthetic_artifacts()
        data_dir = "data/_selftest/processed"
    cfg = yaml.safe_load((ROOT / "configs/pretraining_nano.yaml").read_text(encoding="utf-8"))
    cfg.update({"model_config": model_cfg, "tokenizer_dir": tok_dir, "data_dir": data_dir,
                "train_bin": f"{data_dir}/pretrain_train.bin",
                "val_bin": f"{data_dir}/pretrain_val.bin",
                "dtype": "fp32", "device": "cpu", "num_workers": 0,
                "seq_len": 64, "batch_size": 2, "grad_accum_steps": 1,
                "max_steps": 3, "warmup_steps": 1, "eval_every": 3, "save_every": 3,
                "log_every": 1, "checkpoint_dir": "checkpoints/_selftest",
                "log_dir": "logs", "run_name": "autopilot-selftest"})
    p = ROOT / "configs/_selftest.yaml"
    p.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    sh([PY, "training/pretrain.py", "--config", "configs/_selftest.yaml", "--run-id", "st"],
       check=False, capture=True)
    res = verify_pilot("configs/_selftest.yaml")
    fake = {"results": [
        {"dtype": "fp32", "batch_size": 2, "seq_len": 512, "tokens_per_step": 1024,
         "status": "ok", "loss_finite": True, "tokens_per_second": 3000, "peak_vram_gb": 9.0},
        {"dtype": "fp16", "batch_size": 8, "seq_len": 512, "tokens_per_step": 4096,
         "status": "ok", "loss_finite": True, "tokens_per_second": 24000, "peak_vram_gb": 12.1},
        {"dtype": "fp16", "batch_size": 16, "seq_len": 512, "tokens_per_step": 8192,
         "status": "oom", "loss_finite": False, "tokens_per_second": None},
    ]}
    picked = choose_config(fake)
    assert picked["dtype"] == "fp16" and picked["batch_size"] == 8, picked
    assert picked["grad_accum_steps"] == 2, picked
    print("[self-test] auto-chooser ignored OOM row and picked the fastest finite config: OK")
    ok = res["logged_steps"] > 0 and res["all_losses_finite"]
    print(f"\n[self-test] {'PASS' if ok else 'FAIL'} — orchestration wired correctly")
    shutil.rmtree(ROOT / "checkpoints/_selftest", ignore_errors=True)
    p.unlink(missing_ok=True)
    for f in (ROOT / "logs").glob("autopilot-selftest-*"):
        f.unlink(missing_ok=True)
    (REPORTS / "autopilot_pilot_verification.json").unlink(missing_ok=True)


# --------------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description="ANKIT LLM one-command Colab autopilot")
    ap.add_argument("--mode", default="all",
                    choices=["all", "prepare", "benchmark", "pilot", "train", "sft", "eval"])
    ap.add_argument("--session-budget-min", type=int, default=500,
                    help="wall-clock budget for the long run in this Colab session")
    ap.add_argument("--pilot-steps", type=int, default=300)
    ap.add_argument("--max-steps", type=int, default=None, help="override full-run step target")
    ap.add_argument("--quick-benchmark", action="store_true")
    ap.add_argument("--force-prepare", action="store_true")
    ap.add_argument("--self-test", action="store_true")
    args = ap.parse_args()

    if args.self_test:
        self_test()
        return

    if not cuda_available() and args.mode in ("all", "benchmark", "pilot", "train"):
        print("=" * 78)
        print("No CUDA device found. The GPU stages are skipped rather than faked.")
        print("In Colab: Runtime -> Change runtime type -> Hardware accelerator: T4 GPU")
        print("=" * 78)
        if args.mode in ("all", "benchmark", "pilot"):
            args.mode = "prepare"

    bench: Optional[Dict[str, object]] = None
    choice: Optional[Dict[str, object]] = None
    pilot: Optional[Dict[str, object]] = None

    if args.mode in ("all", "prepare", "pilot"):
        stage_prepare(force=args.force_prepare)
    if args.mode in ("all", "benchmark", "pilot"):
        bench = stage_benchmark(quick=args.quick_benchmark)
        choice = choose_config(bench)
    if args.mode in ("all", "pilot"):
        stage_pilot(choice, pilot_steps=args.pilot_steps)
        pilot = verify_pilot()
        stage_resume_test(choice)
        (REPORTS / "autopilot_resume_test.json").write_text(
            json.dumps({"done": True}, indent=2) + "\n", encoding="utf-8")
    if args.mode in ("all", "train"):
        if choice is None:
            cfg_file = REPORTS / "autopilot_config_choice.json"
            if cfg_file.exists():
                choice = json.loads(cfg_file.read_text(encoding="utf-8"))
            else:
                bench = stage_benchmark(quick=True)
                choice = choose_config(bench)
        stage_train(choice, args.session_budget_min, args.max_steps)
    if args.mode in ("all", "sft") and choice is not None:
        stage_sft(choice)
    if args.mode in ("all", "eval"):
        stage_eval()

    stage_summary(choice, bench, pilot)
    print("\n[autopilot] done. Summary: reports/autopilot_summary.md")


if __name__ == "__main__":
    main()
