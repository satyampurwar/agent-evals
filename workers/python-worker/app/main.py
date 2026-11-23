"""Uvicorn entry module for the Hermes Python worker.

This file only re-exports `app` from `agent_evals_python_worker.server`. The real
FastAPI routes live there. Start with:

    npm run dev:worker:python
    # or: uv run uvicorn app.main:app --reload --port 8001

The TypeScript `HermesHarness` POSTs each trial to this process at /run-trial —
the Nest API / Node queue worker never imports Hermes directly.
"""

from agent_evals_python_worker.server import app

# uvicorn target: `uv run uvicorn app.main:app --port 8001` (see `npm run dev:worker:python`).
__all__ = ["app"]
