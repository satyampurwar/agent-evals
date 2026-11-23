"""Run one eval trial by driving the Hermes Agent library (the "harness").

Called from FastAPI when HermesHarness POSTs /run-trial. Hermes owns the model
call and tool-calling loop; we own sandboxed tools (`tools.py`), per-trial
memory, budgets (steps / tokens / timeout), and converting the conversation into
domain-shaped trace events (`events.py`).

Process-wide state, and why it is safe:
- Hermes keeps one tool registry per process. We register our six tools once, under the same names the
  baseline uses, replacing Hermes's unsandboxed `read_file` and `write_file`.
- Each trial gets its own toolset (exactly its `toolIds`), so the model is offered only those tools.
- Hermes passes `task_id` to every tool handler. We key the sandbox and memory by trial id, so trials can
  run concurrently in one process.
- HERMES_HOME is pinned to one directory per worker process, never ~/.hermes.
- HERMES_SKIP_SSL_GUARD is set, because Hermes's CA-bundle preflight cannot run on truststore's SSL context.
"""

from __future__ import annotations

import hashlib
import json
import os
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .contract import RunTrialRequest, RunTrialResponse, StoppedReason, UsageOut
from .events import build_events
from .settings import Settings, get_settings
from .tools import TOOL_SPECS, TrialMemory, execute_tool

OPENROUTER_PROVIDER = "openrouter"
TOOLSET_PREFIX = "agent_evals"


class MissingApiKeyError(RuntimeError):
    pass


@dataclass
class TrialState:
    trial_id: str
    sandbox_dir: str
    tool_ids: frozenset[str]
    memory: TrialMemory


_TRIALS: dict[str, TrialState] = {}
_TRIALS_LOCK = threading.Lock()


@dataclass(frozen=True)
class _HermesApi:
    agent_class: Any
    create_custom_toolset: Any


_LOAD_LOCK = threading.Lock()
_HERMES: _HermesApi | None = None


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _trial_for(task_id: object) -> TrialState | None:
    with _TRIALS_LOCK:
        return _TRIALS.get(str(task_id)) if task_id is not None else None


def _make_handler(name: str):
    def handler(args: Any, **kwargs: Any) -> str:
        state = _trial_for(kwargs.get("task_id"))
        if state is None:
            return json.dumps(
                {"error": "no active agent-evals trial for this tool call"}
            )
        if name not in state.tool_ids:
            return json.dumps({"error": f"tool not available in this trial: {name}"})
        outcome = execute_tool(
            state.sandbox_dir,
            name,
            args if isinstance(args, dict) else {},
            state.memory,
        )
        return json.dumps(outcome.result)

    return handler


def _load_hermes(settings: Settings) -> _HermesApi:
    """Import Hermes once per process, pin its home, and register our tools over its built-ins."""
    global _HERMES
    with _LOAD_LOCK:
        if _HERMES is None:
            home = Path(settings.agent_evals_hermes_home)
            home.mkdir(parents=True, exist_ok=True)
            os.environ["HERMES_HOME"] = str(home)
            # Hermes probes the CA bundle by calling SSLContext.get_ca_certs(). server.py injects truststore
            # (system roots, needed behind corporate TLS), and truststore's context does not implement that call,
            # so the probe would fail on every trial. The real TLS path still uses the system roots, so skip the probe.
            os.environ["HERMES_SKIP_SSL_GUARD"] = "1"

            # Importing model_tools discovers every built-in tool first. Our registrations come after, so
            # `override=True` replaces Hermes's built-in read_file and write_file with the sandboxed ones.
            import model_tools  # noqa: F401
            from run_agent import AIAgent
            from tools.registry import registry
            from toolsets import create_custom_toolset

            for name, spec in TOOL_SPECS.items():
                registry.register(
                    name=name,
                    toolset=TOOLSET_PREFIX,
                    schema=spec,
                    handler=_make_handler(name),
                    description=spec["description"],
                    override=True,
                )
            _HERMES = _HermesApi(
                agent_class=AIAgent, create_custom_toolset=create_custom_toolset
            )
        return _HERMES


def _no_summary(_messages: list[Any], _api_call_count: int) -> str:
    return ""


def _toolset_for(hermes: _HermesApi, tool_ids: list[str]) -> str:
    """A toolset named for exactly these tools, so the model is offered those tools and nothing else."""
    digest = hashlib.sha256(",".join(sorted(tool_ids)).encode()).hexdigest()[:12]
    name = f"{TOOLSET_PREFIX}_{digest}"
    hermes.create_custom_toolset(
        name, "agent-evals trial tools", tools=sorted(tool_ids)
    )
    return name


def _last_assistant(messages: list[Any]) -> dict[str, Any] | None:
    for message in reversed(messages):
        if message.get("role") == "assistant":
            return message
    return None


def _stop_reason(
    result: dict[str, Any], *, timed_out: bool, token_stop: bool
) -> tuple[StoppedReason, str | None]:
    messages = result.get("messages") or []
    # Hermes can mark an interrupted turn as `completed` too, so the interrupt flag decides first.
    if result.get("interrupted"):
        if timed_out:
            return "timeout", None
        if token_stop:
            return "max_tokens", None
        return (
            "error",
            f"hermes was interrupted: {result.get('turn_exit_reason') or 'unknown'}",
        )
    if result.get("failed"):
        return "error", str(result.get("error") or "model call failed")
    last = _last_assistant(messages)
    # The loop ended on the step budget while the model still wanted tools.
    if last is not None and last.get("tool_calls"):
        return "max_steps", None
    if result.get("completed"):
        return "completed", None
    return (
        "error",
        f"hermes stopped without finishing: {result.get('turn_exit_reason') or 'unknown'}",
    )


def run_trial(
    req: RunTrialRequest, settings: Settings | None = None
) -> RunTrialResponse:
    """Execute one Hermes trial and return the contract response for Nest.

    Registers trial state, constructs AIAgent with the request's model/budgets/
    toolset, runs the blocking agent loop, maps the transcript to trace events,
    then clears trial state. Raises MissingApiKeyError / ValueError for the
    HTTP layer to turn into 500 / 400.
    """
    settings = settings or get_settings()
    if not settings.openrouter_api_key:
        raise MissingApiKeyError(
            "OPENROUTER_API_KEY is not set (add it to the repo-root .env)"
        )
    if not os.path.isdir(req.sandboxDir):
        raise ValueError(f"sandbox directory does not exist: {req.sandboxDir}")

    hermes = _load_hermes(settings)
    toolset = _toolset_for(hermes, req.toolIds)
    state = TrialState(
        trial_id=req.trialId,
        sandbox_dir=req.sandboxDir,
        tool_ids=frozenset(req.toolIds),
        memory=TrialMemory(req.memorySeed),
    )
    with _TRIALS_LOCK:
        if req.trialId in _TRIALS:
            raise RuntimeError(f"trial {req.trialId} is already running on this worker")
        _TRIALS[req.trialId] = state

    cfg = req.config
    step_started: dict[int, str] = {}
    tool_started: dict[str, str] = {}
    tool_done: dict[str, str] = {}
    token_stop = threading.Event()
    timed_out = threading.Event()
    overrides: dict[str, Any] = {"temperature": cfg.temperature}
    if cfg.topP is not None:
        overrides["top_p"] = cfg.topP

    holder: dict[str, Any] = {}

    def on_step(api_call_count: int, _prev_tools: Any) -> None:
        # Fires before each model call. Stop before the next call once the trial has spent its token budget.
        step_started[int(api_call_count)] = _now()
        agent = holder["agent"]
        if not token_stop.is_set() and agent.session_total_tokens > cfg.maxTokens:
            token_stop.set()
            agent.interrupt("trial token budget exhausted")

    def on_tool_start(tool_call_id: str, _name: str, _args: Any) -> None:
        tool_started[str(tool_call_id)] = _now()

    def on_tool_complete(
        tool_call_id: str, _name: str, _args: Any, _result: Any
    ) -> None:
        tool_done[str(tool_call_id)] = _now()

    try:
        agent = hermes.agent_class(
            model=cfg.modelId,
            base_url=settings.openrouter_base_url,
            api_key=settings.openrouter_api_key,
            provider=OPENROUTER_PROVIDER,
            enabled_toolsets=[toolset],
            skip_memory=True,  # Hermes's own MEMORY.md store stays off: the only memory is the trial's
            skip_context_files=True,
            quiet_mode=True,
            max_iterations=cfg.maxSteps,
            max_tokens=cfg.maxTokens,
            request_overrides=overrides,
            session_id=f"trial-{req.trialId}",
            save_trajectories=False,
            checkpoints_enabled=False,
            step_callback=on_step,
            tool_start_callback=on_tool_start,
            tool_complete_callback=on_tool_complete,
        )
        # Background reviews would make extra model calls the baseline never makes. Turn them off.
        agent._memory_nudge_interval = 0
        agent._skill_nudge_interval = 0
        # At the step budget Hermes asks the model for a summary with one more call. The baseline stops there,
        # so the budget must be a hard limit here too.
        agent._handle_max_iterations = _no_summary
        holder["agent"] = agent

        def expire() -> None:
            timed_out.set()
            agent.interrupt("trial timeout")

        timer = threading.Timer(cfg.timeoutMs / 1000, expire)
        timer.daemon = True
        started_at = _now()
        timer.start()
        try:
            result = agent.run_conversation(req.task.prompt, task_id=req.trialId)
        finally:
            timer.cancel()
    finally:
        with _TRIALS_LOCK:
            _TRIALS.pop(req.trialId, None)

    messages = result.get("messages") or []
    events = build_events(
        messages,
        started_at=started_at,
        step_started=step_started,
        tool_started=tool_started,
        tool_done=tool_done,
    )
    stop, error_message = _stop_reason(
        result, timed_out=timed_out.is_set(), token_stop=token_stop.is_set()
    )
    if stop == "error":
        events.append(
            {
                "ts": _now(),
                "type": "error",
                "message": error_message or "hermes stopped with an error",
                "code": "model_error" if result.get("failed") else "harness_error",
            }
        )
    # Same rule as the baseline: the answer is the content of the last model response. A trial cut short
    # (timeout, token budget, error) has no answer. Hermes writes a status line into the conversation when it
    # interrupts a call, and that line is not an answer.
    last = _last_assistant(messages)
    final_answer = (
        str(last.get("content") or "")
        if last is not None and stop in ("completed", "max_steps")
        else ""
    )

    return RunTrialResponse(
        finalAnswer=final_answer,
        stoppedReason=stop,
        events=events,
        usage=UsageOut(
            promptTokens=agent.session_prompt_tokens,
            completionTokens=agent.session_completion_tokens,
        ),
        stepCount=int(result.get("api_calls") or 0),
    )
