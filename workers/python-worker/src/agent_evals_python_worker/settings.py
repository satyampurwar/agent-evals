"""Environment settings for the Hermes worker (API key, OpenRouter URL, HERMES_HOME).

Loaded via pydantic-settings from process env, falling back to the repo-root
`.env` (same file Node scripts use). Inside Docker, compose injects env vars
directly — the path to `.env` may not exist, which is fine.
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# src/agent_evals_python_worker/settings.py -> the worker directory is two levels up from the package's src/.
# In the repo that is workers/python-worker. In the container it is /app.
WORKER_DIR = Path(__file__).resolve().parents[2]
# The repo root is two levels above the worker directory. In the container that resolves to "/", where no .env
# exists; compose passes the settings as environment variables instead.
REPO_ROOT = WORKER_DIR.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Hermes keeps its own state (logs, sessions, skill sync) under this directory. It is never ~/.hermes.
    agent_evals_hermes_home: str = str(WORKER_DIR / ".hermes-home")


@lru_cache
def get_settings() -> Settings:
    return Settings()
