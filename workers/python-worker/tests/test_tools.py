from pathlib import Path

from agent_evals_python_worker.tools import TrialMemory, execute_tool


def run(sandbox: Path, name: str, args: dict, memory: TrialMemory | None = None):
    return execute_tool(str(sandbox), name, args, memory or TrialMemory())


def test_write_then_read_round_trip(sandbox: Path):
    written = run(
        sandbox,
        "write_file",
        {"path": "dir/solution.js", "content": "module.exports = 1;"},
    )
    assert written.ok and written.result == {
        "path": "dir/solution.js",
        "bytes": len("module.exports = 1;"),
    }
    read = run(sandbox, "read_file", {"path": "dir/solution.js"})
    assert read.ok and read.result["content"] == "module.exports = 1;"


def test_missing_file_is_a_readable_tool_error(sandbox: Path):
    outcome = run(sandbox, "read_file", {"path": "missing.txt"})
    assert not outcome.ok
    assert outcome.result == {"error": "not found: missing.txt"}


def test_directory_read_and_escape_are_tool_errors(sandbox: Path):
    assert run(sandbox, "read_file", {"path": "."}).result == {
        "error": "is a directory: ."
    }
    escape = run(sandbox, "read_file", {"path": "/etc/passwd"})
    assert not escape.ok and "absolute paths are not allowed" in escape.result["error"]


def test_list_dir_sorts_and_types_entries(sandbox: Path):
    (sandbox / "z_dir").mkdir()
    listing = run(sandbox, "list_dir", {"path": "."})
    assert listing.ok
    assert listing.result["entries"] == [
        {"name": "notes.txt", "type": "file"},
        {"name": "z_dir", "type": "dir"},
    ]


def test_missing_argument_is_reported(sandbox: Path):
    outcome = run(sandbox, "write_file", {"path": "x.txt"})
    assert not outcome.ok
    assert outcome.result == {"error": "missing or invalid argument: content"}


def test_unknown_tool_is_reported(sandbox: Path):
    assert run(sandbox, "terminal", {}).result == {"error": "unknown tool: terminal"}


def test_memory_matches_words_across_key_and_value():
    memory = TrialMemory({"client_id": "HL-2044"})
    assert memory.read("client id") == [{"key": "client_id", "value": "HL-2044"}]
    assert memory.read("invoice") == []
    assert len(memory.read("")) == 1


def test_memory_write_overwrites_and_is_visible_to_reads(sandbox: Path):
    memory = TrialMemory()
    assert run(sandbox, "memory_write", {"key": "color", "value": "blue"}, memory).ok
    assert run(sandbox, "memory_write", {"key": "color", "value": "green"}, memory).ok
    hits = run(sandbox, "memory_read", {"query": "color"}, memory).result["hits"]
    assert hits == [{"key": "color", "value": "green"}]


def write_csv(sandbox: Path, text: str) -> None:
    (sandbox / "data.csv").write_text(text, encoding="utf-8")


def test_csv_summary_aggregates(sandbox: Path):
    write_csv(sandbox, "team,amount\nalpha,10\nbeta,20\nalpha,30\n")
    total = run(
        sandbox, "csv_summary", {"path": "data.csv", "column": "amount", "op": "sum"}
    )
    assert total.ok and total.result["value"] == 60 and total.result["rows"] == 3
    mean = run(
        sandbox, "csv_summary", {"path": "data.csv", "column": "amount", "op": "mean"}
    )
    assert mean.result["value"] == 20


def test_csv_summary_filters_with_where(sandbox: Path):
    write_csv(sandbox, "team,amount\nalpha,10\nbeta,20\nalpha,30\n")
    outcome = run(
        sandbox,
        "csv_summary",
        {
            "path": "data.csv",
            "column": "amount",
            "op": "max",
            "where": [{"column": "team", "equals": "alpha"}],
        },
    )
    assert outcome.ok and outcome.result["value"] == 30 and outcome.result["rows"] == 2


def test_csv_summary_count_and_errors(sandbox: Path):
    write_csv(sandbox, "team,amount\nalpha,x\n")
    assert (
        run(
            sandbox,
            "csv_summary",
            {"path": "data.csv", "column": "team", "op": "count"},
        ).result["value"]
        == 1
    )
    bad = run(
        sandbox, "csv_summary", {"path": "data.csv", "column": "amount", "op": "sum"}
    )
    assert not bad.ok and 'non-numeric value: "x"' in bad.result["error"]
    unknown = run(
        sandbox, "csv_summary", {"path": "data.csv", "column": "nope", "op": "sum"}
    )
    assert "no column named" in unknown.result["error"]
    no_rows = run(
        sandbox,
        "csv_summary",
        {
            "path": "data.csv",
            "column": "amount",
            "op": "sum",
            "where": [{"column": "team", "equals": "zeta"}],
        },
    )
    assert no_rows.result == {"error": "no rows matched the filter"}
