"""End-to-end trials: the real Hermes loop, against a scripted OpenAI-compatible endpoint (no network)."""

import time
from pathlib import Path
from uuid import uuid4

import pytest
from fake_openai import Step, scripted
from pydantic import ValidationError

from agent_evals_python_worker.contract import RunConfig, RunTrialRequest, TaskIn
from agent_evals_python_worker.hermes_runner import MissingApiKeyError, run_trial
from agent_evals_python_worker.settings import Settings


def request(
    sandbox: Path,
    *,
    tool_ids: list[str],
    max_steps: int = 6,
    max_tokens: int = 4000,
    timeout_ms: int = 60_000,
    memory: dict[str, str] | None = None,
) -> RunTrialRequest:
    return RunTrialRequest(
        trialId=f"trial-{uuid4().hex[:10]}",
        task=TaskIn(
            id="t", prompt="Read notes.txt, then answer with the text you find."
        ),
        config=RunConfig(
            modelId="openai/gpt-4.1-mini",
            temperature=0.3,
            maxSteps=max_steps,
            maxTokens=max_tokens,
            timeoutMs=timeout_ms,
        ),
        toolIds=tool_ids,
        memorySeed=memory or {},
        sandboxDir=str(sandbox),
        seed=1,
    )


def chat_requests(fake) -> list[dict]:
    return [r["body"] for r in fake.requests if r["path"].endswith("/chat/completions")]


def test_completes_a_tool_loop_and_emits_baseline_shaped_events(sandbox, settings_for):
    steps = [
        Step(
            tool_calls=[("call_1", "read_file", {"path": "notes.txt"})],
            prompt_tokens=100,
            completion_tokens=10,
        ),
        Step(content="hello from sandbox", prompt_tokens=100, completion_tokens=10),
    ]
    with scripted(steps) as fake:
        res = run_trial(request(sandbox, tool_ids=["read_file"]), settings_for(fake))

    assert res.stoppedReason == "completed"
    assert res.finalAnswer == "hello from sandbox"
    assert res.stepCount == 2
    assert (res.usage.promptTokens, res.usage.completionTokens) == (200, 20)
    assert [e["type"] for e in res.events] == [
        "step_boundary",
        "message",
        "message",
        "tool_call",
        "tool_result",
        "step_boundary",
        "message",
    ]
    call = next(e for e in res.events if e["type"] == "tool_call")
    assert (
        call["name"] == "read_file"
        and call["args"] == {"path": "notes.txt"}
        and call["callId"] == "call_1"
    )
    result = next(e for e in res.events if e["type"] == "tool_result")
    assert result["ok"] is True and result["result"]["content"] == "hello from sandbox"
    assert all(e["ts"].endswith("Z") for e in res.events)

    # The model was offered exactly the trial's tools, with the configured temperature and completion cap.
    first = chat_requests(fake)[0]
    assert [t["function"]["name"] for t in first["tools"]] == ["read_file"]
    assert first["temperature"] == 0.3
    assert first["max_completion_tokens"] == 4000


def test_refuses_a_tool_outside_the_trial(sandbox, settings_for):
    steps = [
        Step(
            tool_calls=[
                ("call_1", "write_file", {"path": "escaped.txt", "content": "x"})
            ]
        ),
        Step(content="done"),
    ]
    with scripted(steps) as fake:
        res = run_trial(request(sandbox, tool_ids=["read_file"]), settings_for(fake))

    assert not (sandbox / "escaped.txt").exists()
    result = next(e for e in res.events if e["type"] == "tool_result")
    assert result["ok"] is False


def test_memory_is_seeded_from_the_task_and_searchable(sandbox, settings_for):
    steps = [
        Step(tool_calls=[("mem_1", "memory_read", {"query": "client id"})]),
        Step(content="HL-2044"),
    ]
    with scripted(steps) as fake:
        res = run_trial(
            request(
                sandbox,
                tool_ids=["memory_read", "memory_write"],
                memory={"client_id": "HL-2044"},
            ),
            settings_for(fake),
        )

    assert res.finalAnswer == "HL-2044"
    event = next(e for e in res.events if e["type"] == "memory_read")
    assert event["query"] == "client id"
    assert event["hits"] == [{"key": "client_id", "value": "HL-2044"}]


def test_memory_written_in_one_trial_is_not_visible_in_the_next(sandbox, settings_for):
    write_steps = [
        Step(tool_calls=[("w1", "memory_write", {"key": "secret", "value": "blue"})]),
        Step(content="stored"),
    ]
    read_steps = [
        Step(tool_calls=[("r1", "memory_read", {"query": "secret"})]),
        Step(content="nothing"),
    ]
    with scripted(write_steps) as fake:
        run_trial(
            request(sandbox, tool_ids=["memory_read", "memory_write"]),
            settings_for(fake),
        )
    with scripted(read_steps) as fake:
        res = run_trial(
            request(sandbox, tool_ids=["memory_read", "memory_write"]),
            settings_for(fake),
        )

    event = next(e for e in res.events if e["type"] == "memory_read")
    assert event["hits"] == []


def test_stops_at_the_step_budget(sandbox, settings_for):
    steps = [
        Step(tool_calls=[("c", "list_dir", {"path": "."})])
    ]  # the last step repeats
    with scripted(steps) as fake:
        res = run_trial(
            request(sandbox, tool_ids=["list_dir"], max_steps=2), settings_for(fake)
        )

    assert res.stoppedReason == "max_steps"
    assert res.stepCount == 2
    assert len(chat_requests(fake)) == 2  # no extra call past the budget


def test_stops_once_the_token_budget_is_spent(sandbox, settings_for):
    steps = [
        Step(
            tool_calls=[("c1", "list_dir", {"path": "."})],
            prompt_tokens=400,
            completion_tokens=200,
        ),
        Step(content="too late", prompt_tokens=400, completion_tokens=200),
    ]
    with scripted(steps) as fake:
        res = run_trial(
            request(sandbox, tool_ids=["list_dir"], max_tokens=500), settings_for(fake)
        )

    assert res.stoppedReason == "max_tokens"
    assert res.finalAnswer == ""
    assert res.usage.promptTokens == 400  # only the first response was counted


def test_a_slow_model_call_times_out(sandbox, settings_for):
    steps = [Step(content="slow answer", delay_s=5)]
    started = time.monotonic()
    with scripted(steps) as fake:
        res = run_trial(
            request(sandbox, tool_ids=["read_file"], timeout_ms=500), settings_for(fake)
        )

    assert res.stoppedReason == "timeout"
    assert time.monotonic() - started < 4


def test_a_rejected_model_call_is_an_error_not_an_answer(sandbox, settings_for):
    steps = [Step(status=400)]
    with scripted(steps) as fake:
        res = run_trial(request(sandbox, tool_ids=["read_file"]), settings_for(fake))

    assert res.stoppedReason == "error"
    assert res.finalAnswer == ""
    error = next(e for e in res.events if e["type"] == "error")
    assert error["code"] == "model_error"


def test_missing_api_key_is_reported_before_any_work(sandbox, settings_for):
    settings = Settings(
        _env_file=None,
        openrouter_api_key=None,
        agent_evals_hermes_home="/tmp/unused-home",
    )
    with pytest.raises(MissingApiKeyError):
        run_trial(request(sandbox, tool_ids=["read_file"]), settings)


def test_unknown_tool_ids_fail_validation(sandbox):
    with pytest.raises(ValidationError):
        request(sandbox, tool_ids=["terminal"])
