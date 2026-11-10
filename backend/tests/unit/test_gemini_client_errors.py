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
