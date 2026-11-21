"""A scripted OpenAI-compatible chat endpoint for tests. Hermes streams by default, so this speaks SSE too."""

from __future__ import annotations

import json
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


@dataclass
class Step:
    """One model response. Give `content`, or `tool_calls`, or `status` for an error."""

    content: str | None = None
    tool_calls: list[tuple[str, str, dict[str, Any]]] | None = (
        None  # (call_id, name, arguments)
    )
    prompt_tokens: int = 100
    completion_tokens: int = 10
    delay_s: float = 0.0
    status: int = 200


@dataclass
class FakeOpenAI:
    steps: list[Step]
    requests: list[dict[str, Any]] = field(default_factory=list)
    _calls: int = 0
    _lock: threading.Lock = field(default_factory=threading.Lock)
    _server: ThreadingHTTPServer | None = None

    @property
    def base_url(self) -> str:
        assert self._server is not None
        host, port = self._server.server_address[:2]
        return f"http://{host}:{port}/v1"

    def next_step(self) -> Step:
        with self._lock:
            step = self.steps[min(self._calls, len(self.steps) - 1)]
            self._calls += 1
            return step

    def start(self) -> None:
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *_args: Any) -> None:
                pass

            def do_POST(self) -> None:
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                owner.requests.append({"path": self.path, "body": body})
                if not self.path.endswith("/chat/completions"):
                    self._send(
                        404, b'{"error":{"message":"not found"}}', "application/json"
                    )
                    return
                step = owner.next_step()
                if step.delay_s:
                    time.sleep(step.delay_s)
                if step.status != 200:
                    self._send(
                        step.status,
                        json.dumps({"error": {"message": "scripted failure"}}).encode(),
                        "application/json",
                    )
                    return
                usage = {
                    "prompt_tokens": step.prompt_tokens,
                    "completion_tokens": step.completion_tokens,
                    "total_tokens": step.prompt_tokens + step.completion_tokens,
                }
                if body.get("stream"):
                    self._send(200, _sse(body, step, usage), "text/event-stream")
                else:
                    self._send(
                        200,
                        json.dumps(_completion(body, step, usage)).encode(),
                        "application/json",
                    )

            def _send(self, status: int, data: bytes, ctype: str) -> None:
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

        self._server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self._server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.shutdown()
            self._server.server_close()


@contextmanager
def scripted(steps: list[Step]) -> Iterator[FakeOpenAI]:
    fake = FakeOpenAI(steps=steps)
    fake.start()
    try:
        yield fake
    finally:
        fake.stop()


def _tool_calls_payload(step: Step) -> list[dict[str, Any]]:
    return [
        {
            "id": call_id,
            "type": "function",
            "function": {"name": name, "arguments": json.dumps(args)},
        }
        for call_id, name, args in (step.tool_calls or [])
    ]


def _completion(
    body: dict[str, Any], step: Step, usage: dict[str, int]
) -> dict[str, Any]:
    message: dict[str, Any] = {"role": "assistant", "content": step.content}
    if step.tool_calls:
        message["tool_calls"] = _tool_calls_payload(step)
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": body.get("model"),
        "choices": [
            {
                "index": 0,
                "message": message,
                "finish_reason": "tool_calls" if step.tool_calls else "stop",
            }
        ],
        "usage": usage,
    }


def _sse(body: dict[str, Any], step: Step, usage: dict[str, int]) -> bytes:
    base = {
        "id": "chatcmpl-test",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": body.get("model"),
    }
    chunks: list[dict[str, Any]] = []
    if step.tool_calls:
        deltas = [
            {
                "index": i,
                "id": call["id"],
                "type": "function",
                "function": call["function"],
            }
            for i, call in enumerate(_tool_calls_payload(step))
        ]
        chunks.append(
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "tool_calls": deltas},
                        "finish_reason": None,
                    }
                ],
            }
        )
        chunks.append(
            {
                **base,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}],
            }
        )
    else:
        chunks.append(
            {
                **base,
                "choices": [
                    {
                        "index": 0,
                        "delta": {"role": "assistant", "content": step.content or ""},
                        "finish_reason": None,
                    }
                ],
            }
        )
        chunks.append(
            {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
        )
    chunks.append({**base, "choices": [], "usage": usage})
    return (
        "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
    ).encode()
