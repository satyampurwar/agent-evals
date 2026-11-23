"""agent-evals Hermes worker package (FastAPI + hermes-agent).

Installed as the `agent_evals_python_worker` Python package under
`workers/python-worker`. The HTTP entry is `server.app` (re-exported from
`app.main` for uvicorn). This `__init__` is not the process entrypoint.
"""


def main() -> None:
    """Placeholder console entry from `uv init`; prefer uvicorn on `app.main:app`."""
    print("Hello from agent-evals-python-worker!")
