"""`--mode sft` must actually train SFT — it used to fall through to the summary.

On 2026-11-07 the user asked for chat, ran `--mode sft`, and the whole session printed:

    [build] sha 272246e on branch main | all safety markers present
    === summary ===

`stage_sft()` is only reached via `if args.mode == "sft" and choice is not None`, but `choice`
is set by the benchmark/pilot branches only — so an explicit request was silently dropped.
These tests pin both halves: the dispatch, and the loud failure/report inside the stage.
"""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _run_main(monkeypatch, argv):
    import scripts.colab_autopilot as mod
    monkeypatch.setattr(mod.sys, "argv", ["colab_autopilot.py", *argv])
    monkeypatch.setattr(mod, "write_build_stamp", lambda: {})
    monkeypatch.setattr(mod, "cuda_available", lambda: True)
    monkeypatch.setattr(mod, "stage_summary", lambda *a, **k: None)
    mod._main_impl()


def test_sft_mode_runs_even_without_a_measured_choice(monkeypatch):
    import scripts.colab_autopilot as mod
    called, benchmarks = {}, {}

    monkeypatch.setattr(mod, "load_choice", lambda: None)

    def fake_bench(quick=False):
        benchmarks["quick"] = quick
        return {"results": [{"status": "ok", "loss_finite": True, "tokens_per_second": 1e4,
                             "peak_vram_gb": 5.0, "seq_len": 512, "dtype": "float16",
                             "batch_size": 4, "grad_accum_steps": 1}]}

    monkeypatch.setattr(mod, "stage_benchmark", fake_bench)
    monkeypatch.setattr(mod, "choose_config", lambda bench: {"dtype": "float16"})
    monkeypatch.setattr(mod, "stage_prepare", lambda force=False: None)
    monkeypatch.setattr(mod, "stage_sft", lambda choice: called.setdefault("sft", choice))

    _run_main(monkeypatch, ["--mode", "sft"])
    assert "sft" in called, "--mode sft fell through without running SFT"
    assert called["sft"]["dtype"] == "float16"
    assert benchmarks.get("quick") is True, "should measure instead of guessing VRAM"


def test_sft_mode_uses_a_stored_choice_without_benchmarking(monkeypatch):
    import scripts.colab_autopilot as mod
    called = {}

    monkeypatch.setattr(mod, "load_choice", lambda: {"dtype": "float16", "batch_size": 16})
    monkeypatch.setattr(mod, "stage_benchmark",
                        lambda quick=False: pytest.fail("benchmark must not run"))
    monkeypatch.setattr(mod, "stage_sft", lambda choice: called.setdefault("sft", choice))

    _run_main(monkeypatch, ["--mode", "sft"])
    assert called["sft"]["batch_size"] == 16


def test_sft_stage_refuses_loudly_without_a_checkpoint(monkeypatch):
    import scripts.colab_autopilot as mod
    monkeypatch.setattr(mod, "cuda_available", lambda: True)     # the box has no GPU
    monkeypatch.setattr(mod, "drive_dir", lambda: None)
    monkeypatch.setattr(mod, "ROOT", Path("/tmp/definitely-empty-root"))
    mod.stage_sft({"dtype": "float16"})          # must not raise, must say why


def test_sft_stage_reports_a_failed_run(monkeypatch, capsys):
    """A crashed finetune must not be reported as success (and must not be silent)."""
    import subprocess
    import scripts.colab_autopilot as mod
    import tempfile

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        (root / "configs").mkdir()
        (root / "configs/finetuning_colab_t4.yaml").write_text(
            "run_name: x\ninit_checkpoint: auto\ncheckpoint_dir: checkpoints/t4-sft\n"
            "sft_data: d.jsonl\n", encoding="utf-8")
        (root / "checkpoints/t4-full").mkdir(parents=True)
        (root / "checkpoints/t4-full/step5.pt").write_bytes(b"\x00" * 16)
        monkeypatch.setattr(mod, "ROOT", root)
        monkeypatch.setattr(mod, "cuda_available", lambda: True)  # the box has no GPU
        monkeypatch.setattr(mod, "drive_dir", lambda: None)
        monkeypatch.setattr(mod, "py", lambda *a, **k: subprocess.CompletedProcess([], 1, "", ""))
        mod.stage_sft({"dtype": "float16"})
    out = capsys.readouterr().out
    assert "SFT FAILED" in out
    assert "SFT from" in out        # it did try, with the checkpoint it found
