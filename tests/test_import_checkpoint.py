"""Moving a checkpoint to a second Google account's Drive must be boring and exact.

Context: Colab's GPU quota is per account. When the training account's quota ran out, the
only way to keep training was a second account — whose `/content/drive/MyDrive/...` is a
different Drive with no checkpoint in it. These tests cover the parts of the import tool that
do not need the network: link parsing, which file to take, and that the result is exactly the
layout `newest_mirrored_checkpoint()` expects.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.import_checkpoint import (already_present, install_local, parse_file_id,  # noqa: E402
                                       pick_newest_checkpoint, pointer_payload, step_of,
                                       write_pointer)
from training.mirror import newest_mirrored_checkpoint  # noqa: E402


def test_parse_file_id_accepts_every_shape_drive_hands_out():
    fid = "1oDzf81qpoOlhNEobd6QRS7xTfHuL5Vwf"
    assert parse_file_id(fid) == fid
    assert parse_file_id(f"https://drive.google.com/file/d/{fid}/view?usp=drive_link") == fid
    assert parse_file_id(f"https://drive.google.com/uc?export=download&id={fid}") == fid
    # a folder link is accepted too - resolve_source() turns it into its newest .pt
    assert parse_file_id("https://drive.google.com/drive/folders/1ABCdefGHIjklMNOP") == \
        "1ABCdefGHIjklMNOP"
    assert parse_file_id("") == ""


def test_step_numbers_come_out_of_the_names():
    assert step_of("step5800.pt") == 5800
    assert step_of("latest.pt") == -1
    assert step_of("best-step300.pt") == 300


def test_pick_newest_ignores_the_pointer_and_sidecars():
    files = [
        {"name": "latest.pt", "id": "a", "modifiedTime": "2026-11-06T20:00:00Z"},
        {"name": "step5600.pt", "id": "b", "modifiedTime": "2026-11-06T19:56:00Z"},
        {"name": "step5800.pt", "id": "c", "modifiedTime": "2026-11-06T19:58:00Z"},
        {"name": "step5800.json", "id": "d", "modifiedTime": "2026-11-06T19:58:00Z"},
        {"name": "step400.pt", "id": "e", "modifiedTime": "2026-11-06T11:23:00Z"},
    ]
    assert pick_newest_checkpoint(files)["id"] == "c"
    assert pick_newest_checkpoint([]) is None


def test_pointer_matches_what_the_trainer_writes():
    p = pointer_payload("step5800.pt", 5800, 1270001459)
    assert p["tag"] == "step5800" and p["file"] == "step5800.pt"
    assert p["step"] == 5800 and p["bytes"] == 1270001459
    assert "mirrored_at" in p


def test_imported_layout_is_resumable_and_idempotent(tmp_path):
    """The whole point: after import, the ordinary restore code finds the checkpoint."""
    source = tmp_path / "download" / "step5800.pt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"\x07" * (2 * 1024 * 1024))
    sidecar = source.with_suffix(".json")
    sidecar.write_text('{"tag": "step5800", "step": 5800, "bytes": 2097152}', encoding="utf-8")

    target = tmp_path / "MyDrive/ankit-llm/checkpoints/t4-full"
    assert already_present(target) is None                 # empty Drive

    dest = install_local(source, target, sidecar=sidecar)
    assert dest.read_bytes() == source.read_bytes()
    assert (target / "latest.json").exists()
    found = already_present(target)
    assert found is not None and found.name == "step5800.pt"
    assert newest_mirrored_checkpoint(target).name == "step5800.pt"

    # second run: no copy, no damage
    again = install_local(source, target, sidecar=sidecar)
    assert again == dest and newest_mirrored_checkpoint(target).name == "step5800.pt"


def test_write_pointer_points_at_a_real_file(tmp_path):
    target = tmp_path / "mirror"
    target.mkdir()
    (target / "step5800.pt").write_bytes(b"\x00" * 1024)
    write_pointer(target, "step5800.pt", 5800, 1024)
    assert newest_mirrored_checkpoint(target).name == "step5800.pt"
    # a wrong byte count (half-copied file) must be rejected, not resumed
    write_pointer(target, "step5800.pt", 5800, 2048)
    assert newest_mirrored_checkpoint(target) is None


def test_drive_root_honours_the_env_override(monkeypatch, tmp_path):
    import scripts.import_checkpoint as mod
    monkeypatch.setenv("ANKIT_DRIVE_DIR", str(tmp_path / "shared"))
    assert mod.drive_root() == tmp_path / "shared"
    monkeypatch.delenv("ANKIT_DRIVE_DIR")
    assert str(mod.drive_root()).endswith("MyDrive/ankit-llm")


def test_download_prefers_the_usercontent_host(tmp_path, monkeypatch):
    """The old `uc?export=download` URL answers a big public file with an HTML page."""
    import subprocess as sp
    import scripts.import_checkpoint as mod

    seen = []

    def fake_curl(url, path):
        seen.append(url)
        path.write_bytes(b"\x00" * 4096)
        return sp.CompletedProcess([], 0, "", "")

    monkeypatch.setattr(mod, "_curl", fake_curl)
    dest = tmp_path / "step5800.pt"
    mod.download_to(dest, "1oDzf81qpoOlhNEobd6QRS7xTfHuL5Vwf", min_bytes=1024)
    assert seen and "drive.usercontent.google.com" in seen[0]
    assert "confirm=t" in seen[0]
    assert dest.exists() and dest.stat().st_size == 4096


def test_download_rejects_html_and_falls_back_to_gdown(tmp_path, monkeypatch, capsys):
    """A 2.5 KB HTML page must never be installed as a 1.27 GB checkpoint."""
    import subprocess as sp
    import scripts.import_checkpoint as mod

    def html_curl(url, path):
        path.write_bytes(b"<!DOCTYPE html><html><body>download quota</body></html>")
        return sp.CompletedProcess([], 0, "", "")

    used = {}

    def fake_gdown(path, file_id):
        used["gdown"] = file_id
        path.write_bytes(b"\x01" * 4096)
        return True

    monkeypatch.setattr(mod, "_curl", html_curl)
    monkeypatch.setattr(mod, "_gdown", fake_gdown)
    dest = tmp_path / "step5800.pt"
    mod.download_to(dest, "1oDzf81qpoOlhNEobd6QRS7xTfHuL5Vwf", min_bytes=1024)
    assert used.get("gdown") == "1oDzf81qpoOlhNEobd6QRS7xTfHuL5Vwf"
    assert dest.stat().st_size == 4096
    assert "gdown" in capsys.readouterr().out


def test_download_failure_explains_what_to_do(tmp_path, monkeypatch):
    import subprocess as sp
    import scripts.import_checkpoint as mod

    def html_curl(url, path):
        path.write_bytes(b"<html>nope</html>")
        return sp.CompletedProcess([], 0, "", "")

    monkeypatch.setattr(mod, "_curl", html_curl)
    monkeypatch.setattr(mod, "_gdown", lambda path, file_id: False)
    with pytest.raises(SystemExit) as exc:
        mod.download_to(tmp_path / "x.pt", "1oDzf81qpoOlhNEobd6QRS7xTfHuL5Vwf", min_bytes=1024)
    msg = str(exc.value)
    assert "gdown --id" in msg and "HTML" in msg
    assert not (tmp_path / "x.pt").exists(), "a broken page must not be left behind"


def test_auth_failure_points_at_the_download_method(tmp_path, monkeypatch, capsys):
    """The Colab ADC/metadata 404 must end in instructions, not a traceback."""
    import scripts.import_checkpoint as mod

    def boom():
        raise RuntimeError("Failed to retrieve http://metadata.google.internal/... 404")

    monkeypatch.setattr(mod, "_api", boom)
    monkeypatch.setattr(mod, "drive_root", lambda: tmp_path / "MyDrive/ankit-llm")
    monkeypatch.setattr(mod.sys, "argv", ["import_checkpoint.py", "--method", "auto"])
    with pytest.raises(SystemExit) as exc:
        mod.main()
    msg = str(exc.value)
    assert "--method download" in msg and "Anyone with the link" in msg
    out = capsys.readouterr().out
    assert "Drive API unavailable" in out


def test_credentials_are_requested_with_drive_scope(monkeypatch):
    """Without an explicit user credential, googleapiclient asks the GCE metadata server."""
    import scripts.import_checkpoint as mod
    assert mod.SCOPES == ["https://www.googleapis.com/auth/drive"]
    src = (Path(__file__).resolve().parents[1] / "scripts/import_checkpoint.py").read_text(
        encoding="utf-8")
    assert "colab.auth" in src or "colab_auth" in src
    assert "google.auth.default(scopes=SCOPES)" in src
