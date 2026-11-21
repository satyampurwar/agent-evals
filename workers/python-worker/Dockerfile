# Hermes harness worker. Build context is this directory.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Same uv as the local setup (uv_build backend and the lock file were made with it).
RUN pip install --no-cache-dir uv==0.13.9

WORKDIR /app

COPY pyproject.toml uv.lock .python-version README.md ./
COPY src ./src
COPY app ./app

# --frozen: install exactly uv.lock. --no-dev: no pytest or ruff in the image.
RUN uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
