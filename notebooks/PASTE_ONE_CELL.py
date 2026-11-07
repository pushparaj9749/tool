"""ONE cell that is *always* current: sync to origin/main, mount Drive, run a 60-min chunk.

In Colab, replace Cell 3 with these three lines:

    !git clone -q --depth 1 https://github.com/pushparaj9749/tool.git /content/ankit-llm 2>/dev/null || \\
      (git -C /content/ankit-llm fetch -q --depth 1 origin main && git -C /content/ankit-llm reset -q --hard origin/main)
    %cd /content/ankit-llm
    !python notebooks/PASTE_ONE_CELL.py

Why a launcher instead of 200 lines pasted into the notebook: the 2026-11-06 session ran a
copy of the notebook from before PR #6 and trained 5,800 steps on stale code (step-tagged
mirror, no `latest.pt`, no heartbeat). Nothing on Drive could even say which build it was.
The cell above is three lines and will keep working forever, because the logic it runs lives
in git and gets refreshed on every run.

What it does, in order:
  1. GPU check (fails loudly on CPU instead of pretending)
  2. hard-sync the checkout to `origin/main` and verify HEAD == the sha GitHub reports
  3. mount Drive, print the DRIVE ACCOUNT, write `ankit-llm/WHOAMI.txt`, list the checkpoints
  4. pick the mode from Drive itself (`resume` if a .pt is there, else full pipeline)
  5. run one chunk (`--session-budget-min`, default 60) and print the measured tail
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

REPO = "https://github.com/pushparaj9749/tool.git"
REPO_DIR = Path("/content/ankit-llm")
DRIVE = Path(os.environ.get("ANKIT_DRIVE_DIR") or "/content/drive/MyDrive/ankit-llm")
# a list, not a dict: two markers live in colab_autopilot.py and a dict would
# silently drop one of them (it did, and the gate reported 4 instead of 5)
MARKERS = [
    ("training/mirror.py", "LATEST_CKPT_NAME"),           # rolling latest.pt, no trash leak
    ("training/pretrain.py", "_watch_mirror"),            # mirror watchdog
    ("training/checkpoint.py", "_to_cpu_copy"),           # portable checkpoints
    ("scripts/colab_autopilot.py", "_preflight_mirror"),  # Drive writability probe
    ("scripts/colab_autopilot.py", "build_stamp"),        # build identity on Drive
]


def run(cmd: list[str], cwd: Path | None = None, **kw) -> subprocess.CompletedProcess:
    print("$", " ".join(cmd), flush=True)
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None, text=True, **kw)


def git(*args: str, cwd: Path) -> str:
    r = run(["git", *args], cwd=cwd, capture_output=True)
    return (r.stdout or "").strip() if r.returncode == 0 else ""


# --------------------------------------------------------------------- 1. GPU
def check_gpu(strict: bool = True) -> None:
    try:
        import torch
    except ImportError:
        assert not strict, "torch nahi hai — Colab me `pip install torch` chahiye"
        print("[gpu] torch missing (dry-run)", flush=True)
        return
    print(f"torch {torch.__version__} | cuda {torch.cuda.is_available()}", flush=True)
    if not torch.cuda.is_available():
        assert not strict, (
            "GPU nahi mila — Runtime -> Change runtime type -> Hardware accelerator: T4 GPU")
        print("[gpu] no CUDA (dry-run) — real run yahin rukta hai", flush=True)
        return
    p = torch.cuda.get_device_properties(0)
    cap = torch.cuda.get_device_capability(0)
    print(f"GPU: {p.name} | cc {cap[0]}.{cap[1]} | VRAM {p.total_memory/1e9:.1f} GB | "
          f"bf16 accelerated: {cap[0] >= 8}", flush=True)


# --------------------------------------------------------------------- 2. code
def sync_repo(repo_dir: Path) -> str:
    """Guarantee this process runs the newest `main`, or stop — never a stale clone.

    `git fetch` used to be best-effort (`check=False`), so a VM that kept an old clone
    silently kept running old code and its marker gate passed on the old markers.
    """
    if not repo_dir.exists():
        run(["git", "clone", "-q", "--depth", "1", REPO, str(repo_dir)], check=True)
    want = ""
    for attempt in (1, 2, 3):
        run(["git", "fetch", "-q", "--depth", "1", "origin", "main"], cwd=repo_dir,
            capture_output=True, check=False)
        # ls-remote prints "<sha>\trefs/heads/main" - split on any whitespace
        line = git("ls-remote", "origin", "refs/heads/main", cwd=repo_dir)
        want = line.split()[0] if line.split() else ""
        if want:
            break
        time.sleep(3 * attempt)
    assert want, ("GitHub se origin/main nahi aa rahi (network?). Purana build chalane se "
                  "behtar hai fail hona — dobara try karo.")
    run(["git", "reset", "-q", "--hard", want], cwd=repo_dir, check=True)
    have = git("rev-parse", "HEAD", cwd=repo_dir)
    assert have == want, f"stale checkout: HEAD {have[:7]} != GitHub main {want[:7]}"
    missing = []
    for rel, marker in MARKERS:
        text = (repo_dir / rel).read_text(encoding="utf-8", errors="replace") \
            if (repo_dir / rel).exists() else ""
        if marker not in text:
            missing.append(f"{rel}:{marker}")
    assert not missing, f"origin/main is missing durability code: {missing}"
    print(f"[sync] HEAD {have[:7]} == GitHub main | all {len(MARKERS)} safety markers present",
          flush=True)
    return have


# --------------------------------------------------------------------- 3. Drive
def mount_drive() -> Path | None:
    try:
        from google.colab import drive  # noqa: PLC0415
    except ImportError:
        print("[drive] not running in Colab — no Drive mount", flush=True)
        return None
    drive.mount("/content/drive")
    (DRIVE / "checkpoints").mkdir(parents=True, exist_ok=True)
    (DRIVE / "reports").mkdir(parents=True, exist_ok=True)

    who: dict = {}
    try:
        from googleapiclient.discovery import build  # noqa: PLC0415
        who = build("drive", "v3").about().get(fields="user").execute().get("user", {})
    except Exception as exc:                                    # noqa: BLE001
        who = {"error": f"{type(exc).__name__}: {exc}"}
    print("=" * 72, flush=True)
    print("DRIVE ACCOUNT:", who.get("emailAddress"), "|", who.get("displayName"), flush=True)
    ck = DRIVE / "checkpoints" / "t4-full"
    print("checkpoints/t4-full:", sorted(p.name for p in ck.iterdir())[:10]
          if ck.is_dir() else "MISSING", flush=True)
    print("=" * 72, flush=True)
    try:
        (DRIVE / "WHOAMI.txt").write_text(json.dumps(who, indent=2) + "\n", encoding="utf-8")
    except OSError:
        pass
    return DRIVE


def drive_has_checkpoint(drive: Path | None) -> bool:
    if drive is None:
        return False
    ck = drive / "checkpoints" / "t4-full"
    return ck.is_dir() and any(p.name.endswith(".pt") for p in ck.iterdir())


# --------------------------------------------------------------------- 5. tail
def print_tail(repo_dir: Path) -> None:
    print("\n" + "=" * 72, flush=True)
    for name in ("build_stamp.json", "autopilot_chunk_progress.json",
                 "autopilot_training_plan.json", "autopilot_train_status.json"):
        p = repo_dir / "reports" / name
        if p.exists():
            try:
                print(f"--- {name} ---\n{json.dumps(json.loads(p.read_text()), indent=2)}",
                      flush=True)
            except ValueError:
                print(f"--- {name} --- (unreadable)", flush=True)
    print("=" * 72, flush=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="one-cell Colab launcher")
    ap.add_argument("--budget-min", type=int, default=60,
                    help="wall-clock limit for this chunk (default 60)")
    ap.add_argument("--mode", default="auto", choices=["auto", "all", "resume", "prepare",
                                                       "benchmark", "pilot", "train"])
    ap.add_argument("--repo-dir", default=None)
    ap.add_argument("--dry-run", action="store_true",
                    help="do every check but do not train (used by tests/CI)")
    args = ap.parse_args()

    repo_dir = Path(args.repo_dir) if args.repo_dir else (
        REPO_DIR if REPO_DIR.exists() else Path(__file__).resolve().parents[1])
    check_gpu(strict=not args.dry_run)
    sync_repo(repo_dir)
    drive = None if args.dry_run else mount_drive()

    mode = args.mode
    if mode == "auto":
        mode = "resume" if drive_has_checkpoint(drive) else "all"
    print(f"\n>>> MODE = {mode} | chunk budget {args.budget_min} min | repo {repo_dir}\n",
          flush=True)
    if args.dry_run:
        print("[dry-run] checks passed, not training", flush=True)
        return

    run([sys.executable, "scripts/colab_autopilot.py", "--mode", mode,
         "--session-budget-min", str(args.budget_min)], cwd=repo_dir, check=False)
    print_tail(repo_dir)
    print("\nChunk khatam. Yahi cell dobara chalao — newest checkpoint Drive se aayega "
          "aur training usi step se aage badhegi.", flush=True)


if __name__ == "__main__":
    main()
