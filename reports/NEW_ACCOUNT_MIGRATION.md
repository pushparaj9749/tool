# GPU quota khatam — doosre Google account par training kaise continue karein

Problem: Colab ka GPU quota **per Google account** hota hai. Checkpoint **us account ki Drive**
me hai jisne train kiya. Doosre account ka Colab apni Drive mount karega — jisme checkpoint
nahi hai — to training step 0 se shuru hone lagti hai.

Tafseel: checkpoint `ankitmahato5533@gmail.com` ki Drive me hai
(`ankit-llm/checkpoints/t4-full/step5800.pt`, 1.27 GB). GPU 5533 ka khatam. Naya account
(family/doosra Gmail) chalayega.

---

## Pehle: git par 1.27 GB nahi aa sakta (numbers ke saath)

| raasta | limit | result |
|---|---|---|
| repo me normal commit | **100 MB** per file (GitHub hard block, ~50 MB warning) | 1.27 GB → **reject** |
| Git LFS | free 1 GB storage + 1 GB/month bandwidth | ek clone me hi khatam |
| GitHub **Releases** asset | 2 GB per file, free | technically chalega — par har chunk ke baad naya 1.27 GB upload (~3–5 min), 11 chunks = ~14 GB. Aur wo file mujhe Drive se uthane ka raasta nahi hai — sirf tumhare Colab se upload ho sakti hai, token ke saath. |

Isliye **checkpoint git par nahi**, uski jagah **account ke beech copy** hoti hai — jo Google ke
network ke andar hoti hai, is machine par bytes aate hi nahi (na download, na upload).

---

## Tarika 3 step me (~5 min, ek hi baar)

### Step A — 5533 account se folder share karo

1. Drive kholo → **ankit-llm** folder (ya sirf `checkpoints/t4-full`)
2. Right-click → **Share**
3. Naye Gmail ka address daalo → role **Viewer** (padhne ke liye kaafi; copy usi se ho jayega)
4. **Send** → naye account me email aayegi → **Open** / accept

> Naya account chahe to *Editor* bhi de sakta hai — import ke liye farak nahi padta.
> Naya account is folder me **likhega nahi**, sirf copy karega.

### Step B — naye account ke Colab me import chalao

```python
from google.colab import drive
drive.mount('/content/drive')          # ← jo account GPU chala raha hai, wahi

!git clone -q --depth 1 https://github.com/pushparaj9749/tool.git /content/ankit-llm 2>/dev/null || \
  (git -C /content/ankit-llm fetch -q --depth 1 origin main && git -C /content/ankit-llm reset -q --hard origin/main)
%cd /content/ankit-llm
!pip install -q pyyaml tokenizers
!python scripts/import_checkpoint.py --method copy
```

Kya hota hai:

```
[import] DRIVE ROOT (this account): /content/drive/MyDrive/ankit-llm
[import] this account: <naya gmail>
[import] source: step5800.pt (1.27 GB)
[import] copying server-side (no download)…
[import] copied -> step5800.pt (1.27 GB)
[import] wrote latest.json
READY — this account's Drive now has step5800.pt (step 5800).
```

Server-side copy hai: 1.27 GB Google ke andar move hota hai, **~30–60 second**, tumhara
internet use nahi hota. Naye account ki Drive me exactly wahi layout ban jata hai jo restore
code padhta hai (`stepNNNN.pt` + sidecar + `latest.json`).

> Share accept nahi kiya to script bol dega. Tab doosra raasta:
> 5533 me file → Share → **Anyone with the link** → phir
> `!python scripts/import_checkpoint.py --method download --file '<link>'`
> (ye asli download hai, ~1.27 GB, 1–3 min).

### Step C — chunk chalao (wahi purana cell)

```python
!python notebooks/PASTE_ONE_CELL.py --budget-min 60
```

Expected:

```
DRIVE ACCOUNT: <naya gmail> | ...
>>> MODE = resume
[autopilot] Drive mirror t4-full contains: ['latest.json', 'step5800.pt', ...]
[autopilot] restoring step5800.pt (step 5800) from Drive
```

Bas — step 5,800 se aage. Aage ke checkpoints **naye account ki Drive** me jayenge.

---

## Dhyaan rakhne wali 3 baatein

1. **Pehla chunk thoda lamba lagega (~10–20 min extra).** Naye account ki Drive me
   `artifacts/` cache nahi hai, isliye token shards ek baar phir banenge. Uske baad wo cache
   naye account ki Drive me chala jayega aur aage ke chunks fast honge.
2. **Har naye account = ek baar import.** Checkpoint jis account ki Drive me hai, training
   wahi likhta hai. Account badla → wahi copy dobara (Step B).
3. **Wapas 5533 par aana ho to ulta karo**: 5533 me share → 5533 ke Colab me
   `import_checkpoint.py`. Script idempotent hai — jo pehle se hai use chhodta hai.

---

## Ek aur cheez: `ANKIT_DRIVE_DIR`

Agar tum chahte ho ki naya account **purane account ki hi Drive me likhe** (copy karne ke
bajaye), to Drive me shortcut/folder mount karke raasta badal sakte ho:

```python
import os
os.environ["ANKIT_DRIVE_DIR"] = "/content/drive/MyDrive/ankit-llm-shared"
```

`colab_autopilot.py` aur `PASTE_ONE_CELL.py` dono isko respect karte hain. Par Colab ke FUSE
mount me shortcut folder kabhi-kabhi folder ki tarah nahi dikhta (file ki tarah dikhta hai) —
isliye **recommended raasta wahi server-side copy hai**, jo har case me chalta hai.

---

## Checklist (copy-paste ke liye)

- [ ] 5533 → `ankit-llm` folder → Share → naya Gmail → Viewer → Send
- [ ] naya Gmail → email accept
- [ ] naya account Colab → Drive mount (`DRIVE ACCOUNT` line check karo)
- [ ] `python scripts/import_checkpoint.py --method copy` → `READY — … step 5800`
- [ ] `python notebooks/TRY_MODEL.py --chat` (optional, model test)
- [ ] `python notebooks/PASTE_ONE_CELL.py --budget-min 60` → chunk chalu
