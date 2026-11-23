"""Sandboxed tools Hermes may call during a trial (files, memory, csv_summary skill).

Ported from `packages/adapters-harness/src/{tools,skills,memory}.ts` so a task
behaves the same under the TypeScript baseline harness and this Hermes worker:
same tool names, JSON schemas, success payloads, and error strings. Only the
outer tool-calling loop (Hermes vs baseline) differs.
"""

from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass
from typing import Any

from .sandbox import SandboxPathError, resolve_in_sandbox

CORE_TOOL_NAMES = ("write_file", "read_file", "list_dir")
MEMORY_TOOL_NAMES = ("memory_read", "memory_write")
CSV_OPS = ("sum", "mean", "min", "max", "count")
SKILL_TOOLS: dict[str, tuple[str, ...]] = {"csv_summary": ("csv_summary",)}
SKILL_TOOL_NAMES = tuple(name for names in SKILL_TOOLS.values() for name in names)
ALL_TOOL_NAMES = CORE_TOOL_NAMES + MEMORY_TOOL_NAMES + SKILL_TOOL_NAMES

TOOL_SPECS: dict[str, dict[str, Any]] = {
    "memory_read": {
        "name": "memory_read",
        "description": 'Search the memory store. Returns every entry whose key or value contains all the words in the query. Use "" to list everything.',
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": 'Words to look for, e.g. "client id"',
                }
            },
            "required": ["query"],
        },
    },
    "memory_write": {
        "name": "memory_write",
        "description": "Store a text value under a key in the memory store. Overwrites an existing key.",
        "parameters": {
            "type": "object",
            "properties": {
                "key": {
                    "type": "string",
                    "description": 'Short identifier, e.g. "client_id"',
                },
                "value": {"type": "string", "description": "Text to remember"},
            },
            "required": ["key", "value"],
        },
    },
    "csv_summary": {
        "name": "csv_summary",
        "description": "Compute one aggregate over a numeric column of a CSV file in the sandbox (header row required). Optional filter keeps only rows where one column equals a value. Returns the exact result.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to the CSV file",
                },
                "column": {
                    "type": "string",
                    "description": "Numeric column to aggregate",
                },
                "op": {
                    "type": "string",
                    "enum": list(CSV_OPS),
                    "description": "Aggregate to compute",
                },
                "where": {
                    "type": "array",
                    "description": "Optional filters. A row is kept only if every condition matches (AND)",
                    "items": {
                        "type": "object",
                        "properties": {
                            "column": {"type": "string"},
                            "equals": {"type": "string"},
                        },
                        "required": ["column", "equals"],
                    },
                },
            },
            "required": ["path", "column", "op"],
        },
    },
    "write_file": {
        "name": "write_file",
        "description": "Write UTF-8 text to a file in the sandbox. Creates parent directories and overwrites existing files.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path inside the sandbox",
                },
                "content": {"type": "string", "description": "Full file contents"},
            },
            "required": ["path", "content"],
        },
    },
    "read_file": {
        "name": "read_file",
        "description": "Read a UTF-8 text file from the sandbox.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path inside the sandbox",
                }
            },
            "required": ["path"],
        },
    },
    "list_dir": {
        "name": "list_dir",
        "description": 'List entries of a directory in the sandbox. Use "." for the sandbox root.',
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative directory path"}
            },
            "required": ["path"],
        },
    },
}


# --- memory -----------------------------------------------------------------------------------------------

_NON_WORD = re.compile(r"[^a-z0-9]+")


def _tokens(text: str) -> list[str]:
    """Lowercased word tokens. "client id" and "client_id" both give ["client", "id"]."""
    return [t for t in _NON_WORD.split(text.lower()) if t]


class TrialMemory:
    """Per-trial key-value memory, seeded from the task. Discarded with the trial."""

    def __init__(self, seed: dict[str, str] | None = None) -> None:
        self._entries: dict[str, str] = dict(seed or {})

    def read(self, query: str) -> list[dict[str, str]]:
        wanted = _tokens(query)
        hits = []
        for key, value in self._entries.items():
            haystack = _tokens(f"{key} {value}")
            if all(w in haystack for w in wanted):
                hits.append({"key": key, "value": value})
        return hits

    def write(self, key: str, value: str) -> None:
        self._entries[key] = value


# --- csv_summary ------------------------------------------------------------------------------------------


def csv_summary(sandbox_dir: str, args: dict[str, Any]) -> dict[str, Any]:
    """Aggregate one numeric column of a CSV in the sandbox. Expects a header row and no quoted fields."""
    op = args["op"]
    if op not in CSV_OPS:
        raise ValueError(f"op must be one of {', '.join(CSV_OPS)}")
    abs_path = resolve_in_sandbox(sandbox_dir, args["path"])
    with open(abs_path, encoding="utf-8") as fh:
        text = fh.read()
    lines = [line for line in re.split(r"\r?\n", text) if line.strip()]
    if len(lines) < 2:
        raise ValueError("csv needs a header row and at least one data row")

    header = [h.strip() for h in lines[0].split(",")]

    def index_of(name: str) -> int:
        if name not in header:
            raise ValueError(f'no column named "{name}" (columns: {", ".join(header)})')
        return header.index(name)

    value_index = index_of(args["column"])
    conditions = [
        (index_of(c["column"]), c["equals"]) for c in (args.get("where") or [])
    ]

    values: list[float] = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(",")]
        if not all(i < len(cells) and cells[i] == equals for i, equals in conditions):
            continue
        if op == "count":
            values.append(0.0)
            continue
        raw = cells[value_index] if value_index < len(cells) else ""
        number = _to_number(raw)
        if raw == "" or not math.isfinite(number):
            raise ValueError(
                f'column "{args["column"]}" has a non-numeric value: {json.dumps(raw)}'
            )
        values.append(number)

    rows = len(values)
    if op == "count":
        value: float = rows
    elif rows == 0:
        raise ValueError("no rows matched the filter")
    elif op == "sum":
        value = sum(values)
    elif op == "mean":
        value = sum(values) / rows
    elif op == "min":
        value = min(values)
    else:
        value = max(values)

    return {
        "path": args["path"],
        "column": args["column"],
        "op": op,
        "rows": rows,
        "value": value,
    }


def _to_number(raw: str) -> float:
    try:
        return float(raw)
    except ValueError:
        return math.nan


# --- dispatch ---------------------------------------------------------------------------------------------


@dataclass(frozen=True)
class ToolOutcome:
    ok: bool
    result: Any


def _require_str(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str):
        raise TypeError(f"missing or invalid argument: {key}")
    return value


def _describe_error(err: Exception, path: str | None) -> str:
    if isinstance(err, FileNotFoundError):
        return f"not found: {path or 'path'}"
    if isinstance(err, IsADirectoryError):
        return f"is a directory: {path or 'path'}"
    if isinstance(err, NotADirectoryError):
        return f"not a directory: {path or 'path'}"
    if isinstance(err, SandboxPathError):
        return str(err)
    return str(err) or type(err).__name__


def execute_tool(
    sandbox_dir: str, name: str, args: dict[str, Any], memory: TrialMemory
) -> ToolOutcome:
    """Run one tool call. Never raises: failures come back as `ok=False` with `{"error": ...}`."""
    path: str | None = None
    try:
        if name == "memory_read":
            query = _require_str(args, "query")
            return ToolOutcome(True, {"query": query, "hits": memory.read(query)})
        if name == "memory_write":
            key = _require_str(args, "key")
            value = _require_str(args, "value")
            memory.write(key, value)
            return ToolOutcome(True, {"key": key})
        if name == "csv_summary":
            path = _require_str(args, "path")
            _require_str(args, "column")
            _require_str(args, "op")
            where = args.get("where")
            if where is not None and (
                not isinstance(where, list)
                or any(
                    not isinstance(c, dict)
                    or not isinstance(c.get("column"), str)
                    or not isinstance(c.get("equals"), str)
                    for c in where
                )
            ):
                raise ValueError(
                    "where must be a list of {column: string, equals: string}"
                )
            return ToolOutcome(True, csv_summary(sandbox_dir, {**args, "path": path}))
        if name == "write_file":
            path = _require_str(args, "path")
            content = _require_str(args, "content")
            abs_path = resolve_in_sandbox(sandbox_dir, path)
            os.makedirs(os.path.dirname(abs_path), exist_ok=True)
            with open(abs_path, "w", encoding="utf-8") as fh:
                fh.write(content)
            return ToolOutcome(
                True, {"path": path, "bytes": len(content.encode("utf-8"))}
            )
        if name == "read_file":
            path = _require_str(args, "path")
            abs_path = resolve_in_sandbox(sandbox_dir, path)
            with open(abs_path, encoding="utf-8") as fh:
                return ToolOutcome(True, {"path": path, "content": fh.read()})
        if name == "list_dir":
            path = _require_str(args, "path")
            abs_path = resolve_in_sandbox(sandbox_dir, path)
            listing = []
            with os.scandir(abs_path) as it:
                for entry in it:
                    kind = (
                        "dir"
                        if entry.is_dir(follow_symlinks=False)
                        else "file"
                        if entry.is_file(follow_symlinks=False)
                        else "other"
                    )
                    listing.append({"name": entry.name, "type": kind})
            listing.sort(key=lambda e: (e["name"].lower(), e["name"]))
            return ToolOutcome(True, {"path": path, "entries": listing})
        return ToolOutcome(False, {"error": f"unknown tool: {name}"})
    except Exception as err:  # noqa: BLE001 - every failure goes back to the model as a tool error
        return ToolOutcome(False, {"error": _describe_error(err, path)})
