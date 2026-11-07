"""The launcher must work whether or not Drive is already mounted.

Real failure (2026-11-07): `!python notebooks/PASTE_ONE_CELL.py` on a fresh VM died with

    File ".../google/colab/drive.py", line 134, in _mount
        _message.blocking_request('request_auth', ...)
    AttributeError: 'NoneType' object has no attribute 'kernel'

because `drive.mount()` talks to the Colab front-end through the IPython kernel and a
`!python` subprocess has no kernel. Losing the whole chunk to that traceback is not
acceptable: if Drive is already mounted we use it, and if we cannot mount we say what to run.
"""
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def _launcher():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "paste_one_cell_drive", ROOT / "notebooks/PASTE_ONE_CELL.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_uses_an_already_mounted_drive(monkeypatch, tmp_path):
    mod = _launcher()
    mounted = tmp_path / "MyDrive/ankit-llm"
    mounted.mkdir(parents=True)
    monkeypatch.setattr(mod, "DRIVE", mounted)

    # if it tried to mount again, this would explode
    fake = types.ModuleType("google.colab")
    fake.drive = types.SimpleNamespace(
        mount=lambda *a, **k: (_ for _ in ()).throw(AssertionError("mounted twice")))
    monkeypatch.setitem(sys.modules, "google.colab", fake)

    assert mod.mount_drive() == mounted
    assert (mounted / "checkpoints").is_dir()


def test_no_traceback_when_the_kernel_is_missing(monkeypatch, tmp_path, capsys):
    """`!python ...` has no kernel: mount raises AttributeError. Explain, do not crash."""
    mod = _launcher()
    monkeypatch.setattr(mod, "DRIVE", tmp_path / "MyDrive/ankit-llm")   # does not exist

    def boom(*a, **k):
        raise AttributeError("'NoneType' object has no attribute 'kernel'")

    fake = types.ModuleType("google.colab")
    fake.drive = types.SimpleNamespace(mount=boom)
    monkeypatch.setitem(sys.modules, "google.colab", fake)

    assert mod.mount_drive() is None
    out = capsys.readouterr().out
    assert "subprocess" in out
    assert "drive.mount" in out, "must show the cell snippet to run"


def test_outside_colab_is_not_an_error(monkeypatch, tmp_path):
    mod = _launcher()
    monkeypatch.setattr(mod, "DRIVE", tmp_path / "nope")
    monkeypatch.setitem(sys.modules, "google.colab", None)     # ImportError
    assert mod.mount_drive() is None
