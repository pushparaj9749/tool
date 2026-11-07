"""The exact Drive layout left by the 2026-11-06 session must resume at step 5800.

That session ran an *older* build (pre-PR#6), so its mirror is not the rolling
`latest.pt` this code writes today. What is actually on
`ankitmahato5533@gmail.com/MyDrive/ankit-llm/checkpoints/t4-full` is:

    latest.json   129 B   {"tag": "step5800", "file": "step5800.pt",
                           "step": 5800, "bytes": 1270001459,
                           "mirrored_at": "2026-11-06T19:58:19Z"}
    step5600.pt / step5600.json
    step5800.pt / step5800.json

i.e. a legacy pointer (no sha256, no `created_at`) plus step-tagged copies. If the new
code cannot resume from *that*, the 5,800 steps are unusable in practice. These tests
pin both halves: picking the file, and really continuing from step 5800.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

TRAIN_BIN = ROOT / "data/_selftest/processed/pretrain_train.bin"


def _legacy_pointer(step: int, size: int) -> dict:
    """The 129-byte pointer the old `checkpoint.mirror_checkpoint()` wrote."""
    return {"tag": f"step{step}", "file": f"step{step}.pt", "step": step,
            "bytes": size, "mirrored_at": "2026-11-06T19:58:19Z"}


@pytest.fixture(scope="module")
def tiny_artifacts():
    if not TRAIN_BIN.exists():
        from scripts.colab_autopilot import _synthetic_artifacts
        _synthetic_artifacts()
    if not TRAIN_BIN.exists():
        pytest.skip("could not build synthetic shards")
    return ROOT / "configs/_selftest_model.yaml", ROOT / "data/_selftest/tok"


def _run(ckpt_dir: Path, mirror_dir: Path, run_id: str, max_steps: int) -> tuple[int, str]:
    cfg = yaml.safe_load((ROOT / "configs/pretraining_nano.yaml").read_text(encoding="utf-8"))
    cfg.update({
        "model_config": "configs/_selftest_model.yaml",
        "tokenizer_dir": "data/_selftest/tok",
        "data_dir": "data/_selftest/processed",
        "train_bin": "data/_selftest/processed/pretrain_train.bin",
        "val_bin": "data/_selftest/processed/pretrain_val.bin",
        "dtype": "fp32", "device": "cpu", "seq_len": 64, "batch_size": 2,
        "grad_accum_steps": 1, "max_steps": max_steps, "warmup_steps": 1,
        "eval_every": 0, "save_every": 5, "log_every": 1, "keep_last_checkpoints": 2,
        "checkpoint_dir": str(ckpt_dir), "log_dir": "logs", "run_name": "legacy-layout",
        "mirror_dir": str(mirror_dir), "mirror_keep": 2, "storage_min_free_gb": 0.1,
    })
    path = ROOT / "configs/_legacy_layout.yaml"
    path.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    r = subprocess.run([sys.executable, "training/pretrain.py", "--config",
                        "configs/_legacy_layout.yaml", "--run-id", run_id],
                       cwd=ROOT, text=True, capture_output=True)
    return r.returncode, r.stdout + r.stderr


def _build_legacy_mirror(seed_ckpt: Path, mirror: Path) -> None:
    """Turn one real checkpoint into the 2026-11-06 Drive layout, step number 5800."""
    import torch
    mirror.mkdir(parents=True, exist_ok=True)
    payload = torch.load(seed_ckpt, map_location="cpu", weights_only=False)
    payload["step"] = 5800
    payload["tokens_seen"] = 5800 * 8192
    for step in (5600, 5800):
        dest = mirror / f"step{step}.pt"
        torch.save(payload, dest)
        size = dest.stat().st_size
        (mirror / f"step{step}.json").write_text(json.dumps(
            {"tag": f"step{step}", "path": str(dest), "bytes": size,
             "sha256": "0" * 64, "step": step, "tokens_seen": step * 8192,
             "created_at": "2026-11-06T19:56:23Z"}, indent=2) + "\n", encoding="utf-8")
    # newest by step is 5800, and that is what the legacy pointer names
    (mirror / "latest.json").write_text(
        json.dumps(_legacy_pointer(5800, (mirror / "step5800.pt").stat().st_size),
                   indent=2) + "\n", encoding="utf-8")
    # a checkpoint whose copy was cut off by a runtime stop must never be resumed
    (mirror / "step6000.pt").write_bytes(b"\x00" * 64)
    (mirror / "step6000.json").write_text(
        json.dumps({"tag": "step6000", "step": 6000, "bytes": 10 ** 9}, indent=2) + "\n",
        encoding="utf-8")


def test_legacy_pointer_layout_picks_step5800(tmp_path):
    """Pointer first, sidecars second, truncated copies never."""
    from training.mirror import newest_mirrored_checkpoint
    mirror = tmp_path / "t4-full"
    mirror.mkdir()
    for step in (5600, 5800):
        (mirror / f"step{step}.pt").write_bytes(b"\x01" * 128)
        (mirror / f"step{step}.json").write_text(
            json.dumps({"tag": f"step{step}", "step": step, "bytes": 128}), encoding="utf-8")
    (mirror / "step6000.pt").write_bytes(b"\x01" * 128)      # sidecar says 999 -> stale
    (mirror / "step6000.json").write_text(
        json.dumps({"tag": "step6000", "step": 6000, "bytes": 999}), encoding="utf-8")
    (mirror / "latest.json").write_text(json.dumps(_legacy_pointer(5800, 128)),
                                        encoding="utf-8")
    assert newest_mirrored_checkpoint(mirror).name == "step5800.pt"

    # pointer gone (a half-written Drive): the highest *complete* sidecar still wins
    (mirror / "latest.json").unlink()
    assert newest_mirrored_checkpoint(mirror).name == "step5800.pt"


def test_fresh_vm_resumes_from_the_legacy_layout_at_step_5800(tmp_path, tiny_artifacts):
    """End to end: real checkpoint, real pretrain, legacy Drive layout, step 5800."""
    ckpt_dir = ROOT / "checkpoints/_legacy_layout"
    mirror = tmp_path / "drive/checkpoints/t4-full"
    shutil.rmtree(ckpt_dir, ignore_errors=True)

    rc1, out1 = _run(ckpt_dir, mirror, "sess1", max_steps=5)
    assert rc1 == 0, out1[-2000:]
    seed = ckpt_dir / "step5.pt"
    assert seed.exists(), out1[-2000:]

    shutil.rmtree(mirror)
    _build_legacy_mirror(seed, mirror)
    shutil.rmtree(ckpt_dir)                      # a stopped Colab runtime loses its disk

    rc2, out2 = _run(ckpt_dir, mirror, "sess2", max_steps=5810)
    assert rc2 == 0, out2[-3000:]
    assert "restored step5800.pt" in out2, out2[-2000:]
    assert "at step 5800" in out2, out2[-2000:]
    assert not (ckpt_dir / "step6000.pt").exists(), "resumed the truncated copy"

    sidecar = json.loads((ckpt_dir / "latest.json").read_text(encoding="utf-8"))
    assert int(sidecar["step"]) >= 5800
    shutil.rmtree(ckpt_dir, ignore_errors=True)
    (ROOT / "configs/_legacy_layout.yaml").unlink(missing_ok=True)
    for f in (ROOT / "logs").glob("legacy-layout-*"):
        f.unlink(missing_ok=True)


def test_launcher_parses_ls_remote_output():
    """`git ls-remote` separates sha and ref with a TAB, not a space."""
    line = "0eca28a5bf01575187569618ca8925bbddb353db\trefs/heads/main"
    assert (line.split()[0] if line.split() else "") == "0eca28a5bf01575187569618ca8925bbddb353db"
    src = (ROOT / "notebooks/PASTE_ONE_CELL.py").read_text(encoding="utf-8")
    assert "line.split()[0]" in src, "launcher must parse ls-remote on whitespace"


def test_notebook_cell_is_the_thin_launcher():
    """Cell 3 must stay 3 lines of shell - a fat cell is what went stale."""
    import json
    nb = json.loads((ROOT / "notebooks/ANKIT_LLM_Colab_ONE_CLICK.ipynb").read_text(encoding="utf-8"))
    code = "".join(nb["cells"][3]["source"])
    assert "PASTE_ONE_CELL.py" in code
    assert "reset -q --hard origin/main" in code
    assert len([l for l in code.splitlines() if l.strip()]) <= 5, "cell grew back into logic"


def test_launcher_checks_every_marker():
    """Two markers live in colab_autopilot.py; a dict keyed by path would drop one."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "paste_one_cell", ROOT / "notebooks/PASTE_ONE_CELL.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert isinstance(mod.MARKERS, list), "MARKERS must be a list of (path, marker)"
    assert len(mod.MARKERS) == 5
    assert len({m for _, m in mod.MARKERS}) == 5
    for rel, marker in mod.MARKERS:
        assert marker in (ROOT / rel).read_text(encoding="utf-8", errors="replace"), \
            f"{rel} lost its {marker} marker"
