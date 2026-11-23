"""FastAPI HTTP surface for the Hermes worker (separate OS process from Nest/Node).

Architecture for newcomers:
  1. A trial config with harness.id == "hermes" makes the Node side use HermesHarness.
  2. HermesHarness HTTP-POSTs one RunTrialRequest to this app's /run-trial.
  3. We run Hermes Agent for that trial (see hermes_runner) and return RunTrialResponse
     (final answer, usage, step count, trace-shaped events).
  4. Graders and persistence stay on the TypeScript side — this worker only "acts".

Port default: 8001. Health: GET /health.
"""

import truststore
from fastapi import FastAPI, HTTPException

from .contract import RunTrialRequest, RunTrialResponse
from .hermes_runner import MissingApiKeyError, run_trial

# Use the OS trust store for every HTTPS call (Hermes, httpx, requests). This is the Python counterpart of
# `NODE_OPTIONS=--use-system-ca` on the Node side, and it lets the worker reach OpenRouter behind corporate TLS.
truststore.inject_into_ssl()

app = FastAPI(title="agent-evals-python-worker")


@app.get("/health")
def health() -> dict[str, object]:
    """Liveness probe for compose / local smoke checks."""
    return {"ok": True, "worker": "python"}


@app.post("/run-trial", response_model=RunTrialResponse)
def run_trial_route(req: RunTrialRequest) -> RunTrialResponse:
    """Run one Hermes trial for the JSON body Nest/HermesHarness sent.

    Sync on purpose: FastAPI runs it in a worker thread, and Hermes's loop is blocking.
    """
    try:
        return run_trial(req)
    except MissingApiKeyError as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
    except ValueError as err:
        raise HTTPException(status_code=400, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=500, detail=f"{type(err).__name__}: {err}"
        ) from err
