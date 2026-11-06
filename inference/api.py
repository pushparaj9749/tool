"""Lightweight HTTP API for ANKIT LLM (stdlib only — no web framework needed).

Endpoints
  GET  /health             -> status, params, checkpoint, modes
  GET  /modes              -> personality prompts
  POST /chat               -> {"messages":[{role,content}...], "personality":"adaptive",
                              "temperature":0.8, "max_new_tokens":128}
  POST /chat/stream        -> text/plain streamed chunks (newline separated)

Run:
  python inference/api.py --checkpoint checkpoints/sft-v0.1/final.pt --port 8000
"""
from __future__ import annotations

import argparse
import json
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inference.conversation import MODES, ChatEngine  # noqa: E402

ENGINE: ChatEngine | None = None


class Handler(BaseHTTPRequestHandler):
    server_version = "AnkitLLM/0.1"

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.send_header("access-control-allow-origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("access-control-allow-origin", "*")
        self.send_header("access-control-allow-headers", "content-type")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/health", "/"):
            assert ENGINE is not None
            self._json(200, {
                "status": "ok",
                "model": "ankit-llm-v0.1",
                "params": ENGINE.model.num_parameters(),
                "modes": list(MODES),
                "max_seq_len": ENGINE.model.config.max_seq_len,
                "context_budget_tokens": ENGINE._budget(),
            })
        elif self.path == "/modes":
            assert ENGINE is not None
            self._json(200, {"modes": ENGINE.personalities})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        assert ENGINE is not None
        try:
            length = int(self.headers.get("content-length", "0"))
            body = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._json(400, {"error": "invalid JSON body"})
            return

        messages = body.get("messages")
        if not isinstance(messages, list) or not messages:
            self._json(400, {"error": "messages must be a non-empty list"})
            return
        mode = body.get("personality", "adaptive")
        if mode not in MODES:
            self._json(400, {"error": f"personality must be one of {list(MODES)}"})
            return
        try:
            ENGINE.gen_cfg.temperature = float(body.get("temperature", ENGINE.gen_cfg.temperature))
            ENGINE.gen_cfg.max_new_tokens = int(body.get("max_new_tokens", ENGINE.gen_cfg.max_new_tokens))
            if self.path == "/chat/stream":
                conv = ENGINE.new_conversation(mode)
                conv.history = [type("M", (), {"role": m["role"], "content": m["content"]})()
                                for m in messages[:-1]]
                user = messages[-1]["content"]
                conv.history.append(type("M", (), {"role": "user", "content": user})())
                msgs = conv.to_messages()
                prompt_ids = ENGINE.tok.encode_chat(msgs, add_generation_prompt=True)
                from inference.generate import Generator
                self.send_response(200)
                self.send_header("content-type", "text/plain; charset=utf-8")
                self.send_header("access-control-allow-origin", "*")
                self.end_headers()
                for chunk in Generator(ENGINE.model, ENGINE.tok, ENGINE.gen_cfg).stream_text(prompt_ids):
                    self.wfile.write(chunk.encode("utf-8"))
                    self.wfile.flush()
                return
            answer = ENGINE.chat_once(messages, mode=mode)
            self._json(200, {"response": answer, "personality": mode,
                             "params": ENGINE.model.num_parameters()})
        except Exception as exc:  # noqa: BLE001 - report, never crash the server
            self._json(500, {"error": f"{type(exc).__name__}: {exc}"})

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("[api] " + fmt % args + "\n")


def main() -> None:
    global ENGINE
    ap = argparse.ArgumentParser()
    ap.add_argument("--checkpoint", default="checkpoints/sft-v0.1/final.pt")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args()
    ENGINE = ChatEngine.from_checkpoint(args.checkpoint, device=args.device)
    print(f"[api] ANKIT LLM v0.1 loaded ({ENGINE.model.num_parameters():,} params) "
          f"on http://{args.host}:{args.port}")
    ThreadingHTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
