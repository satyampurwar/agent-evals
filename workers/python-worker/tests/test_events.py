import json

from agent_evals_python_worker.events import build_events

T0 = "2026-01-01T00:00:00.000Z"


def assistant_with_call(call_id: str, name: str, args: dict, content: str = "") -> dict:
    return {
        "role": "assistant",
        "content": content,
        "tool_calls": [
            {
                "id": call_id,
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(args)},
            }
        ],
    }


def test_orders_events_like_the_baseline_harness():
    messages = [
        {"role": "user", "content": "Read notes.txt"},
        assistant_with_call("c1", "read_file", {"path": "notes.txt"}),
        {
            "role": "tool",
            "tool_call_id": "c1",
            "content": json.dumps({"path": "notes.txt", "content": "hi"}),
        },
        {"role": "assistant", "content": "42"},
    ]
    events = build_events(
        messages,
        started_at=T0,
        step_started={1: T0, 2: "2026-01-01T00:00:01.000Z"},
        tool_started={},
        tool_done={},
    )
    assert [e["type"] for e in events] == [
        "step_boundary",
        "message",
        "message",
        "tool_call",
        "tool_result",
        "step_boundary",
        "message",
    ]
    assert events[3] == {
        "ts": T0,
        "type": "tool_call",
        "name": "read_file",
        "args": {"path": "notes.txt"},
        "callId": "c1",
    }
    assert events[4]["ok"] is True and events[4]["result"] == {
        "path": "notes.txt",
        "content": "hi",
    }
    assert events[5]["step"] == 2 and events[5]["ts"] == "2026-01-01T00:00:01.000Z"


def test_derives_memory_and_skill_events_only_for_successful_calls():
    messages = [
        {"role": "user", "content": "q"},
        assistant_with_call("m1", "memory_read", {"query": "client id"}),
        {
            "role": "tool",
            "tool_call_id": "m1",
            "content": json.dumps(
                {
                    "query": "client id",
                    "hits": [{"key": "client_id", "value": "HL-2044"}],
                }
            ),
        },
        assistant_with_call("w1", "memory_write", {"key": "k", "value": "v"}),
        {"role": "tool", "tool_call_id": "w1", "content": json.dumps({"key": "k"})},
        assistant_with_call(
            "s1", "csv_summary", {"path": "missing.csv", "column": "a", "op": "sum"}
        ),
        {
            "role": "tool",
            "tool_call_id": "s1",
            "content": json.dumps({"error": "not found: missing.csv"}),
        },
    ]
    types = [
        e["type"]
        for e in build_events(
            messages, started_at=T0, step_started={}, tool_started={}, tool_done={}
        )
    ]
    assert "memory_read" in types and "memory_write" in types
    assert "skill_invoke" not in types  # the failed skill call emits no derived event
    assert types.count("tool_result") == 3


def test_failed_tool_result_is_marked_not_ok():
    messages = [
        {"role": "user", "content": "q"},
        assistant_with_call("x1", "write_file", {"path": "../a", "content": "x"}),
        {
            "role": "tool",
            "tool_call_id": "x1",
            "content": json.dumps({"error": "path escapes sandbox: ../a"}),
        },
    ]
    result = [
        e
        for e in build_events(
            messages, started_at=T0, step_started={}, tool_started={}, tool_done={}
        )
        if e["type"] == "tool_result"
    ]
    assert result[0]["ok"] is False and result[0]["result"] == {
        "error": "path escapes sandbox: ../a"
    }
