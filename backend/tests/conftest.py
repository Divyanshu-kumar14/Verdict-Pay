"""Shared test fixtures.

Every integration test uses an isolated SQLite file and a test-only fake of
PayPal (tests/fakes/paypal_gateway.py), so the suite runs offline. The real
adapter is covered by tests/unit/test_paypal_live.py against recorded responses.
"""

from __future__ import annotations

import hashlib
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

import app.main as app_main
from app.config import Settings
from app.integrations.paypal.factory import build_gateway as real_build_gateway
from app.main import create_app
from tests.fakes.paypal_gateway import FakePayPalGateway

_HOST_SECRET_PREFIXES = ("PAYPAL_", "GEMINI_", "VERDICTPAY_", "LLM_", "OPENAI_")


@pytest.fixture(autouse=True)
def _isolate_from_host_config(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the developer's real .env and shell credentials out of every test.

    Settings reads backend/.env and the repo .env by default. Without this, a
    test that omits a credential silently picks up the real PayPal Sandbox keys
    and creates real orders on every run.
    """
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for key in list(os.environ):
        if key.upper().startswith(_HOST_SECRET_PREFIXES):
            monkeypatch.delenv(key, raising=False)


@pytest.fixture(autouse=True)
def _offline_paypal(monkeypatch: pytest.MonkeyPatch) -> None:
    """Serve PayPal from the test-only fake so no test reaches the network.

    A configuration with blockers still gets the real UnconfiguredGateway, so
    the fail-loud behaviour for missing credentials stays under test.
    """

    def _build(settings: Settings):
        if settings.gateway_blockers:
            return real_build_gateway(settings)
        return FakePayPalGateway(settings)

    monkeypatch.setattr(app_main, "build_gateway", _build)


async def approve_order(client: AsyncClient, order_id: str) -> None:
    """Stand in for the sandbox buyer clicking Approve in the PayPal UI."""
    gateway = client.app.state.gateway  # type: ignore[attr-defined]
    await gateway.approve_order(order_id)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'test.db'}",
        paypal_mode="PAYPAL_SANDBOX",
        paypal_client_id="test-client-abc",
        paypal_client_secret="test-secret-xyz",
        paypal_webhook_id="WH-TEST-ID",
        paypal_sandbox_client_id="test-client-abc",
        paypal_sandbox_client_secret="test-secret-xyz",
        paypal_sandbox_webhook_id="WH-TEST-ID",
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
