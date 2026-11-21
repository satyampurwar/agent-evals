import os
import tempfile
from pathlib import Path

import pytest
from fake_openai import FakeOpenAI

# Pin Hermes's home before any test imports the runner. Tests never touch the real ~/.hermes.
_HOME = tempfile.mkdtemp(prefix="agent-evals-hermes-test-")
os.environ["AGENT_EVALS_HERMES_HOME"] = _HOME


@pytest.fixture
def sandbox(tmp_path: Path) -> Path:
    root = tmp_path / "sandbox"
    root.mkdir()
    (root / "notes.txt").write_text("hello from sandbox", encoding="utf-8")
    return root


@pytest.fixture
def settings_for():
    """Settings that point Hermes at a fake endpoint instead of OpenRouter."""
    from agent_evals_python_worker.settings import Settings

    def make(fake: FakeOpenAI) -> Settings:
        return Settings(
            openrouter_api_key="sk-test",
            openrouter_base_url=fake.base_url,
            agent_evals_hermes_home=_HOME,
        )

    return make
