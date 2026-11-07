# Model test karne ka tarika — step by step

Do tarike hain. Neeche wala **naya** tarika recommended hai: ek hi script, koi setup nahi.

---

## Tarika A (recommended) — 3 cells, ~5 minute

### Step 0 — Colab kholo

1. Browser me kholo: <https://colab.research.google.com>
2. **File → New notebook** (ya wahi notebook jo tum use karte ho — koi farak nahi padta,
   naya code GitHub se aata hai).
3. GPU optional hai testing ke liye. T4 ho to accha:
   **Runtime → Change runtime type → Hardware accelerator: T4 GPU → Save**.

### Step 1 — Drive mount (ye zaroori hai, warna checkpoint nahi milega)

Naya cell banao aur chalao:

```python
from google.colab import drive
drive.mount('/content/drive')
```

Ek popup aayega → apna Google account choose karo → **Allow** dabao.

Check karo jo line print hui:

```
Mounted at /content/drive
```

> Account **`ankitmahato5533@gmail.com`** hona chahiye — step 5,800 ka checkpoint usi Drive me hai.
> Doosra account hua to testing me "koi checkpoint nahi mila" aayega.

### Step 2 — code laao (naya cell)

```python
!git clone -q --depth 1 https://github.com/pushparaj9749/tool.git /content/ankit-llm 2>/dev/null || \
  (git -C /content/ankit-llm fetch -q --depth 1 origin main && git -C /content/ankit-llm reset -q --hard origin/main)
%cd /content/ankit-llm
!pip install -q pyyaml tokenizers
```

Expected: koi error nahi (pip ki line dikhegi, bas).

Akeli line se verify bhi kar sakte ho:

```python
!cd /content/ankit-llm && git log --oneline -1
```

### Step 3 — model chalao (naya cell)

```python
!python notebooks/TRY_MODEL.py --chat
```

Pehli baar ~3–5 minute lagega (Drive se 1.27 GB checkpoint restore hota hai). Kaise pata
chalega ki chal raha hai — ye lines dikhengi:

```
[tryout] restoring step5800.pt from Drive (this is the slow part)
[tryout] ...
# ANKIT LLM tryout — 2026-11-07T...
- checkpoint: `checkpoints/t4-full/step5800.pt`
- step **5800** | tokens seen 47,513,600 | ~1.97 epochs over the 24.1M-token corpus
## Completions
**prompt:** `भारत की राजधानी`   **temp 0.8:** ...
```

### Step 4 — output padho

Jo file banti hai: **`reports/model_tryout.md`** (Drive par bhi copy:
`MyDrive/ankit-llm/reports/model_tryout.md`). HTML/Colab me padhne ke liye:

```python
!cat /content/ankit-llm/reports/model_tryout.md
```

**Wahi file mujhe bhej dena** (ya output copy kar dena).

---

## Kya expect karna hai (honest)

Step 5,800 = **~2 epochs** (target 64,000 ka 9%).

- ✅ Hindi/English ke shabd, spelling, chhote phrases, spacing — ye sahi aane lagenge
- ✅ Kabhi-kabhi poora sa vakya bhi ban jayega
- ❌ Sawaal ka jawab **nahi** milega — model text *continue* karti hai, baat nahi karti
- ❌ `What is Python?` par definition nahi, bas uske baad ka text

Agar output me `` ya ajeeb characters aayein to wo normal hai (byte-level tokenizer,
kam training). Garbage-looking output bhi **information** hai: matlab base model abhi
kamzor hai — isliye target 64,000 steps hai.

---

## Chhoti-jaldi wali command (agar zyada intezaar nahi karna)

```python
!python notebooks/TRY_MODEL.py --prompts 2 --max-new-tokens 30 --temperatures 0.8
```

- `--prompts 2` → sirf pehle 2 prompt
- `--max-new-tokens 30` → har output 30 token lamba
- `--device cuda` → GPU force (default khud detect karta hai)

## Fancy options

```python
# sirf completion, chat nahi (default)
!python notebooks/TRY_MODEL.py

# 3 temperature par compare
!python notebooks/TRY_MODEL.py --temperatures 0.5,0.8,1.1

# SFT ban jaye to usse test karo
!python notebooks/TRY_MODEL.py --checkpoint checkpoints/t4-sft/final.pt --chat

# koi bhi checkpoint
!python notebooks/TRY_MODEL.py --checkpoint checkpoints/t4-full/step5800.pt
```

---

---

## Tarika B — notebook ke andar se (Python me, agar script nahi chalani)

```python
import sys; sys.path.insert(0, "/content/ankit-llm")
from training.mirror import newest_mirrored_checkpoint, restore_from_mirror
from pathlib import Path

mirror = Path("/content/drive/MyDrive/ankit-llm/checkpoints/t4-full")
ckpt = restore_from_mirror(mirror, "/content/ankit-llm/checkpoints/t4-full")
print("restored:", ckpt)

from inference.conversation import ChatEngine
eng = ChatEngine.from_checkpoint(str(ckpt), device="cuda")   # CPU par "cpu" likho
print("params:", eng.model.num_parameters())

conv = eng.new_conversation("adaptive")
print(eng.reply(conv, "भारत की राजधानी क्या है?", stream=True))
```

---

## Kuch galat ho to (troubleshooting)

| Jo dikha | Matlab | Kya karo |
|---|---|---|
| `koi checkpoint nahi mila` | Drive mount nahi hua ya galat account | Step 1 dobara; `DRIVE ACCOUNT` line dekho |
| `checkpoint nahi mila: <path>` | galat raasta diya | `--checkpoint` hatao, script khud dhundh lega |
| `ModuleNotFoundError: tokenizers` | pip step chhut gaya | `!pip install -q pyyaml tokenizers` |
| `No such file or directory: /content/ankit-llm` | Step 2 nahi chala | Step 2 dobara chalao |
| Bahut slow (CPU) | GPU nahi hai | `--max-new-tokens 20 --prompts 1` ya T4 on karo |
| `CUDA out of memory` | GPU par kuch aur chal raha hai | `--device cpu` (dheema par chalega) |
| Output ekdum tukde-tukde | model kam padha hai (expected) | 64,000 steps ka target poora karo |

---

## Yaad rakhne wali 3 baatein

1. **Testing se training ko koi farak nahi padta** — script sirf padhta hai; Drive par kuch
   nahi likhta (bas `reports/model_tryout.md` copy karta hai).
2. **Training chalti ho to usi waqt test kar sakte ho** — alag runtime me, ya chunk ke baad.
3. **Har chunk ke baad dobara test karo** — 5,800 → 11,400 → 17,000 steps, difference
   saaf dikhega. Wahi asli progress report hai.
