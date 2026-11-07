"""Bring the newest checkpoint into *this* Google account's Drive — without re-downloading it.

Why this exists
---------------
Colab's GPU quota is per Google account, but a checkpoint lives in the Drive of whichever
account trained it. So the moment you run the next chunk on a *second* account, that
account's `/content/drive/MyDrive/ankit-llm/checkpoints/t4-full` is empty and training would
restart at step 0 — the same class of accident as 2026-11-06.

This script moves the checkpoint between accounts in the cheapest way available:

1. **Shared folder + server-side copy (best, no bytes over the wire).** If the file is shared
   with this account (or "anyone with the link"), Drive copies it *inside Google's network*:

       !python scripts/import_checkpoint.py --method auto

2. **Public link download.** If a server-side copy is not possible, pass the file id or link
   and it curls the file into place:

       !python scripts/import_checkpoint.py --method download --file <drive url or id>

3. **Already there?** It does nothing and says so (idempotent).

Afterwards the ordinary launcher works unchanged (`PASTE_ONE_CELL.py` /
`colab_autopilot.py --mode resume`) because the checkpoint, its sidecar and `latest.json`
are now in *this* account's Drive, in the exact layout `newest_mirrored_checkpoint()` reads.

Nothing here writes to the source account.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

FOLDER_MIME = "application/vnd.google-apps.folder"
POINTER = "latest.json"
DEFAULT_SUBDIR = "checkpoints/t4-full"


def drive_root() -> Path:
    """Where this account keeps the project.

    `ANKIT_DRIVE_DIR` overrides it, so a shared folder mounted at a different path (or a
    hand-made shortcut) still works without patching code.
    """
    env = os.environ.get("ANKIT_DRIVE_DIR")
    return Path(env) if env else Path("/content/drive/MyDrive/ankit-llm")


# ------------------------------------------------------------------ pure helpers (tested)
def parse_file_id(text: str) -> str:
    """Accept a raw id, a `.../file/d/<id>/view` link or a `?id=<id>` link."""
    text = (text or "").strip()
    if not text:
        return ""
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", text):
        return text
    for pattern in (r"/file/d/([A-Za-z0-9_-]{10,})", r"/folders/([A-Za-z0-9_-]{10,})",
                    r"[?&]id=([A-Za-z0-9_-]{10,})"):
        m = re.search(pattern, text)
        if m:
            return m.group(1)
    return ""


def step_of(name: str) -> int:
    m = re.search(r"step(\d{1,9})", name or "")
    return int(m.group(1)) if m else -1


def pick_newest_checkpoint(files: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Newest `*.pt` by step number (then by modified time). Sidecars are not candidates."""
    best: Optional[tuple] = None
    for f in files or []:
        name = str(f.get("name") or "")
        if not name.endswith(".pt") or name.startswith("latest"):
            continue
        key = (step_of(name), str(f.get("modifiedTime") or ""))
        if best is None or key > best[0]:
            best = (key, f)
    return best[1] if best else None


def pointer_payload(name: str, step: int, size: int) -> Dict[str, Any]:
    """Same shape the trainer writes, so restore/verify code needs no special case."""
    return {"tag": Path(name).stem, "file": name, "step": step, "bytes": int(size),
            "mirrored_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}


def install_local(src_pt: Path, target_dir: Path, sidecar: Optional[Path] = None) -> Path:
    """Place a downloaded checkpoint + its sidecar + `latest.json` into the mirror layout."""
    target_dir.mkdir(parents=True, exist_ok=True)
    dest = target_dir / src_pt.name
    if dest.exists() and dest.stat().st_size == src_pt.stat().st_size:
        return dest                                    # idempotent
    shutil.copyfile(src_pt, dest)
    if sidecar and sidecar.exists():
        shutil.copyfile(sidecar, target_dir / sidecar.name)
    write_pointer(target_dir, dest.name, step_of(dest.name), dest.stat().st_size)
    return dest


def write_pointer(target_dir: Path, name: str, step: int, size: int) -> Path:
    pointer = target_dir / POINTER
    pointer.write_text(json.dumps(pointer_payload(name, step, size), indent=2) + "\n",
                       encoding="utf-8")
    return pointer


def already_present(target_dir: Path) -> Optional[Path]:
    """A complete checkpoint already in *this* account's Drive (byte-checked)."""
    if not target_dir.is_dir():
        return None
    from training.mirror import newest_mirrored_checkpoint
    found = newest_mirrored_checkpoint(target_dir)
    return found


# ------------------------------------------------------------------ Drive API paths
SCOPES = ["https://www.googleapis.com/auth/drive"]


def credentials():
    """A real *user* credential for this Colab account.

    Without this, `build("drive", "v3")` falls back to Application Default Credentials,
    which on Colab means asking the GCE metadata server and dying with:

        google.auth.exceptions.RefreshError: Failed to retrieve
        http://metadata.google.internal/... Status: 404

    So: authenticate as the signed-in user first (a popup the first time only), then take
    `google.auth.default()`, which returns those credentials.
    """
    try:
        from google.colab import auth as colab_auth       # noqa: PLC0415
        colab_auth.authenticate_user()
    except Exception:                                     # noqa: BLE001
        pass                                              # not Colab: ADC is the right answer
    import google.auth                                    # noqa: PLC0415
    creds, _ = google.auth.default(scopes=SCOPES)
    return creds


def _api():
    """Drive v3 client with a working credential and a real socket timeout."""
    import httplib2                                       # noqa: PLC0415
    from googleapiclient.discovery import build           # noqa: PLC0415
    http = httplib2.Http(timeout=300)       # also silences the per-request timeout warning
    return build("drive", "v3", http=credentials().authorize(http), cache_discovery=False)


def _whoami(api) -> str:
    try:
        user = api.about().get(fields="user").execute().get("user", {})
        return user.get("emailAddress") or "?"
    except Exception:                                   # noqa: BLE001
        return "?"


def _ensure_folder(api, subdir: str) -> str:
    """Find (or create) `MyDrive/ankit-llm/<subdir>` and return its id."""
    parent = "root"
    for part in ["ankit-llm"] + subdir.strip("/").split("/"):
        q = (f"name = '{part}' and '{parent}' in parents and "
             f"mimeType = '{FOLDER_MIME}' and trashed = false")
        found = api.files().list(q=q, fields="files(id,name)", pageSize=1).execute().get("files", [])
        if found:
            parent = found[0]["id"]
        else:
            parent = api.files().create(
                body={"name": part, "mimeType": FOLDER_MIME, "parents": [parent]},
                fields="id").execute()["id"]
    return parent


def find_shared(api, want_step: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """Newest checkpoint visible to this account, including files shared with it."""
    q = "name contains 'step' and trashed = false and mimeType != 'application/vnd.google-apps.folder'"
    res = api.files().list(q=q, pageSize=200, orderBy="modifiedTime desc",
                           fields="files(id,name,size,modifiedTime,owners(emailAddress))",
                           includeItemsFromAllDrives=True, supportsAllDrives=True).execute()
    files = res.get("files", [])
    if want_step is not None:
        exact = [f for f in files if step_of(str(f.get("name"))) == want_step]
        if exact:
            files = exact
    return pick_newest_checkpoint(files)


def resolve_source(api, file_id: str, want_step: Optional[int] = None) -> Optional[Dict[str, Any]]:
    """A link may point at a file *or* at the t4-full folder. Both are accepted."""
    meta = api.files().get(fileId=file_id,
                           fields="id,name,size,modifiedTime,mimeType").execute()
    if meta.get("mimeType") != FOLDER_MIME:
        return meta
    kids = api.files().list(q=f"'{file_id}' in parents and trashed = false", pageSize=200,
                            fields="files(id,name,size,modifiedTime)",
                            orderBy="modifiedTime desc").execute().get("files", [])
    if want_step is not None:
        exact = [f for f in kids if step_of(str(f.get("name"))) == want_step]
        if exact:
            kids = exact
    return pick_newest_checkpoint(kids)


def copy_server_side(api, file_id: str, name: str, dest_folder_id: str) -> Dict[str, Any]:
    """Copy inside Google's network — the bytes never touch this VM."""
    return api.files().copy(fileId=file_id,
                            body={"name": name, "parents": [dest_folder_id]},
                            fields="id,name,size,modifiedTime").execute()


# Drive serves anything over ~100 MB as an HTML interstitial if you ask the old way, so a
# "successful" curl can still hand you 2 KB of HTML. Best-first, and every attempt is
# verified by size before it is trusted.
DOWNLOAD_URLS = [
    "https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t",
    "https://drive.google.com/uc?export=download&id={id}&confirm=t",
]
MIN_BYTES = 100 * 1024 * 1024


def looks_like_html(path: Path) -> bool:
    try:
        head = path.open("rb").read(512).lstrip().lower()
    except OSError:
        return True
    return head.startswith(b"<!doctype html") or head.startswith(b"<html")


def _curl(url: str, path: Path) -> subprocess.CompletedProcess:
    return subprocess.run(["curl", "-L", "--fail", "--retry", "3", "--continue-at", "-",
                           "-A", "Mozilla/5.0", "-o", str(path), url],
                          capture_output=True, text=True)


def _gdown(path: Path, file_id: str) -> bool:
    """gdown solves the confirm-token dance properly; use it when it is available."""
    cmd = [sys.executable, "-m", "gdown", "--id", file_id, "-O", str(path)]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 and "No module named gdown" in (r.stderr or ""):
        print("[import] gdown install kar raha hoon…", flush=True)
        subprocess.run([sys.executable, "-m", "pip", "install", "-q", "gdown"],
                       capture_output=True, text=True)
        r = subprocess.run(cmd, capture_output=True, text=True)
    return r.returncode == 0


def download_to(path: Path, file_id: str, min_bytes: int = MIN_BYTES) -> None:
    """Fetch a public Drive file, verifying size — an HTML page is not a checkpoint."""
    path.parent.mkdir(parents=True, exist_ok=True)
    notes = []
    for template in DOWNLOAD_URLS:
        url = template.format(id=file_id)
        print(f"[import] downloading {url}", flush=True)
        r = _curl(url, path)
        size = path.stat().st_size if path.exists() else 0
        if r.returncode == 0 and size >= min_bytes and not looks_like_html(path):
            print(f"[import] got {size/1e9:.2f} GB", flush=True)
            return
        notes.append(f"{url.split('?')[0]} -> rc={r.returncode}, {size/1024:.0f} KB"
                     f"{' (HTML page)' if path.exists() and looks_like_html(path) else ''}")
        path.unlink(missing_ok=True)

    print("[import] curl ne poora file nahi diya, gdown try kar raha hoon…", flush=True)
    if _gdown(path, file_id) and path.exists() and path.stat().st_size >= min_bytes:
        print(f"[import] gdown got {path.stat().st_size/1e9:.2f} GB", flush=True)
        return
    path.unlink(missing_ok=True)
    raise SystemExit(
        "download fail: Google ne file ke bajaye HTML/adhoora page bheja.\n  " + "\n  ".join(notes)
        + "\nIse aise karo (Colab me sabse pakka):\n"
          f"  !pip install -q gdown && gdown --id {file_id} -O {path}\n"
          "Agar gdown bhi fail ho: Drive me file kholo -> Download (browser se) -> phir Colab me "
          "Files panel se upload karo, ya folder ko is account ke saath share karke "
          "--method copy chalao.")


# ------------------------------------------------------------------ main
def main() -> None:
    ap = argparse.ArgumentParser(description="bring the checkpoint into this account's Drive")
    ap.add_argument("--method", default="auto", choices=["auto", "copy", "download"])
    ap.add_argument("--file", default="", help="Drive file/folder link or id of the source")
    ap.add_argument("--step", type=int, default=None, help="exact step to import")
    ap.add_argument("--subdir", default=DEFAULT_SUBDIR)
    ap.add_argument("--no-color", action="store_true")
    args = ap.parse_args()

    target = drive_root() / args.subdir
    print(f"[import] DRIVE ROOT (this account): {drive_root()}", flush=True)
    print(f"[import] target: {target}", flush=True)

    found = already_present(target)
    if found is not None:
        from training.mirror import newest_mirrored_checkpoint
        step = step_of(found.name) if step_of(found.name) >= 0 else -1
        print(f"[import] nothing to do — this account already has {found.name} "
              f"(step {step})", flush=True)
        print("[import] next: python notebooks/PASTE_ONE_CELL.py --budget-min 60", flush=True)
        return

    api = None
    try:
        api = _api()
        print(f"[import] this account: {_whoami(api)}", flush=True)
    except Exception as exc:                            # noqa: BLE001
        print(f"[import] Drive API unavailable ({type(exc).__name__}: {exc})", flush=True)

    src_id = parse_file_id(args.file)
    if args.method in ("auto", "copy") and api is not None:
        source = None
        try:
            if src_id:
                source = resolve_source(api, src_id, args.step)
            else:
                source = find_shared(api, args.step)
        except Exception as exc:                        # noqa: BLE001
            # auth/quota/network trouble must not hide the working path
            print(f"[import] Drive API search failed: {type(exc).__name__}: {exc}", flush=True)
            print("[import] falling back — use --method download with a public link",
                  flush=True)
            source = None
        if source:
            name = str(source.get("name") or "checkpoint.pt")
            if not name.endswith(".pt"):
                name += ".pt"
            print(f"[import] source: {name} ({int(source.get('size') or 0)/1e9:.2f} GB)", flush=True)
            try:
                dest_id = _ensure_folder(api, args.subdir)
            except Exception as exc:                    # noqa: BLE001
                raise SystemExit(
                    f"apni Drive me folder nahi ban paya: {type(exc).__name__}: {exc}\n"
                    "Ye tab hota hai jab Drive API ka scope/permission adhoora ho. "
                    "--method download se ye bypass ho jata hai.")
            print("[import] copying server-side (no download)…", flush=True)
            copied = copy_server_side(api, source["id"], name, dest_id)
            size = int(copied.get("size") or 0)
            print(f"[import] copied -> {name} ({size/1e9:.2f} GB)", flush=True)
            # the sidecar travels with it, if the source has one
            side_name = Path(name).with_suffix(".json").name
            try:
                peers = api.files().list(
                    q=f"name = '{side_name}' and trashed = false",
                    fields="files(id,name,size)", pageSize=2).execute().get("files", [])
                if peers:
                    copy_server_side(api, peers[0]["id"], side_name, dest_id)
                    print(f"[import] copied sidecar {side_name}", flush=True)
            except Exception as exc:                    # noqa: BLE001
                print(f"[import] sidecar copy skipped: {exc}", flush=True)
            pointer = write_pointer_via_api(api, dest_id, name, step_of(name), size)
            print(f"[import] wrote {pointer}", flush=True)
            done(name, step_of(name))
            return
        if args.method == "copy":
            raise SystemExit("source checkpoint not visible to this account — share it with "
                             "this account (or make the link public) and re-run, or pass --file")

    # fallback: plain download of a public file
    if not src_id:
        raise SystemExit(
            "koi source nahi mila. 3 me se koi ek karo:\n"
            "  1) purane account me file -> Share -> 'Anyone with the link' -> Copy link, phir\n"
            "     python scripts/import_checkpoint.py --method download --file '<link>' --step 5800\n"
            "     (asli download, ~1-3 min; Drive API ki zarurat nahi — sabse pakka raasta)\n"
            "  2) purane account se folder is account ke saath share (Viewer) -> email accept ->\n"
            "     python scripts/import_checkpoint.py --method copy\n"
            "  3) kaam nahi kar raha to: python scripts/import_checkpoint.py --method copy --file '<folder link>'\n"
            "     (folder link se newest stepNNNN.pt khud chun lega)")
    tmp = Path("/content/_import") / "step_download.pt"
    download_to(tmp, src_id)              # raises with instructions if it is not a file
    size = tmp.stat().st_size
    name = f"step{args.step}.pt" if args.step else "latest.pt"
    print(f"[import] saving as {name} (pointer step {step_of(name)})", flush=True)
    dest = install_local(tmp, target, sidecar=None)
    print(f"[import] installed {dest} ({dest.stat().st_size/1e9:.2f} GB)", flush=True)
    done(dest.name, step_of(dest.name))


def write_pointer_via_api(api, folder_id: str, name: str, step: int, size: int) -> Path:
    """Write `latest.json` next to the checkpoint on Drive (via API, so no FUSE surprises)."""
    body = json.dumps(pointer_payload(name, step, size))
    q = f"name = '{POINTER}' and '{folder_id}' in parents and trashed = false"
    existing = api.files().list(q=q, fields="files(id)", pageSize=1).execute().get("files", [])
    from googleapiclient.http import MediaInMemoryUpload   # noqa: PLC0415
    media = MediaInMemoryUpload(body.encode("utf-8"), mimetype="application/json")
    if existing:
        api.files().update(fileId=existing[0]["id"], media_body=media).execute()
    else:
        api.files().create(body={"name": POINTER, "parents": [folder_id]},
                           media_body=media, fields="id").execute()
    return drive_root() / DEFAULT_SUBDIR / POINTER


def done(name: str, step: int) -> None:
    print("\n" + "=" * 72, flush=True)
    print(f"READY — this account's Drive now has {name} (step {step}).", flush=True)
    print("Ab normal cell chalao; training yahin se aage badhegi:", flush=True)
    print("  python notebooks/PASTE_ONE_CELL.py --budget-min 60", flush=True)
    print("=" * 72, flush=True)


if __name__ == "__main__":
    main()
