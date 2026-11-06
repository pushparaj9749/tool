"""ANKIT tokenizer: a byte-level BPE trained from scratch on the ANKIT corpus.

Why byte-level BPE:
  * Devanagari, Latin, digits and emoji are all representable at byte level, so
    there are no <unk> tokens for any input script (verified in tokenizer_tests).
  * Hinglish (Romanised Hindi) shares Latin bytes with English, so code-mixed
    text compresses reasonably without needing a separate vocabulary.
  * No dependency on any pretrained tokenizer or vocabulary: training starts
    from raw bytes and learns merges only from the ANKIT corpus.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Union

from tokenizers import Tokenizer, decoders, models, pre_tokenizers, processors, trainers
from tokenizers.processors import ByteLevel as ByteLevelProcessor

SPECIAL_TOKENS: List[str] = [
    "<pad>",
    "<unk>",
    "<bos>",
    "<eos>",
    "<|system|>",
    "<|user|>",
    "<|assistant|>",
    "<|end|>",
]

MODEL_FILE = "tokenizer.json"
CONFIG_FILE = "tokenizer_config.json"
VOCAB_FILE = "vocab.json"


class AnkitTokenizer:
    def __init__(self, tokenizer: Tokenizer, special_tokens: Sequence[str] = SPECIAL_TOKENS) -> None:
        self._tok = tokenizer
        self.special_tokens = list(special_tokens)

    # ---------------------------------------------------------------- load/save
    @classmethod
    def load(cls, directory: Union[str, Path]) -> "AnkitTokenizer":
        directory = Path(directory)
        cfg_path = directory / CONFIG_FILE
        cfg = json.loads(cfg_path.read_text(encoding="utf-8")) if cfg_path.exists() else {}
        tok = Tokenizer.from_file(str(directory / MODEL_FILE))
        return cls(tok, cfg.get("special_tokens", SPECIAL_TOKENS))

    def save(self, directory: Union[str, Path]) -> None:
        directory = Path(directory)
        directory.mkdir(parents=True, exist_ok=True)
        self._tok.save(str(directory / MODEL_FILE))
        cfg = {
            "tokenizer_type": "byte_level_bpe",
            "vocab_size": self.vocab_size,
            "special_tokens": self.special_tokens,
            "special_token_ids": self.special_token_ids(),
            "bos_token": "<bos>",
            "eos_token": "<eos>",
            "pad_token": "<pad>",
            "unk_token": "<unk>",
            "chat_template": CHAT_TEMPLATE_DOC,
        }
        (directory / CONFIG_FILE).write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    # ---------------------------------------------------------------- properties
    @property
    def vocab_size(self) -> int:
        return self._tok.get_vocab_size()

    def special_token_ids(self) -> Dict[str, int]:
        vocab = self._tok.get_vocab()
        return {t: vocab.get(t, -1) for t in self.special_tokens}

    def id(self, token: str) -> int:
        tid = self._tok.get_vocab().get(token)
        if tid is None:
            raise KeyError(f"special token {token!r} missing from vocabulary")
        return tid

    @property
    def pad_id(self) -> int:
        return self.id("<pad>")

    @property
    def bos_id(self) -> int:
        return self.id("<bos>")

    @property
    def eos_id(self) -> int:
        return self.id("<eos>")

    @property
    def end_turn_id(self) -> int:
        return self.id("<|end|>")

    @property
    def assistant_id(self) -> int:
        return self.id("<|assistant|>")

    @property
    def user_id(self) -> int:
        return self.id("<|user|>")

    @property
    def system_id(self) -> int:
        return self.id("<|system|>")

    # ---------------------------------------------------------------- encoding
    def encode(self, text: str, add_special_tokens: bool = True) -> List[int]:
        ids = self._tok.encode(text, add_special_tokens=False).ids
        if add_special_tokens:
            return [self.bos_id] + ids + [self.eos_id]
        return ids

    def encode_batch(self, texts: Iterable[str], add_special_tokens: bool = False) -> List[List[int]]:
        return [self.encode(t, add_special_tokens=add_special_tokens) for t in texts]

    def decode(self, ids: Sequence[int], skip_special_tokens: bool = True) -> str:
        return self._tok.decode(list(ids), skip_special_tokens=skip_special_tokens)

    # ---------------------------------------------------------------- chat format
    def render_chat(self, messages: Sequence[Dict[str, str]], add_generation_prompt: bool = True) -> str:
        """messages: [{'role': 'system'|'user'|'assistant', 'content': str}, ...]"""
        parts: List[str] = ["<bos>"]
        for m in messages:
            role = m["role"]
            content = (m.get("content") or "").strip()
            if role == "system":
                parts.append(f"<|system|>{content}<|end|>")
            elif role == "user":
                parts.append(f"<|user|>{content}<|end|>")
            elif role == "assistant":
                parts.append(f"<|assistant|>{content}<|end|>")
            else:
                raise ValueError(f"unknown role {role!r}")
        if add_generation_prompt:
            parts.append("<|assistant|>")
        return "".join(parts)

    def encode_chat(
        self,
        messages: Sequence[Dict[str, str]],
        add_generation_prompt: bool = True,
        add_special_tokens: bool = False,
    ) -> List[int]:
        text = self.render_chat(messages, add_generation_prompt=add_generation_prompt)
        ids = self._tok.encode(text, add_special_tokens=False).ids
        if add_special_tokens:
            return [self.bos_id] + ids
        return ids

    def encode_supervised(self, messages: Sequence[Dict[str, str]]) -> tuple[List[int], List[int]]:
        """Encode a conversation and return (ids, loss_mask).

        loss_mask is 1 on assistant content tokens (plus their <|end|>), 0 elsewhere,
        implementing instruction tuning with prompt masking.
        """
        full_text = self.render_chat(messages, add_generation_prompt=False)
        # render_chat starts with "<bos>"; it is a special token in the vocab
        ids: List[int] = [self.bos_id]
        mask: List[int] = [0]
        for m in messages:
            role = m["role"]
            body = (m.get("content") or "").strip()
            seg = f"<|{role}|>{body}<|end|>"
            if m["role"] == "assistant":
                seg_ids = self.encode(seg, add_special_tokens=False)
                ids.extend(seg_ids)
                # mask: opener token excluded, content + end token included
                opener = self.encode(f"<|{role}|>", add_special_tokens=False)
                mask.extend([0] * len(opener) + [1] * (len(seg_ids) - len(opener)))
            else:
                seg_ids = self.encode(seg, add_special_tokens=False)
                ids.extend(seg_ids)
                mask.extend([0] * len(seg_ids))
        # sanity: reconstruction must equal single-pass encode
        assert self.decode(ids, skip_special_tokens=False) == self.decode(
            self.encode(full_text, add_special_tokens=False), skip_special_tokens=False
        ), "segment-wise and single-pass encodings disagree"
        return ids, mask


CHAT_TEMPLATE_DOC = (
    "<bos><|system|>{system}<|end|><|user|>{user}<|end|>"
    "<|assistant|>{assistant}<|end|> ... <|assistant|>"
)


def train_tokenizer(
    corpus_path: Union[str, Path],
    out_dir: Union[str, Path],
    vocab_size: int = 32768,
    min_frequency: int = 2,
    max_token_length: int = 16,
    log_path: Optional[Union[str, Path]] = None,
) -> AnkitTokenizer:
    """Train a byte-level BPE from scratch on the plain-text corpus file."""
    corpus_path = Path(corpus_path)
    if not corpus_path.exists():
        raise FileNotFoundError(f"tokenizer corpus not found: {corpus_path}")

    tok = Tokenizer(models.BPE(unk_token="<unk>"))
    tok.pre_tokenizer = pre_tokenizers.ByteLevel(add_prefix_space=False)
    tok.decoder = decoders.ByteLevel()
    trainer = trainers.BpeTrainer(
        vocab_size=vocab_size,
        min_frequency=min_frequency,
        special_tokens=SPECIAL_TOKENS,
        max_token_length=max_token_length,
        initial_alphabet=pre_tokenizers.ByteLevel.alphabet(),  # all 256 bytes known
        show_progress=True,
    )
    print(f"[tokenizer] training byte-level BPE vocab={vocab_size} on {corpus_path}")
    tok.train(files=[str(corpus_path)], trainer=trainer)
    tok.post_processor = ByteLevelProcessor(trim_offsets=True)
    wrapper = AnkitTokenizer(tok)
    wrapper.save(out_dir)

    # vocabulary dump + training log
    out_dir = Path(out_dir)
    (out_dir / VOCAB_FILE).write_text(
        json.dumps(tok.get_vocab(), indent=0, ensure_ascii=False), encoding="utf-8"
    )
    if log_path:
        Path(log_path).parent.mkdir(parents=True, exist_ok=True)
        Path(log_path).write_text(
            json.dumps(
                {
                    "corpus": str(corpus_path),
                    "corpus_bytes": corpus_path.stat().st_size,
                    "requested_vocab_size": vocab_size,
                    "actual_vocab_size": wrapper.vocab_size,
                    "min_frequency": min_frequency,
                    "max_token_length": max_token_length,
                    "special_tokens": {t: wrapper.id(t) for t in SPECIAL_TOKENS},
                },
                indent=2,
                ensure_ascii=False,
            )
            + "\n",
            encoding="utf-8",
        )
    return wrapper
