# Session 3 — runtime band ho gaya: kya bacha, kya gaya, ab kya karna hai

Sab numbers Drive par *verify* karke likhe hain, guess nahi.

## 1. Kya bacha (Drive par asli files)

| file | step | tokens | Drive id |
|---|---|---|---|
| `checkpoints/t4-full/step400.pt` | 400 | 3,276,800 | `1ij1Tw9wDnTWMLQ_BHKLgLLRkLbnrpO2E` |
| `checkpoints/t4-full/step200.pt` | 200 | 1,638,400 | `1gONUgUZIUHI4_o-i5oQTtY0MCMP1FUKK` |
| `checkpoints/t4-pilot/final.pt` | 320 | 2,621,440 | `15Bytmo2_fWHLqSvH2p2pa9wYLqiSGLnc` |
| `checkpoints/t4-pilot/step300.pt` | 300 | 2,457,600 | `1WoBhHqWl2IrYuyU3xum8j0nBXlsqsWLt` |
| `checkpoints/t4-pilot/best-step300.pt` | 300 | 2,457,600 | `1YObL4NZQXyMHDTyGXZ8mcuHWqQ7PZkd2` |

`t4-full` par sabse aakhri Drive write: **2026-11-06 11:23:35Z**.
Step 400 ke baad ka kuch bhi Drive par nahi hai — wo sirf Colab ke `/content` disk par tha,
aur runtime stop hone par Colab wo disk **delete** kar deta hai. Isliye step 400 ke baad ka
compute recover nahi ho sakta. Ye loss hai, chhupaya nahi ja raha.

Bachane wali baatein: architecture, tokenizer, data pipeline (24.1M train / 402,704 val
tokens), optimizer/optimizer config, aur resume path — sab intact hai, aur resume **asli T4
par prove ho chuka hai** (`resumed from checkpoints/t4-pilot/final.pt at step 300`).

## 2. Galti kya thi (bug, tumhari galti nahi)

Har 200 steps par 1.27 GB checkpoint Drive par **synchronously**, training loop ke andar
copy hota tha:

- 200 steps ka GPU time ≈ **110 s**
- ek Drive copy ≈ **5–8 min**

Matlab session ka ~80% time Drive ka wait, aur Drive GPU se bahut peeche. Isi wajah se
GPU ne bahut aage tak kaam kiya lekin Drive par sirf step 400 tak hi pahuncha — aur
runtime band hone par jo bacha, wo step 400 tha.

## 3. Fix (merge ho gaya, `main` @ `71727b3`)

1. `training/mirror.py` — **BackgroundMirror**: copy background daemon thread par. Training
   Drive ka wait nahi karti. Queue **coalesce** hoti hai (sirf newest pending), to mirror
   ek copy se zyada kabhi peeche nahi reh sakta.
2. `.partial` → rename, phir `latest.json` — adhoori copy kabhi "latest" nahi banti;
   `newest_mirrored_checkpoint()` byte-size bhi verify karta hai.
3. **Auto-restore**: naya VM khali hota hai, isliye har training entry point pehle newest
   checkpoint Drive se local par laata hai (`stage_restore()` + `pretrain.py` me safety net).
   Ab chupchaap step 0 se restart ho hi nahi sakta.
4. `--mode resume`: restore + train only (bench/pilot/resume-test skip). Measured config
   Drive par cache hoti hai, dobara 54-cell benchmark nahi.
5. `best-step` ab mirror nahi hota (double traffic band).
6. Session cap 5.5 h → **8 h** (Colab ~12 h se neeche), aakhir me final save ke liye 420 s.
7. Pilot ka `loss_improved` ab median-based (step-1 ka lucky-low false alarm nahi deta).

Verification (CPU host): `pytest tests/` → **62 passed**, `--self-test` → PASS (async mirror
bhi test hota hai), aur ek naya end-to-end test: train → local checkpoint dir **delete** →
dobara chalao → `[mirror] restored final.pt (step 5)` + `resumed from ... at step 5`.

## 4. Ab tumhe bas itna karna hai

1. Naya Colab kholo: **https://colab.research.google.com/github/pushparaj9749/tool/blob/main/notebooks/ANKIT_LLM_Colab_ONE_CLICK.ipynb**
2. Runtime → Change runtime type → **T4 GPU**
3. Cell 1 → Cell 2 (Drive mount, OK dabana) → **Cell 3**

Cell 3 khud dekhta hai ki Drive par checkpoint hai: hai → `MODE = resume`, step 400 se
aage badhega (bench/pilot skip). Nahi hota to poora pipeline chalata hai.

## 5. Honest expectation (T4 par abhi measure nahi hua)

Async path **real T4 par nahi chala** hai — ye design + CPU proof hai, measured GPU result
nahi. Isliye jo neeche hai wo estimate hai:

- mirror critical path se hatne ke baad ~1.6–1.8 steps/s (0.55–0.6 s/step) rehna chahiye
- 8 h session ≈ **45–48k steps** (~370–390M tokens), pehle ~5.5k tha
- poora 2B token target (244,141 steps) ≈ **5–6 sessions**

Pehli baar chala kar mujhe `reports/autopilot_summary.md` ka content bhej dena — usme
`[mirror]` stats (copied / coalesced / seconds per copy) aayenge, usse ye estimate
confirm ya correct ho jayega.
