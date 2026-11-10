"""GeminiClient must surface the non-secret HTTP code of an upstream failure."""

from __future__ import annotations

import logging

import pytest

from app.config import Settings
from app.integrations.ai.client import AiUnavailableError, GeminiClient, _describe_error

SECRET = "AIza-super-secret-key-value"


class FakeClientError(Exception):
    """Mimics google.genai.errors.ClientError (code/status/message attrs)."""

    def __init__(self) -> None:
        super().__init__(f"429 RESOURCE_EXHAUSTED key={SECRET}")
        self.code = 429
        self.status = "RESOURCE_EXHAUSTED"
        self.message = f"quota exceeded for key {SECRET}"


def test_describe_error_includes_code_and_status_only() -> None:
    assert _describe_error(FakeClientError()) == "FakeClientError 429 RESOURCE_EXHAUSTED"
    assert _describe_error(ValueError("boom")) == "ValueError"


async def test_generate_json_reports_http_code_without_leaking_key(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    client = GeminiClient(Settings(gemini_api_key=SECRET, ai_enabled=True, ai_max_retries=1))
    monkeypatch.setattr(client, "_client", object())

    def boom(*_args: object) -> str:
        raise FakeClientError()

    monkeypatch.setattr(client, "_generate", boom)
    with caplog.at_level(logging.WARNING), pytest.raises(AiUnavailableError) as info:
        await client.generate_json(system="s", user="u", schema=None)

    assert "429 RESOURCE_EXHAUSTED" in str(info.value)
    assert "429 RESOURCE_EXHAUSTED" in caplog.text
    assert SECRET not in str(info.value)
    assert SECRET not in caplog.text


def test_veto_lab_worker_reports_http_code(monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    import json
    import socket

    from app.worker import live_llm_attack

    def boom(_key: str, _model: str) -> dict[str, object]:
        raise FakeClientError()

    monkeypatch.setattr(live_llm_attack, "_call_llm", boom)
    monkeypatch.setattr(socket, "socket", socket.socket)  # restored after main() nulls it
    monkeypatch.setenv("LLM_API_KEY", SECRET)
    assert live_llm_attack.main() == 0
    out = json.loads(capsys.readouterr().out)
    assert out["source"] == "scripted_llm_error"
    assert out["degraded_reason"] == "llm_error:FakeClientError 429 RESOURCE_EXHAUSTED"
    assert SECRET not in json.dumps(out)


def test_safe_error_reason_prefers_wrapped_upstream_and_never_the_message() -> None:
    from app.integrations.ai.client import safe_error_reason

    wrapped = AiUnavailableError(
        f"gemini unavailable: {SECRET}", upstream="ClientError 429 RESOURCE_EXHAUSTED"
    )
    assert safe_error_reason(wrapped) == "ClientError 429 RESOURCE_EXHAUSTED"
    assert safe_error_reason(AiUnavailableError(f"empty {SECRET}")) == "AiUnavailableError"
    assert safe_error_reason(FakeClientError()) == "FakeClientError 429 RESOURCE_EXHAUSTED"
    assert safe_error_reason(RuntimeError(SECRET)) == "RuntimeError"


async def test_ai_endpoint_degraded_reason_carries_http_code(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """GET /disputes/{id}/ai reports ``model_error:ClientError 429 ...`` without the key."""
    from httpx import ASGITransport, AsyncClient

    import app.api.routers.ai as ai_router
    from app.main import create_app

    api_key = "gemini_err_key"
    settings = Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'gemerr.db'}",
        paypal_mode="PAYPAL_SANDBOX",
        paypal_client_id="test-client-abc",
        paypal_client_secret="test-secret-xyz",
        llm_mode="gemini",
        gemini_api_key=SECRET,
        verdictpay_api_key=api_key,
        rate_limit_per_minute=10_000,
    )

    def boom(self: GeminiClient, *_args: object) -> str:
        raise FakeClientError()

    monkeypatch.setattr(GeminiClient, "_generate", boom)
    monkeypatch.setattr(GeminiClient, "available", property(lambda self: True))
    ai_router._CACHE.clear()
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(
            transport=transport, base_url="http://testserver", headers={"X-API-Key": api_key}
        ) as client:
            order = (
                await client.post(
                    "/api/v1/sandbox/checkout", json={"plan": "pro", "payer_id": "YRZ829104KLA"}
                )
            ).json()
            dispute = await client.post(
                "/api/v1/sandbox/dispute",
                json={
                    "payer_id": order["payer_id"],
                    "order_id": order["order_id"],
                    "claim_text": "I never received it.",
                },
            )
            assert dispute.status_code == 200, dispute.text
            dispute_id = dispute.json()["dispute"]["dispute_id"]
            response = await client.get(f"/api/v1/disputes/{dispute_id}/ai")
    ai_router._CACHE.clear()
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["degraded"] is True
    assert body["degraded_reason"] == "model_error:FakeClientError 429 RESOURCE_EXHAUSTED"
    assert body["narrative"]["model"] == "template"
    assert SECRET not in response.text
    # The app's JSON log handler writes to stdout rather than to caplog.
    logs = capsys.readouterr().out
    assert SECRET not in logs
    assert "ai analyze degraded for " + dispute_id + ": FakeClientError 429 RESOURCE_EXHAUSTED" in logs
