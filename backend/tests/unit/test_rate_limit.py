"""Rate limiting: the documented per-credential budget must actually exist."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import Settings
from app.main import create_app
from app.security import SlidingWindowLimiter


def test_limiter_allows_then_blocks_then_recovers() -> None:
    limiter = SlidingWindowLimiter(limit=2, window_seconds=60.0)
    assert limiter.check("k", now=0.0) == (True, 1)
    assert limiter.check("k", now=1.0) == (True, 0)
    assert limiter.check("k", now=2.0) == (False, 0)
    # After the window slides past the first two hits the key is allowed again.
    assert limiter.check("k", now=61.0) == (True, 0)


def test_limiter_is_per_key() -> None:
    limiter = SlidingWindowLimiter(limit=1, window_seconds=60.0)
    assert limiter.check("a", now=0.0) == (True, 0)
    assert limiter.check("b", now=0.0) == (True, 0)
    assert limiter.check("a", now=0.0) == (False, 0)


@pytest.mark.asyncio
async def test_api_returns_429_envelope_and_exempts_health(tmp_path) -> None:
    settings = Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'rate.db'}",
        paypal_mode="simulator",
        llm_mode="template",
        verdictpay_api_key="rate_test_key",
        rate_limit_per_minute=2,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.headers["X-API-Key"] = "rate_test_key"
            for _ in range(10):
                assert (await client.get("/api/v1/health")).status_code == 200

            assert (await client.get("/api/v1/disputes")).status_code == 200
            assert (await client.get("/api/v1/disputes")).status_code == 200
            blocked = await client.get("/api/v1/disputes")

    assert blocked.status_code == 429
    assert blocked.headers["Retry-After"] == "60"
    body = blocked.json()
    assert body["error"]["code"] == "rate_limited"
    assert body["error"]["request_id"]
