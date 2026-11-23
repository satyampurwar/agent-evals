"""Convert a finished Hermes message list into domain-shaped TraceEvent dicts.

The Nest/runner side expects the same event types the baseline harness emits
(message, tool_call, tool_result, memory_*, skill_invoke, step_boundary, …).
Message order is authoritative; callback maps supply timestamps for each step/tool.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from .tools import SKILL_TOOL_NAMES


def _parse_json(raw: Any) -> Any:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw
    return raw


def build_events(
    messages: list[Mapping[str, Any]],
    *,
    started_at: str,
    step_started: Mapping[int, str],
    tool_started: Mapping[str, str],
    tool_done: Mapping[str, str],
) -> list[dict[str, Any]]:
    """Events in the order the baseline harness emits them.

    Per model call k: `step_boundary` (for k > 1), the assistant message, then each tool call with its
    result and any derived event (memory_read, memory_write, skill_invoke) for calls that succeeded.
    """
    events: list[dict[str, Any]] = []
    call_args: dict[str, Any] = {}
    call_names: dict[str, str] = {}
    step = 0

    events.append({"ts": started_at, "type": "step_boundary", "step": 1})
    for message in messages:
        role = message.get("role")

        if role == "user":
            events.append(
                {
                    "ts": started_at,
                    "type": "message",
                    "role": "user",
                    "content": str(message.get("content") or ""),
                }
            )

        elif role == "assistant":
            step += 1
            ts = step_started.get(step, started_at)
            if step > 1:
                events.append({"ts": ts, "type": "step_boundary", "step": step})
            events.append(
                {
                    "ts": ts,
                    "type": "message",
                    "role": "assistant",
                    "content": str(message.get("content") or ""),
                }
            )
            for call in message.get("tool_calls") or []:
                call_id = str(call.get("id") or call.get("call_id") or "")
                function = call.get("function") or {}
                name = str(function.get("name") or "")
                args = _parse_json(function.get("arguments"))
                if not isinstance(args, dict):
                    args = {} if args in (None, "") else {"raw": args}
                call_args[call_id] = args
                call_names[call_id] = name
                events.append(
                    {
                        "ts": tool_started.get(call_id, ts),
                        "type": "tool_call",
                        "name": name,
                        "args": args,
                        "callId": call_id,
                    }
                )

        elif role == "tool":
            call_id = str(message.get("tool_call_id") or "")
            name = call_names.get(call_id, str(message.get("name") or ""))
            args = call_args.get(call_id, {})
            result = _parse_json(message.get("content"))
            ok = not (isinstance(result, dict) and "error" in result)
            ts = tool_done.get(call_id, started_at)
            events.append(
                {
                    "ts": ts,
                    "type": "tool_result",
                    "callId": call_id,
                    "ok": ok,
                    "result": result,
                }
            )
            if not ok:
                continue
            if name == "memory_read":
                hits = result.get("hits", []) if isinstance(result, dict) else []
                events.append(
                    {
                        "ts": ts,
                        "type": "memory_read",
                        "query": str(args.get("query", "")),
                        "hits": hits,
                    }
                )
            elif name == "memory_write":
                events.append(
                    {
                        "ts": ts,
                        "type": "memory_write",
                        "key": str(args.get("key", "")),
                        "value": args.get("value"),
                    }
                )
            elif name in SKILL_TOOL_NAMES:
                events.append(
                    {"ts": ts, "type": "skill_invoke", "skillId": name, "input": args}
                )

    return events
