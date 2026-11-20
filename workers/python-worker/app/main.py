from fastapi import FastAPI

app = FastAPI(title="agent-evals-python-worker")

@app.get("/health")
def health():
    return {"ok": True, "worker": "python"}