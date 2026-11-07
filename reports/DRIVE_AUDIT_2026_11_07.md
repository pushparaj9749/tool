# Drive audit — 2026-11-07 03:40Z (the run was NOT lost)

This is a straight read of Google Drive, not an inference from logs. It corrects two
earlier conclusions in `reports/T4_PILOT_INCIDENT.md`.

## 1. Which Google account?

The Drive connector is now attached to **`ankitmahato5533@gmail.com`**
(root id `0ACQRvveYIWVsUk9PVA`). Every earlier Drive check in this project was made
against **`ankitmahato4321@gmail.com`** (root `0AFZytLK-q5DrUk9PVA`), whose
`ankit-llm` folder only ever held `step200.pt` / `step400.pt` from 11:21–11:23Z.

So the "checkpoints are missing" scare was **two accounts, not two truths**:

| account | what is there | newest step |
|---|---|---|
| `ankitmahato4321@gmail.com` | `t4-full/step200.pt`, `step400.pt` (2026-11-06 11:21–11:23Z) | 400 |
| `ankitmahato5533@gmail.com` | `t4-full/step5600.pt`, `step5800.pt`, `latest.json` (2026-11-06 19:56–19:58Z) | **5,800** |

**The maximum recoverable step is 5,800, not 400.** The 5,800 sits in the account the
Colab runtime was actually signed into — which is the account that matters, because
that is where the notebook will mount Drive next time too.

## 2. What exactly is in `ankitmahato5533@gmail.com`

```
MyDrive/ankit-llm/                     1sOWPWDdd6ZTA9RqofR2vMhtlBfwzq4Bb
├── reports/                           12JT8EMsYo90De5Slp3_hg1fWGDL_3S7C
│   └── autopilot_config_choice.json   18:50:59Z, 532 B
└── checkpoints/                       17yM7wAIOHhJd25hFKeq20GJDUC9PFBbw
    ├── t4-pilot/                      1vgTvtPtbHeDDZ8mgjDWx28SUUBDamzJ3
    │   └── (step200.pt, step200.json → now in trash)
    └── t4-full/                       147CYEgdBRTMYVmMeEx091cbOpYBs7WuV
        ├── step5600.pt / .json        19:56:23Z   1.27 GB each
        ├── step5800.pt / .json        19:58:19Z   1.27 GB each
        └── latest.json                19:58:41Z   129 B  → step 5800
```

Trash holds `step200.pt`, `step400.pt`, `step2000.pt`, `step4000.pt` (+ sidecars) —
those were pruned by the old build's `keep=3`, which is also why the Drive trash keeps
growing. Nothing is deleted permanently; per the user's instruction the trash stays.

## 3. That run used an OLD checkout — provable from Drive alone

The current build writes a **rolling** `latest.pt` and a `heartbeat.json` every 100
steps, and its pointer carries `sha256`, `tokens_seen`, `created_at`. What is on Drive
is:

- `latest.json` = **129 bytes**, keys `tag, file, step, bytes, mirrored_at` only →
  written by the legacy synchronous `checkpoint.mirror_checkpoint()`;
- **step-tagged** `step5600.pt` / `step5800.pt` instead of one `latest.pt`;
- **no `heartbeat.json`**;
- **no `WHOAMI.txt`** in `ankit-llm/` (Cell 2 of the current notebook writes it);
- **no `artifacts/`** cache (current build caches the data artefacts).

All five point the same way: the Colab session ran a clone from *before* PR #6/#8/#10,
not `origin/main`. The 60-minute cut-off at 19:58Z is consistent with a session that
died while the code inside it had no chunk framing — the shell (Colab) stopped it, not
the autopilot.

## 4. Timeline reconstructed from the file timestamps (no guessing)

| UTC | event |
|---|---|
| 18:50:59 | `autopilot_config_choice.json` written — benchmark + chooser ran |
| 18:54:32 | `t4-pilot/step200.pt` (pilot) |
| 18:57:38 | `t4-full/` created — the long run started |
| 18:59:57 | `step200.pt` |
| 19:01:48 | `step400.pt` |
| 19:19:10 | `step2000.pt` |
| 19:39:42 | `step4000.pt` |
| 19:56:23 | `step5600.pt` |
| 19:58:19 | `step5800.pt` + `latest.json` |

5,600 steps between 18:59 and 19:58 = **1.60 steps/s**, matching the 14,696 tok/s
benchmark. The session then stopped and wrote nothing more for the next eight hours.

Loss reported by the user's own log for that run: `step 4000 val_loss=3.8075`,
`step 4500 val_loss=3.7673`.

## 5. What changed in the code because of this audit

`scripts/colab_autopilot.py` now writes **`reports/build_stamp.json`** — locally and to
`Drive/ankit-llm/reports/` — at the start of every real run, and prints one line:

```
[build] sha 62921a4 on branch main | all safety markers present
```

It records git sha / branch / commit date / torch / python and whether the five
durability markers (`LATEST_CKPT_NAME`, `_watch_mirror`, `_to_cpu_copy`,
`_preflight_mirror`, `build_stamp`) are present. A run on a stale clone will now
announce itself on Drive instead of leaving a step-tagged mirror nobody can date.
`stage_restore()` also prints the contents of the Drive mirror before it decides,
so "what is actually on Drive" is in the log too.

## 6. Resume contract for the next session (measured, not estimated)

- Start point: **step 5,800** in `ankitmahato5533@gmail.com/MyDrive/ankit-llm/checkpoints/t4-full`.
- Worst-case loss on a stop: the steps since the last save (200) ≈ 2 minutes.
- 60-min chunk ≈ 5,600 steps (measured 1.60 steps/s) → 64,000-step target ≈ 11 more chunks.
- First thing to verify in the log: `[build] sha ... all safety markers present`, then
  `[autopilot] Drive mirror t4-full contains: [... 'step5800.pt' ...]`, then
  `[autopilot] restoring step5800.pt (step 5800) from Drive`.
