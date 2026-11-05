"""Shared test fixtures.

Every integration test uses an isolated SQLite file and the real simulator
gateway — the same code path the judge demo uses. No PayPal mocks.
"""

from __future__ import annotations

import hashlib
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        paypal_mode="simulator",
        llm_mode="template",
        demo_mode=True,
        verdictpay_api_key="test_key_local",
        verdictpay_signing_secret="test_signing_secret",
        verdictpay_webhook_secret="test_webhook_secret",
        allow_unsigned_webhooks=False,
        rate_limit_per_minute=10_000,
    )


@pytest_asyncio.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as http:
            http.headers["X-API-Key"] = settings.verdictpay_api_key
            http.settings = settings  # type: ignore[attr-defined]
            http.app = app  # type: ignore[attr-defined]
            yield http


@pytest.fixture
def auth_headers(settings: Settings) -> dict[str, str]:
    return {"X-API-Key": settings.verdictpay_api_key}


@pytest.fixture
def now() -> datetime:
    return datetime.now(UTC)


def sha256_hex(value: str | bytes) -> str:
    payload = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(payload).hexdigest()


@pytest.fixture
def days_ago(now: datetime):
    def _days_ago(days: int) -> datetime:
        return now - timedelta(days=days)

    return _days_ago
