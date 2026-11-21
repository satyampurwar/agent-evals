"""Regression: the worker injects truststore (system roots), which breaks Hermes's CA-bundle probe.

The injection replaces `ssl.SSLContext` process-wide, so it runs in a subprocess and never leaks into other tests.
"""

import os
import subprocess
import sys
import textwrap

CHILD = textwrap.dedent(
    """
    import truststore
    truststore.inject_into_ssl()

    from agent_evals_python_worker import hermes_runner
    from agent_evals_python_worker.settings import Settings

    settings = Settings(
        openrouter_api_key="sk-test",
        openrouter_base_url="http://127.0.0.1:9/v1",
        agent_evals_hermes_home=os.environ["AGENT_EVALS_HERMES_HOME"],
    )
    hermes = hermes_runner._load_hermes(settings)
    hermes.agent_class(
        model="openai/gpt-4.1-mini",
        base_url=settings.openrouter_base_url,
        api_key="sk-test",
        provider="openrouter",
        enabled_toolsets=[],
        skip_memory=True,
        skip_context_files=True,
        quiet_mode=True,
    )
    print("constructed")
    """
)


def test_agent_constructs_when_truststore_is_injected():
    proc = subprocess.run(
        [sys.executable, "-c", "import os\n" + CHILD],
        capture_output=True,
        text=True,
        env=dict(os.environ),
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr[-2000:]
    assert "constructed" in proc.stdout
