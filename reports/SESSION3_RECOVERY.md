# Session 3 — runtime band ho gaya: poora sach, aur ab kya karna hai

Sab kuch Drive ke artefacts se **verify** karke likha hai. Guess nahi. Aur ek jagah
mujhe pehle galat diagnosis hua tha — wo bhi neeche correct kiya hai.

## 1. Asli timeline (artefacts se)

| time (UTC) | kya hua | proof |
|---|---|---|
| 10:56:56 | notebook cell chala, log bana | Drive log |
| — | prepare PASS: 24,100,344 train / 402,704 val tokens, leakage 0 | log |
| — | benchmark 54 cells → chooser: fp16 / bs16 / seq512 / accum1 | log |
| 11:11–11:17 | pilot 300 steps, loss 9.5613 → 3.8324, val_loss **5.0357** | log + Drive |
| ~11:17 | resume test **PASS** (`resumed ... at step 300`) | log |
| **11:19:13** | long run `autopilot-full-1119` chala | 240 s @ step 400 se derive |
| 11:21:05 | step 200 local save | `step200.json` |
| 11:22:45 | step 200 Drive par | Drive mtime |
| 11:23:14 | step 400 local save | `step400.json` |
| **11:23:35** | step 400 Drive par — **aakhri write** | Drive mtime |
| — | log ka aakhri line: `step 400 loss=4.3542 ... tok/s=13655.6 eta=2437.0m` | log (21,803 B) |

Matlab: **long run sirf 4.3 minute chala**, poora session 27 minute. 11:23:35Z ke baad
Drive par kuch bhi nahi likha gaya — na checkpoint, na log line, na summary.

## 2. Kya bacha

| file | step | tokens |
|---|---|---|
| `t4-full/step400.pt` | 400 | 3,276,800 |
| `t4-full/step200.pt` | 200 | 1,638,400 |
| `t4-pilot/final.pt` | 320 | 2,621,440 |
| `t4-pilot/step300.pt` | 300 | 2,457,600 |
| `t4-pilot/best-step300.pt` | 300 | 2,457,600 |

"5,520 steps" ka **koi artefact nahi hai**. Agar GPU sach me uske baad chalta raha, to wo
zero durability ke saath chala — aur wahi asli bug hai.

## 3. Meri pichhli galti (correction)

Maine bola tha "mirror session ka 80% time kha raha tha, ek copy 5–8 min". **Ye galat tha.**
Numbers ulta kehte hain:

- `step200.json.created_at` (11:21:05) → `step400.json.created_at` (11:23:14) = **129.0 s**
  me 200 steps. Pure compute (14,696 tok/s) = 111.5 s ⇒ **copy ~17.5 s**.
- Log bhi wahi kehta hai: 400 steps = **240 s** total, 223 s compute + ~17 s copy = **~7%**.

1.27 GB / 17.5 s ≈ 73 MB/s — healthy Drive mount. Async mirror rakhna phir bhi theek hai
(7% critical path se hat jata hai), par session ka tail isse nahi gaya.

## 4. Do asli bug (fix ho gaye)

1. **Silent failure, koi signal nahi.** 11:23:35 ke baad kuch persist nahi hua aur kisi
   cheez ko farq nahi pada: heartbeat nahi, watchdog nahi, fail hone par bas ek warning
   line 21 KB ke log me, summary sirf sabse aakhir me. Console `loss=...` print karta rehta
   hai, model kuch save nahi karta — pata hi nahi chalta.
2. **Mirror Drive quota leak kar raha tha.** Har naya checkpoint purane ko prune karta tha,
   aur Drive mount par `unlink` = **trash** me move, jo quota khata hai. Abhi Drive me 16
   trashed 1.27 GB checkpoints (~20.3 GB) pade hain + 6.35 GB live. Poora 244,141-step run
   ~1,220 saves karta → **~1.5 TB trash**. Free 15 GB Drive to ~10 saves me hi bhar jata.

## 5. Fix (is commit me)

1. **Ek rolling file**: mirror `<run>/latest.pt` ko overwrite karta hai, step-tagged files +
   prune nahi. Footprint constant 1.27 GB, trash nahi badhta, clean-up nahi chahiye.
2. **`heartbeat.json` har 100 steps**: step, tokens_seen, loss, tok/s, mirror health.
   Kuch hundred bytes — "GPU ghanton chala, kitna hua?" ka seedha jawab.
3. **Watchdog**: har heartbeat par current step vs Drive par asli step compare; 600 steps se
   zyada peeche, 30 min se kuch land nahi hua, ya copies fail ho rahi hain → 6-line laal
   warning `MIRROR IS NOT KEEPING UP`.
4. **Loud + retry**: 2 retries (12 s / 24 s backoff), rename ke baad size verify,
   permanent fail par `MIRROR FAILED ... this checkpoint is NOT on Drive`, aur session ke
   end me banner agar kuch bhi Drive par nahi pahuncha.
5. **Preflight probe**: long run se pehle chhoti file likh kar check — fail ho to saaf
   message: "Drive full → Trash khaali karo".
6. **Restore par gap report**: naye VM par heartbeat padh kar batata hai "aakhri session
   step X tak gaya, newest checkpoint step Y" — loss shuru se pehle pata chal jata hai.
7. Purane step-tagged mirrors (jo abhi Drive par hain) **abhi bhi resumable** hain.

## 6. Verified (CPU host, measured)

```
pytest tests/            -> 71 passed
--self-test              -> PASS
resume e2e               -> local checkpoints delete -> restored latest.pt (step 5) -> resumed at step 5
dead-mirror drill        -> MIRROR FAILED + MIRROR IS NOT KEEPING UP +
                            NO CHECKPOINT REACHED DRIVE, heartbeat phir bhi likha,
                            training exit code 0 (dead Drive healthy run ko nahi maarta)
```

## 7. Tumhe ab kya karna hai

1. **Ek baar Google Drive → Trash → Empty trash** (ye ~20 GB free karega). Ye permanent hai,
   isliye maine khud nahi kiya — lekin trash me sirf purane prune hue checkpoints hain, koi
   unique data nahi. Ab naya design trash nahi badhata, to ye ek hi baar karna hai.
2. Naya Colab: **https://colab.research.google.com/github/pushparaj9749/tool/blob/main/notebooks/ANKIT_LLM_Colab_ONE_CLICK.ipynb**
3. Runtime → T4 → Cell 1 → Cell 2 → **Cell 3** (khud `--mode resume` chunega, step 400 se aage).

## 8. Honest expectation

T4 par kuch bhi naya measure nahi hua. Measurements jo hain: ~1.7 steps/s, ~7% mirror
overhead ⇒ 8 ghante me ~45k steps (~370M tokens). Poora 2B target ≈ 5–6 sessions.
Aur ek data problem: corpus 24.1M tokens hai, to 2B tokens = ~83 epochs — overfit hoga.
Isliye ~20–25 epochs (~58k–73k steps) par cap lagana zyada samajhdari hai. Bolo to laga du.

---

# Chunk mode — 60 minute max per run (user's call)

Long sessions are what keep dying. Ab har run **60 minute ka chunk** hai:

- `SESSION_BUDGET_MIN = 60` (notebook) ⇒ autopilot ~**53 min** training + tail for the
  final eval/save/Drive flush, then `stop=time_budget` and a clean exit.
- Chunk ke aakhir me: `final.pt` → rolling `latest.pt` on Drive → cell ruk jata hai.
- Cell khud print karta hai: `CHUNK DONE — step X / 64,000 (Y%)` aur
  `reports/autopilot_chunk_progress.json` bhi likhta hai.
- Agla chunk: **wahi Cell 3 dobara chalao** — Drive se newest checkpoint restore hota hai
  (~20-30 s) aur wahin se training aage.
- 60 min ≈ **~5,000 steps** ⇒ 64,000 steps ≈ **12–13 chunks**. Ek chunk gaya to sirf
  60 min gaya, poora din nahi.

**Isliye data Drive par cache hota hai.** Fresh Colab VM par data rebuild (download +
tokenize) 10–20 min leta hai — 60 min chunk me wo 25% hai. Ab `artifacts/` folder Drive par
ek baar cache hota hai (tokenizer + 3 bins + SFT = ~50 MB, `manifest.json` ke saath), aur
naye session me seconds me wapas aata hai. Short/truncated cache detect hone par rebuild
hota hai (chupchaap galat data se train nahi hota).
