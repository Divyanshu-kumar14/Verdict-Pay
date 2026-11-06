"""Health must describe configuration truthfully without leaking a secret."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings

FORBIDDEN = ("PAYPAL_CLIENT_SECRET", "client-abc", "secret-xyz")


def _client(tmp_path, **overrides) -> TestClient:
    from app.main import create_app

    # Blank the credentials by default: the repo .env holds real ones, and these
    # tests are about how health reports *configuration*, not about them.
    base = {
        "app_env": "test",
        "database_url": f"sqlite+aiosqlite:///{tmp_path / 'health.db'}",
        "paypal_mode": "simulator",
        "paypal_client_id": "",
        "paypal_client_secret": "",
        "paypal_webhook_id": "",
        "demo_mode": True,
        "rate_limit_requests": 10_000,
    }
    base.update(overrides)
    return TestClient(create_app(Settings(**base)))


def test_simulator_reports_ready_and_simulation(tmp_path) -> None:
    with _client(tmp_path) as client:
        payload = client.get("/api/v1/health").json()

    status = payload["gateway_status"]
    assert status["mode"] == "LOCAL_SIMULATOR"
    assert status["readiness"] == "ready"
    assert status["simulation"] is True
    assert status["sandbox"] is False
    assert status["live"] is False
    assert status["blockers"] == []
    assert payload["ai_status"]["provider"] in {"gemini", "template"}


def test_sandbox_without_credentials_is_unconfigured(tmp_path) -> None:
    with _client(tmp_path, paypal_mode="PAYPAL_SANDBOX") as client:
        payload = client.get("/api/v1/health").json()

    status = payload["gateway_status"]
    assert status["mode"] == "PAYPAL_SANDBOX"
    assert status["readiness"] == "unconfigured"
    assert status["sandbox"] is True
    assert status["credentials_configured"] is False
    assert any("PAYPAL_CLIENT_ID" in blocker for blocker in status["blockers"])


def test_sandbox_with_credentials_is_ready_and_hides_them(tmp_path) -> None:
    with _client(
        tmp_path,
        paypal_mode="PAYPAL_SANDBOX",
        paypal_client_id="client-abc",
        paypal_client_secret="secret-xyz",
    ) as client:
        response = client.get("/api/v1/health")

    status = response.json()["gateway_status"]
    assert status["readiness"] == "ready"
    assert status["credentials_configured"] is True
    assert status["api_base"] == "https://api-m.sandbox.paypal.com"
    # The whole payload must never carry a credential value.
    for needle in FORBIDDEN[:1] + FORBIDDEN[1:]:
        assert needle not in response.text


@pytest.mark.parametrize("mode", ["LOCAL_SIMULATOR", "simulator", "PAYPAL_SANDBOX"])
def test_health_never_leaks_mode_secrets(tmp_path, mode: str) -> None:
    with _client(
        tmp_path,
        paypal_mode=mode,
        paypal_client_id="client-abc",
        paypal_client_secret="secret-xyz",
        paypal_webhook_id="WH-123",
    ) as client:
        text = client.get("/api/v1/health").text

    assert "client-abc" not in text
    assert "secret-xyz" not in text
    assert "WH-123" not in text
