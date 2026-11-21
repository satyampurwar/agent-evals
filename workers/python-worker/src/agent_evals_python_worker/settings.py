"""Worker settings. Read from the environment, then from the repo-root `.env` (the same file the Node side reads)."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# src/agent_evals_python_worker/settings.py -> repo root is four levels up from the package directory.
REPO_ROOT = Path(__file__).resolve().parents[4]
WORKER_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    openrouter_api_key: str | None = None
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Hermes keeps its own state (logs, sessions, skill sync) under this directory. It is never ~/.hermes.
    agent_evals_hermes_home: str = str(WORKER_DIR / ".hermes-home")


@lru_cache
def get_settings() -> Settings:
    return Settings()
