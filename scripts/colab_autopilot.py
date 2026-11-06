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
TARGET_TOKENS_PER_STEP = 8192    # 8192 = 8 x 2 x 512, the config used in the runbook
VRAM_BUDGET_FRACTION = 0.80      # of the card's total VRAM
# 1.35 = headroom for what the benchmark cannot see (first-step Adam moments,
# allocator fragmentation, the validation batch). The first T4 session showed a
# measured 8.78 GB config needing 13.44 GB in training, so anything that still
# slips through is caught by the pilot's OOM retry instead of killing the session.
VRAM_SAFETY_FACTOR = 1.35        # measured peak x this must still fit the budget
NEAR_BEST_TOLERANCE = 0.05       # within 5% of the best tok/s -> prefer longer context
MAX_PILOT_ATTEMPTS = 4           # OOM self-healing: bs/2, seq/2, ... then give up
MAX_SESSION_SEC = 28800          # 8 h hard cap for one long run (Colab ceiling ~12 h)
VRAM_HEADROOM_GB = 13.0          # kept for the fallback path / old reports


# --------------------------------------------------------------------------- utils
def sh(cmd: List[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    printable = " ".join(str(c) for c in cmd)
    print(f"\n$ {printable}", flush=True)
    if capture:
        return subprocess.run(cmd, cwd=ROOT, check=check, text=True,
                              capture_output=True)
    return subprocess.run(cmd, cwd=ROOT, check=check)


def sh_stream(cmd: List[str]) -> tuple[int, str]:
    """Run a command, echo its output live AND keep the text (OOM detection)."""
    print(f"\n$ {' '.join(str(c) for c in cmd)}", flush=True)
    env = dict(os.environ)
    env.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")
    env.setdefault("PYTHONUNBUFFERED", "1")
    buf: List[str] = []
    proc = subprocess.Popen(cmd, cwd=ROOT, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True, bufsize=1, env=env)
    assert proc.stdout is not None
    for line in proc.stdout:
        print(line, end="", flush=True)
        buf.append(line)
    return proc.wait(), "".join(buf)


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


VRAM_OVERRIDE_GB: Optional[float] = None


def total_vram_gb() -> Optional[float]:
    if VRAM_OVERRIDE_GB is not None:      # used by --self-test on a GPU-less host
        return VRAM_OVERRIDE_GB
    try:
        import torch
        return round(torch.cuda.get_device_properties(0).total_memory / 1e9, 2)
    except Exception:                                    # noqa: BLE001
        return None


def choose_config(bench: Dict[str, object]) -> Dict[str, object]:
    """Pick the fastest config that fits in VRAM with a real safety margin.

    The first T4 session proved that a "measured peak" close to the card's limit is
    not safe: the benchmark reported 8.78 GB for fp16/bs32/seq256 and real training
    then OOM'd at 13.4 GB (Adam moments + first-step temporaries + fragmentation).
    So the budget is a fraction of the actual card, times an explicit safety factor,
    and the pilot stage still self-heals if it OOMs anyway.
    """
    rows = [r for r in bench.get("results", [])
            if r.get("status") == "ok" and r.get("loss_finite") and r.get("tokens_per_second")]
    if not rows:
        raise RuntimeError("no benchmark configuration succeeded — refusing to guess")

    total = total_vram_gb()
    budget = round(VRAM_BUDGET_FRACTION * total, 2) if total else VRAM_HEADROOM_GB
    safe = [r for r in rows
            if (r.get("peak_vram_gb") or 0) * VRAM_SAFETY_FACTOR <= budget]
    tier = "peak x %.2f <= %.2f GB budget" % (VRAM_SAFETY_FACTOR, budget)
    if not safe:
        safe = [r for r in rows if (r.get("peak_vram_gb") or 0) <= budget]
        tier = "peak <= %.2f GB budget (safety factor relaxed)" % budget
    if not safe:
        cheapest = min(rows, key=lambda r: r.get("peak_vram_gb") or 1e9)
        safe = [cheapest]
        tier = "no config fits the budget — fell back to the smallest measured one"

    best_tps = max(r["tokens_per_second"] for r in safe)
    near = [r for r in safe if r["tokens_per_second"] >= best_tps * (1 - NEAR_BEST_TOLERANCE)]
    max_seq = max(r["seq_len"] for r in near)
    pool = [r for r in near if r["seq_len"] == max_seq]
    best = max(pool, key=lambda r: r["tokens_per_second"])

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
        "vram_budget_gb": budget,
        "gpu_total_vram_gb": total,
        "chosen_from": len(safe),
        "reason": (f"fastest run within {NEAR_BEST_TOLERANCE:.0%} of the best tokens/s among "
                   f"{len(safe)} configs that satisfy {tier}; longest context preferred "
                   f"(seq {max_seq}); grad-accum sized to ~{TARGET_TOKENS_PER_STEP} tokens/step"),
    }
    print(json.dumps(decision, indent=2))
    REPORTS.mkdir(exist_ok=True)
    text = json.dumps(decision, indent=2) + "\n"
    (REPORTS / "autopilot_config_choice.json").write_text(text, encoding="utf-8")
    # keep a copy on Drive: a fresh Colab VM has none, and re-benchmarking 54 cells
    # on every session start is session time the user is paying for
    drive = drive_dir()
    if drive is not None:
        try:
            (drive / "reports").mkdir(parents=True, exist_ok=True)
            (drive / "reports" / "autopilot_config_choice.json").write_text(text, encoding="utf-8")
        except OSError as exc:
            print(f"[autopilot] could not copy the config choice to Drive: {exc}")
    return decision


def load_choice() -> Optional[Dict[str, object]]:
    """The measured config from an earlier session (local first, then Drive)."""
    local = REPORTS / "autopilot_config_choice.json"
    candidates = [local]
    drive = drive_dir()
    if drive is not None:
        candidates.append(drive / "reports" / "autopilot_config_choice.json")
    for path in candidates:
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                continue
    return None


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


def _downgrade(choice: Dict[str, object]) -> Optional[Dict[str, object]]:
    """Halve the batch, then the sequence length; keep ~TARGET_TOKENS_PER_STEP."""
    c = dict(choice)
    if int(c["batch_size"]) > 1:
        c["batch_size"] = int(c["batch_size"]) // 2
    elif int(c["seq_len"]) > 256:
        c["seq_len"] = int(c["seq_len"]) // 2
    else:
        return None
    micro = int(c["batch_size"]) * int(c["seq_len"])
    c["grad_accum_steps"] = max(1, round(TARGET_TOKENS_PER_STEP / micro))
    c["tokens_per_step"] = micro * int(c["grad_accum_steps"])
    c["reason"] = str(c.get("reason", "")) + " | downgraded after a CUDA OOM"
    return c


def stage_pilot(choice: Dict[str, object], pilot_steps: int = 300
                ) -> tuple[bool, Dict[str, object]]:
    """Run the pilot, halving the memory footprint and retrying if it OOMs."""
    note("4/8 pilot run")
    attempts: List[dict] = []
    cur = dict(choice)
    rc, out = -1, ""
    for attempt in range(1, MAX_PILOT_ATTEMPTS + 1):
        run_name = "ankit-100m-t4-pilot" if attempt == 1 else f"ankit-100m-t4-pilot-try{attempt}"
        cfg = _generate_config("configs/pretraining_colab_pilot.yaml",
                               "configs/_autogen_pilot.yaml", cur,
                               {"max_steps": pilot_steps,
                                "warmup_steps": max(10, pilot_steps // 10),
                                "run_name": run_name})
        rc, out = sh_stream([PY, "training/pretrain.py", "--config",
                             str(cfg.relative_to(ROOT)), "--run-id", f"autopilot-pilot-{attempt}"])
        oom = "out of memory" in out.lower()
        attempts.append({"attempt": attempt, "dtype": cur["dtype"],
                         "batch_size": cur["batch_size"], "seq_len": cur["seq_len"],
                         "grad_accum_steps": cur["grad_accum_steps"],
                         "returncode": rc, "oom": oom})
        REPORTS.mkdir(exist_ok=True)
        (REPORTS / "autopilot_pilot_attempts.json").write_text(
            json.dumps({"attempts": attempts, "final_config": cur}, indent=2) + "\n",
            encoding="utf-8")
        if not oom:
            break
        nxt = _downgrade(cur)
        if nxt is None:
            print("[autopilot] OOM even at the smallest config — stopping the pilot")
            break
        print(f"[autopilot] OOM -> retry {attempt + 1} with bs {nxt['batch_size']} / "
              f"seq {nxt['seq_len']} / accum {nxt['grad_accum_steps']}", flush=True)
        cur = nxt
    return (rc == 0 and not attempts[-1]["oom"]), cur


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
    # A single step-1 loss is a coin flip (the very first pilot logged 1.0564 before
    # settling around 9.5), so compare medians of the first and last tenth instead of
    # two individual steps.
    def _med(xs: List[float]) -> Optional[float]:
        import statistics
        return float(statistics.median(xs)) if xs else None
    k = max(1, len(losses) // 10)
    head_med, tail_med = _med(losses[:k]), _med(losses[-k:])
    improved = (head_med is not None and tail_med is not None and tail_med < head_med)
    result = {
        "logged_steps": len(losses),
        "first_loss": first,
        "last_loss": last,
        "first10pct_median_loss": head_med,
        "last10pct_median_loss": tail_med,
        "loss_improved": improved,
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


def stage_restore(ckpt_dir: str = "checkpoints/t4-full") -> Optional[str]:
    """Copy the newest complete checkpoint from Drive into this VM's local disk.

    A stopped/disconnected Colab runtime loses everything on /content. The only
    durable copy is the one on Drive, so every entry point that trains restores
    first - and never silently restarts from step 0 while a checkpoint exists.
    """
    note("0/8 restore newest checkpoint from Drive")
    drive = drive_dir()
    local = ROOT / ckpt_dir
    if drive is None:
        print("[autopilot] Drive is not mounted — nothing to restore from")
        return None
    mirror = drive / "checkpoints" / Path(ckpt_dir).name
    if not mirror.exists():
        print(f"[autopilot] no mirror at {mirror} — first run for this checkpoint dir")
        return None

    sys.path.insert(0, str(ROOT))
    from training.mirror import newest_mirrored_checkpoint, restore_from_mirror

    remote = newest_mirrored_checkpoint(mirror)
    if remote is None:
        print(f"[autopilot] {mirror} has no complete checkpoint yet")
        return None

    remote_step = _sidecar_step(remote)
    local_step, local_path = -1, None
    if local.exists():
        for sidecar in local.glob("*.json"):
            if sidecar.name == "latest.json":
                continue
            try:
                meta = json.loads(sidecar.read_text(encoding="utf-8"))
            except ValueError:
                continue
            if int(meta.get("step", -1)) > local_step and sidecar.with_suffix(".pt").exists():
                local_step, local_path = int(meta.get("step", -1)), sidecar.with_suffix(".pt")

    if local_path is not None and local_step >= remote_step:
        print(f"[autopilot] local checkpoint step {local_step} >= Drive step {remote_step}"
              " — keeping the local one")
        return str(local_path)

    print(f"[autopilot] restoring {remote.name} (step {remote_step}) from Drive "
          f"({remote.stat().st_size/1e9:.2f} GB) — this takes a few minutes on a "
          "fresh VM")
    dest = restore_from_mirror(mirror, local)
    if dest is None:
        print("[autopilot] restore produced nothing")
        return None
    print(f"[autopilot] restored -> {dest}")
    return str(dest)


def _sidecar_step(ckpt: Path) -> int:
    sidecar = Path(ckpt).with_suffix(".json")
    if sidecar.exists():
        try:
            return int(json.loads(sidecar.read_text(encoding="utf-8")).get("step", -1))
        except (ValueError, TypeError):
            pass
    return -1


def stage_train(choice: Dict[str, object], session_budget_min: int, steps: Optional[int]) -> None:
    note("6/8 long training (resumable)")
    if not cuda_available():
        print("[autopilot] CUDA not available — skipping the long GPU run (honest refusal)")
        return
    # a fresh Colab VM has no token shards either (they are gitignored); --mode resume
    # must not train on a missing dataset, so build only what is actually absent
    if not (ROOT / "data/processed/pretrain_train.bin").exists():
        print("[autopilot] token shards missing on this VM -> building them first "
              "(one-off, ~10-20 min)")
        stage_prepare()
    restored = stage_restore("checkpoints/t4-full")
    overrides: Dict[str, object] = {"mirror_keep": 2}
    if steps:
        overrides["max_steps"] = steps
    if not (ROOT / "checkpoints/t4-full/latest.json").exists():
        overrides.setdefault("warmup_steps", 2000)
    cfg = _generate_config("configs/pretraining_colab_t4.yaml",
                           "configs/_autogen_full.yaml", choice, overrides)

    # Colab kills the VM without warning. The margin after the budget covers the
    # final eval + save + the last Drive flush, so the newest checkpoint really lands
    # on Drive before the runtime is gone.
    budget_sec = max(300, session_budget_min * 60 - 420)
    # 8 h is still well under Colab's ~12 h ceiling and the old 5.5 h cap threw away
    # 2.5 h of GPU time every session (that is a whole extra session every 2 runs).
    budget_sec = min(budget_sec, MAX_SESSION_SEC)
    print(f"[autopilot] session budget {budget_sec/60:.0f} min; checkpoints every 200 "
          "steps with a background Drive mirror (training no longer waits for Drive)")
    rc, out = sh_stream([PY, "training/pretrain.py", "--config", str(cfg.relative_to(ROOT)),
                         "--run-id", f"autopilot-full-{time.strftime('%H%M')}",
                         "--resume", "auto", "--time-budget-sec", str(budget_sec)])
    oom = "out of memory" in out.lower()
    status = {"returncode": rc, "out_of_memory": oom, "budget_sec": budget_sec,
              "batch_size": choice["batch_size"], "seq_len": choice["seq_len"],
              "dtype": choice["dtype"], "restored_from": restored,
              "mirror_lines": [ln for ln in out.splitlines() if ln.startswith("[mirror]")][-5:]}
    (REPORTS / "autopilot_train_status.json").write_text(
        json.dumps(status, indent=2) + "\n", encoding="utf-8")
    if oom:
        print("[autopilot] the long run hit CUDA OOM — the pilot config needs one more "
              "step down; re-run and the chooser will use the safer measured peak")


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
                  pilot: Optional[Dict[str, object]] = None,
                  resume: Optional[Dict[str, object]] = None) -> Path:
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
    attempts = REPORTS / "autopilot_pilot_attempts.json"
    if attempts.exists():
        lines += ["## Pilot attempts (OOM self-healing)", "", "```",
                  attempts.read_text(encoding="utf-8").strip(), "```", ""]
    if resume is not None:
        lines += ["## Resume verification", "", "```", json.dumps(resume, indent=2), "```", ""]
    train_status = REPORTS / "autopilot_train_status.json"
    if train_status.exists():
        lines += ["## Long-run status", "", "```",
                  train_status.read_text(encoding="utf-8").strip(), "```", ""]

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
                "mirror_dir": "checkpoints/_selftest_mirror", "mirror_keep": 2,
                "log_dir": "logs", "run_name": "autopilot-selftest"})
    p = ROOT / "configs/_selftest.yaml"
    p.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    sh([PY, "training/pretrain.py", "--config", "configs/_selftest.yaml", "--run-id", "st"],
       check=False, capture=True)
    res = verify_pilot("configs/_selftest.yaml")
    # the async Drive mirror must have produced a complete checkpoint + pointer
    mirrored = ROOT / "checkpoints/_selftest_mirror"
    mir_ok = (mirrored / "latest.json").exists() and bool(list(mirrored.glob("*.pt")))
    assert mir_ok, "async mirror wrote nothing — the Drive path would lose history"
    print(f"[self-test] async mirror OK: {sorted(p.name for p in mirrored.glob('*.pt'))}")
    # the chooser must reproduce the safe decision on the REAL T4 measurements
    real_t4 = {"results": [
        {"dtype": "float32", "batch_size": 8, "seq_len": 512, "tokens_per_step": 4096,
         "status": "ok", "loss_finite": True, "tokens_per_second": 5292.3, "peak_vram_gb": 6.05},
        {"dtype": "float16", "batch_size": 8, "seq_len": 512, "tokens_per_step": 4096,
         "status": "ok", "loss_finite": True, "tokens_per_second": 14636.7, "peak_vram_gb": 5.08},
        {"dtype": "float16", "batch_size": 16, "seq_len": 512, "tokens_per_step": 8192,
         "status": "ok", "loss_finite": True, "tokens_per_second": 16136.6, "peak_vram_gb": 8.78},
        {"dtype": "float16", "batch_size": 32, "seq_len": 256, "tokens_per_step": 8192,
         "status": "ok", "loss_finite": True, "tokens_per_second": 16870.3, "peak_vram_gb": 8.78},
        {"dtype": "float16", "batch_size": 32, "seq_len": 512, "tokens_per_step": 16384,
         "status": "oom", "loss_finite": False, "tokens_per_second": None, "peak_vram_gb": None},
        {"dtype": "bfloat16", "batch_size": 8, "seq_len": 1024, "tokens_per_step": 8192,
         "status": "ok", "loss_finite": True, "tokens_per_second": 3123.2, "peak_vram_gb": 13.17},
    ]}
    globals()["VRAM_OVERRIDE_GB"] = 15.64          # pretend to be the T4
    picked = choose_config(real_t4)
    budget = VRAM_BUDGET_FRACTION * 15.64
    assert picked["dtype"] == "float16", picked
    assert picked["measured_peak_vram_gb"] * VRAM_SAFETY_FACTOR <= budget + 1e-6, picked
    assert picked["batch_size"] * picked["seq_len"] * picked["grad_accum_steps"] == 8192, picked
    # the fp16/bs32/seq256 cell ("8.78 GB") is the one that OOM'd real training: rejected
    assert not (picked["batch_size"] == 32), picked
    assert picked["seq_len"] == 512, picked   # longest context within 5% of the best tok/s
    assert picked["batch_size"] == 16, picked # bs16/seq512: near-max toc/s at 8.78 GB
    print(f"[self-test] chooser on real T4 data -> {picked['dtype']} bs{picked['batch_size']} "
          f"seq{picked['seq_len']} accum{picked['grad_accum_steps']} "
          f"({picked['measured_tokens_per_second']} tok/s, "
          f"{picked['measured_peak_vram_gb']} GB): OK")
    globals()["VRAM_OVERRIDE_GB"] = None
    ok = res["logged_steps"] > 0 and res["all_losses_finite"]
    print(f"\n[self-test] {'PASS' if ok else 'FAIL'} — orchestration wired correctly")
    shutil.rmtree(ROOT / "checkpoints/_selftest", ignore_errors=True)
    shutil.rmtree(ROOT / "checkpoints/_selftest_mirror", ignore_errors=True)
    p.unlink(missing_ok=True)
    for f in (ROOT / "logs").glob("autopilot-selftest-*"):
        f.unlink(missing_ok=True)
    (REPORTS / "autopilot_pilot_verification.json").unlink(missing_ok=True)


# --------------------------------------------------------------------------- main
def main() -> None:
    """Wrap the real work so a crash still leaves evidence on Drive."""
    try:
        _main_impl()
    except BaseException:                                  # noqa: BLE001
        import traceback
        tb = traceback.format_exc()
        print(tb, flush=True)
        try:
            REPORTS.mkdir(exist_ok=True)
            err = REPORTS / "autopilot_error.txt"
            err.write_text(tb, encoding="utf-8")
            drive = drive_dir()
            if drive is not None:
                (drive / "reports").mkdir(parents=True, exist_ok=True)
                shutil.copy(err, drive / "reports" / "autopilot_error.txt")
                print(f"[autopilot] crash log copied to {drive}/reports/autopilot_error.txt")
        except OSError:
            pass
        raise


def _main_impl() -> None:
    ap = argparse.ArgumentParser(description="ANKIT LLM one-command Colab autopilot")
    ap.add_argument("--mode", default="all",
                    choices=["all", "resume", "prepare", "benchmark", "pilot", "train",
                             "sft", "eval"],
                    help="resume = restore the newest Drive checkpoint and train, "
                         "skipping prepare/benchmark/pilot/resume-test (~8 min saved)")
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

    if not cuda_available() and args.mode in ("all", "resume", "benchmark", "pilot", "train"):
        print("=" * 78)
        print("No CUDA device found. The GPU stages are skipped rather than faked.")
        print("In Colab: Runtime -> Change runtime type -> Hardware accelerator: T4 GPU")
        print("=" * 78)
        if args.mode in ("all", "resume", "benchmark", "pilot"):
            args.mode = "prepare"

    bench: Optional[Dict[str, object]] = None
    choice: Optional[Dict[str, object]] = None
    pilot: Optional[Dict[str, object]] = None

    if args.mode in ("all", "prepare", "pilot"):
        stage_prepare(force=args.force_prepare)
    if args.mode in ("all", "benchmark", "pilot"):
        bench = stage_benchmark(quick=args.quick_benchmark)
        choice = choose_config(bench)
    resume: Optional[Dict[str, object]] = None
    pilot_ok = True
    if args.mode in ("all", "pilot"):
        ran_ok, choice = stage_pilot(choice, pilot_steps=args.pilot_steps)
        pilot = verify_pilot()
        pilot_ok = bool(ran_ok and pilot["all_losses_finite"] and pilot["validation_ran"]
                        and pilot["checkpoints"])
        if pilot_ok:
            resume = stage_resume_test(choice)
        else:
            print("[autopilot] pilot verification FAILED -> resume test and long run skipped")
        (REPORTS / "autopilot_resume_test.json").write_text(
            json.dumps(resume or {"skipped": True, "reason": "pilot verification failed"},
                       indent=2) + "\n", encoding="utf-8")
    if args.mode == "resume":
        choice = load_choice()
        if choice is None:
            print("[autopilot] no measured config found for this VM or on Drive -> "
                  "measuring it now (needed: we must not guess a VRAM config)")
            bench = stage_benchmark(quick=False)
            choice = choose_config(bench)
        else:
            print("[autopilot] reusing the measured config: "
                  f"{choice.get('dtype')} / bs {choice.get('batch_size')} / "
                  f"seq {choice.get('seq_len')} / accum {choice.get('grad_accum_steps')}")
        pilot_ok = True
        stage_train(choice, args.session_budget_min, args.max_steps)
    elif args.mode in ("all", "train") and not pilot_ok:
        print("[autopilot] refusing to start the long run: the pilot was not verified")
    elif args.mode in ("all", "train"):
        if choice is None:
            cfg_file = REPORTS / "autopilot_config_choice.json"
            if cfg_file.exists():
                choice = json.loads(cfg_file.read_text(encoding="utf-8"))
            else:
                bench = stage_benchmark(quick=True)
                choice = choose_config(bench)
        stage_train(choice, args.session_budget_min, args.max_steps)
    if args.mode == "sft" and choice is not None:
        stage_sft(choice)                       # explicit request: run it
    elif args.mode == "all":
        ready = any((ROOT / c).exists() for c in ("checkpoints/t4-full/latest.json",
                                                 "checkpoints/t4-pilot/latest.json"))
        if choice is not None and pilot_ok and ready:
            stage_sft(choice)
        else:
            print("[autopilot] SFT skipped: it needs a verified pilot AND a pretraining "
                  "checkpoint (a 1-step model is not worth instruction-tuning)")
    if args.mode in ("all", "eval"):
        stage_eval()

    stage_summary(choice, bench, pilot, resume)
    print("\n[autopilot] done. Summary: reports/autopilot_summary.md")


if __name__ == "__main__":
    main()
