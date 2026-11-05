"""OpenAI-compatible local endpoints (Ollama/LM Studio) must be first-class."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest
import respx

from app.api import schemas
from app.config import Settings
from app.domain.protocols import NarrativeRequest
from app.integrations.llm.factory import build_narrative_provider
from app.integrations.llm.openai_provider import OpenAINarrativeProvider


def _request() -> NarrativeRequest:
    return NarrativeRequest(
        reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        stage="INQUIRY",
        amount_usd=Decimal("99.00"),
        payer_id="YRZ829104KLA",
        merchant_name="Aurora Analytics",
        facts=schemas.CaseFacts(
            payer_id="YRZ829104KLA",
            chain_valid=True,
            chain_head="a" * 64,
            event_count=4,
            completeness=1.0,
        ).model_dump(mode="json"),
        max_chars=1800,
    )


def test_factory_accepts_a_local_endpoint_without_a_key() -> None:
    settings = Settings(
        llm_mode="openai",
        llm_base_url="http://localhost:11434/v1",
        llm_model="llama3.2",
        openai_api_key="",
    )
    provider = build_narrative_provider(settings)
    assert isinstance(provider, OpenAINarrativeProvider)
    assert provider.mode == "openai"
    assert provider.model_name == "llama3.2"


def test_factory_falls_back_to_template_when_nothing_is_configured() -> None:
    settings = Settings(llm_mode="openai", llm_base_url="", openai_api_key="")
    assert build_narrative_provider(settings).mode == "template"


@pytest.mark.asyncio
@respx.mock
async def test_local_endpoint_is_called_without_an_authorization_header() -> None:
    route = respx.post("http://localhost:11434/v1/chat/completions").mock(
        return_value=httpx.Response(
            200,
            json={"choices": [{"message": {"content": "The seller delivered the asset."}}]},
        )
    )
    settings = Settings(
        llm_mode="openai",
        llm_base_url="http://localhost:11434/v1",
        llm_model="llama3.2",
        openai_api_key="",
    )
    provider = OpenAINarrativeProvider(settings)
    text = await provider.compose(_request())

    assert route.called
    request = route.calls[0].request
    assert "authorization" not in {key.lower() for key in request.headers}
    assert b"llama3.2" in request.content
    # The local model's prose is unverifiable against the sparse fact pack, so the
    # deterministic template is used instead of an unvalidated claim.
    assert text


def test_local_endpoint_defaults_the_path_correctly() -> None:
    settings = Settings(llm_base_url="http://127.0.0.1:8080/v1/", llm_model="qwen2.5")
    provider = OpenAINarrativeProvider(settings)
    endpoint = provider._endpoint
    assert endpoint == "http://127.0.0.1:8080/v1/chat/completions"
    assert provider.model_name == "qwen2.5"
    assert datetime.now(UTC)
