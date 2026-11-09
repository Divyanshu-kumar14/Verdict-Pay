"""The 256 KB body cap must count real bytes, not just Content-Length."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app


def _settings(tmp_path) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'body.db'}",
        paypal_mode="PAYPAL_SANDBOX",
        llm_mode="template",
        verdictpay_api_key="body_test_key",
        webhook_tolerance_seconds=300,
        rate_limit_per_minute=10_000,
    )


@pytest.mark.asyncio
async def test_declared_oversized_body_is_rejected(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        client.headers["X-API-Key"] = "body_test_key"
        response = await client.post("/api/v1/telemetry/events", content=b"x" * 300_000)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


@pytest.mark.asyncio
async def test_chunked_oversized_body_cannot_bypass_the_cap(tmp_path) -> None:
    """A generator body has no Content-Length; the ASGI cap must still fire."""
    app = create_app(_settings(tmp_path))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        client.headers["X-API-Key"] = "body_test_key"

        async def oversized_chunks():
            for _ in range(4):
                yield b"x" * 80_000

        response = await client.post(
            "/api/v1/telemetry/events",
            content=oversized_chunks(),
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


@pytest.mark.asyncio
async def test_body_under_the_cap_still_reaches_the_route(tmp_path) -> None:
    app = create_app(_settings(tmp_path))
    async with app.router.lifespan_context(app), AsyncClient(
        transport=ASGITransport(app=app), base_url="http://testserver"
    ) as client:
        client.headers["X-API-Key"] = "body_test_key"
        response = await client.get("/api/v1/health")
    assert response.status_code == 200
