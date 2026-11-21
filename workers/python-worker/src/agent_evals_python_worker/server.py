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
    return {"ok": True, "worker": "python"}


@app.post("/run-trial", response_model=RunTrialResponse)
def run_trial_route(req: RunTrialRequest) -> RunTrialResponse:
    # Sync on purpose: FastAPI runs it in a worker thread, and Hermes's loop is blocking.
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
