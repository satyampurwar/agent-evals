from agent_evals_python_worker.server import app

# uvicorn target: `uv run uvicorn app.main:app --port 8001` (see `npm run dev:worker:python`).
__all__ = ["app"]
