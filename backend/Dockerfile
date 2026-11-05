# syntax=docker/dockerfile:1.7
# VerdictPay API image. Build from the repository root:
#   docker build -f backend/Dockerfile -t verdictpay/api .
# The demo is keyless: the simulator gateway is the default and needs no PayPal account.

FROM python:3.12-slim AS builder

# Pinned uv binary; the lockfile below is the only dependency source of truth.
COPY --from=ghcr.io/astral-sh/uv:0.12.17 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Dependency layer first so application edits do not invalidate the install.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY backend/app ./app
COPY backend/scripts ./scripts


FROM python:3.12-slim AS runtime

# curl backs the HEALTHCHECK; everything else stays out of the runtime image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 app \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app

ENV PATH="/app/.venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ARTIFACTS_DIR=/app/artifacts \
    # Standalone-safe default: the non-root user can write this path, unlike /app.
    DATABASE_URL=sqlite+aiosqlite:////app/data/verdictpay.db

COPY --from=builder --chown=10001:10001 /app /app

# Writable, non-root-owned locations for the SQLite DB and the PDF artifacts.
RUN mkdir -p /app/artifacts /app/data \
    && chown -R 10001:10001 /app/artifacts /app/data

USER 10001

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/api/v1/health || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
