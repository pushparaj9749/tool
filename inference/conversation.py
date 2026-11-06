"""Conversation engine: multi-turn state, context-window management, personality
modes, and generation settings for ANKIT LLM.

Honest scope note: memory here is *the model context window only*. There is no
persistent long-term memory. When the history exceeds the window, the oldest
turns are dropped (optionally collapsed into a short summary line) — no silent
claims of recall beyond that.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional

import yaml

from inference.generate import GenerationConfig, Generator
from model.architecture import AnkitLM
from tokenizer.ankit_tokenizer import AnkitTokenizer

MODES = ("professional", "friendly", "adaptive")


@dataclass
class Message:
    role: str
    content: str


@dataclass
class Conversation:
    mode: str = "adaptive"
    system_prompt: str = ""
    history: List[Message] = field(default_factory=list)
    dropped_turns: int = 0

    def to_messages(self) -> List[Dict[str, str]]:
        msgs: List[Dict[str, str]] = []
        if self.system_prompt:
            msgs.append({"role": "system", "content": self.system_prompt})
        msgs.extend({"role": m.role, "content": m.content} for m in self.history)
        return msgs


class ChatEngine:
    def __init__(
        self,
        model: AnkitLM,
        tokenizer: AnkitTokenizer,
        generation_cfg: Optional[GenerationConfig] = None,
        personalities: Optional[Dict[str, dict]] = None,
        max_context_tokens: int = 384,
        reserve_for_generation: int = 128,
    ) -> None:
        self.model = model
        self.tok = tokenizer
        self.gen_cfg = generation_cfg or GenerationConfig()
        self.personalities = personalities or {}
        self.max_context_tokens = min(max_context_tokens, model.config.max_seq_len)
        self.reserve = reserve_for_generation

    # ------------------------------------------------------------ construction
    @classmethod
    def from_checkpoint(cls, checkpoint_path: str, generation_config: str = "configs/generation.yaml",
                        device: str = "cpu") -> "ChatEngine":
        from training.checkpoint import load_checkpoint
        from model.configuration import AnkitConfig

        payload = load_checkpoint(checkpoint_path, map_location=device, with_optimizer=False)
        model = AnkitLM(AnkitConfig.from_dict(payload["model_config"]))
        model.load_state_dict(payload["model"])
        model.to(device).eval()
        tokenizer = AnkitTokenizer.load("tokenizer/ankit_bpe")
        cfg_path = Path(generation_config)
        gen_raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))
        gen = GenerationConfig.from_dict(gen_raw)
        return cls(
            model, tokenizer, gen,
            personalities=gen_raw.get("personalities", {}),
            max_context_tokens=gen_raw.get("max_context_tokens", 384),
            reserve_for_generation=gen_raw.get("reserve_for_generation", 128),
        )

    # ------------------------------------------------------------ helpers
    def personality_prompt(self, mode: str) -> str:
        if mode not in MODES:
            raise ValueError(f"unknown personality {mode!r}; choose from {MODES}")
        entry = self.personalities.get(mode, {})
        marker = entry.get("marker", f"[MODE:{mode.upper()}]")
        system = entry.get("system", "You are ANKIT, a helpful assistant.")
        return f"{marker} {system}"

    def new_conversation(self, mode: str = "adaptive") -> Conversation:
        return Conversation(mode=mode, system_prompt=self.personality_prompt(mode))

    def _budget(self) -> int:
        return max(32, self.max_context_tokens - self.reserve)

    def _fit_history(self, conv: Conversation) -> List[Dict[str, str]]:
        """Drop oldest turns until the rendered prompt fits the context budget."""
        while True:
            msgs = conv.to_messages()
            if len(self.tok.encode_chat(msgs, add_generation_prompt=True)) <= self._budget():
                return msgs
            # drop the oldest non-system message pair
            if len(conv.history) <= 1:
                return msgs
            conv.history.pop(0)
            conv.dropped_turns += 1

    # ------------------------------------------------------------ chat
    def reply(self, conv: Conversation, user_text: str, mode: Optional[str] = None,
              stream: bool = False) -> str:
        if mode and mode != conv.mode:
            if conv.history:
                raise ValueError(
                    "refusing to switch personality mid-conversation; start a new conversation")
            conv.mode = mode
            conv.system_prompt = self.personality_prompt(mode)
        conv.history.append(Message("user", user_text))
        msgs = self._fit_history(conv)
        prompt_ids = self.tok.encode_chat(msgs, add_generation_prompt=True)
        gen = Generator(self.model, self.tok, self.gen_cfg)
        if stream:
            chunks = []
            for chunk in gen.stream_text(prompt_ids):
                chunks.append(chunk)
                print(chunk, end="", flush=True)
            print()
            answer = "".join(chunks).strip()
        else:
            answer = gen.generate(prompt_ids)
        conv.history.append(Message("assistant", answer))
        # keep the stored state inside the context budget, not just the prompt
        self._fit_history(conv)
        return answer

    def chat_once(self, messages: List[Dict[str, str]], mode: str = "adaptive") -> str:
        """Stateless single call used by the API and the evaluation suite."""
        conv = self.new_conversation(mode)
        conv.history = [Message(m["role"], m["content"]) for m in messages
                        if m["role"] in ("user", "assistant")]
        if not conv.history or conv.history[-1].role != "user":
            raise ValueError("last message must be from the user")
        last = conv.history.pop()
        return self.reply(conv, last.content)

    def batch_reply(self, prompts: List[str], mode: str = "adaptive") -> List[str]:
        out = []
        for p in prompts:
            out.append(self.chat_once([{"role": "user", "content": p}], mode=mode))
        return out
