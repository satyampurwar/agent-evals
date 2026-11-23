# Python worker (Hermes)

Runs **Hermes Agent** for configs with `harness.id === "hermes"`. The Nest trial worker never imports Hermes; `HermesHarness` (TypeScript) POSTs each trial here.

| Piece | Role |
|---|---|
| `app/main.py` | Uvicorn entry (`app`) |
| `src/.../server.py` | FastAPI: `GET /health`, `POST /run-trial` |
| `hermes_runner.py` | Drive Hermes for one trial (budgets, toolset, events) |
| `tools.py` / `sandbox.py` | Sandboxed tools + path safety (shared `/sandboxes` with Node) |
| `contract.py` | Request/response shapes matching the TS client |

```bash
# Via Compose (recommended)
docker compose up python-worker

# Host dev
uv sync
uv run uvicorn app.main:app --reload --port 8001
uv run pytest -q
```

Needs `OPENROUTER_API_KEY` (same `.env` as the stack). Default port **8001**.
