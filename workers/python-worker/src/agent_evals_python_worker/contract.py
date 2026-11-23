"""Pydantic request/response models for POST /run-trial.

This is the shared HTTP contract between TypeScript HermesHarness
(`packages/adapters-harness/src/hermes.ts`) and this Python worker. Field names
are camelCase on purpose so both sides serialize the same JSON without renaming.

A "trial" here is one task run: prompt + budgets + allowed tools + sandbox path.
The worker returns the agent's final answer, stop reason, token usage, and a list
of trace events the Node side validates against domain TraceEventSchema.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

KNOWN_TOOL_IDS = (
    "write_file",
    "read_file",
    "list_dir",
    "memory_read",
    "memory_write",
    "csv_summary",
)

StoppedReason = Literal["completed", "max_steps", "max_tokens", "timeout", "error"]


class TaskIn(BaseModel):
    id: str
    prompt: str


class RunConfig(BaseModel):
    modelId: str
    temperature: float = Field(ge=0, le=2)
    topP: float | None = Field(default=None, ge=0, le=1)
    maxSteps: int = Field(ge=1)
    maxTokens: int = Field(ge=1)
    timeoutMs: int = Field(ge=1)


class RunTrialRequest(BaseModel):
    trialId: str
    task: TaskIn
    config: RunConfig
    # Tool ids this trial may use, already intersected with the task's toolsAllowed by the caller.
    toolIds: list[str]
    # Facts the trial's memory starts with (`task.setup.memory`). Reachable only if a memory tool is in toolIds.
    memorySeed: dict[str, str] = Field(default_factory=dict)
    sandboxDir: str
    seed: int

    @field_validator("toolIds")
    @classmethod
    def known_tools_only(cls, value: list[str]) -> list[str]:
        unknown = [t for t in value if t not in KNOWN_TOOL_IDS]
        if unknown:
            raise ValueError(f"unknown tool ids: {', '.join(unknown)}")
        return value


class UsageOut(BaseModel):
    promptTokens: int
    completionTokens: int


class RunTrialResponse(BaseModel):
    finalAnswer: str
    stoppedReason: StoppedReason
    # Trace events in the shape of domain TraceEventSchema. The Node side validates each one.
    events: list[dict]
    usage: UsageOut
    stepCount: int
