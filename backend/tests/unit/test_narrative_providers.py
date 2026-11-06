"""Narrative providers and search adapters: determinism, fallbacks, no-ops.

Template prose must contain only locked facts; OpenAI must never leak the key
and must always degrade to the template; the optional Elastic mirror must never
raise into ingestion.
"""

from __future__ import annotations

import json
import logging
from dataclasses import replace
from decimal import Decimal
from typing import Any

import httpx
import pytest
import respx

from app.api import schemas
from app.config import Settings
from app.domain.evidence.narrative import validate_narrative
from app.domain.protocols import NarrativeRequest, SearchIndex
from app.integrations.llm.openai_provider import OpenAINarrativeProvider
from app.integrations.llm.template_provider import TemplateNarrativeProvider
from app.integrations.search.elastic import ElasticSearchIndex
from app.integrations.search.null import NullSearchIndex

PAYER = "YRZ829104KLA"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
ELASTIC_BULK_URL = "https://elastic.example/_bulk"
SYSTEM_PROMPT = (
    "You rewrite only the supplied facts. Never add numbers, names, dates or claims "
    "not present. Output ASCII only. Max 1800 characters."
)

FACTS: dict[str, Any] = {
    "payer_id": PAYER,
    "chain_valid": True,
    "chain_head": "a" * 64,
    "event_count": 4,
    "completeness": 0.75,
    "tos_version": "v2.4-2026-01",
    "tos_hash": "b" * 64,
    "tos_accepted_at": "2025-12-30T10:00:00Z",
    "first_seen": "2025-12-30T10:00:00Z",
    "last_seen": "2026-01-01T09:00:00Z",
    "ips": ["203.0.113.42"],
    "devices": ["fp_89a7c6d5e4f3"],
    "deliveries": [
        {
            "resource_id": "q3_financial_model.xlsx",
            "sha256": "c" * 64,
            "delivered_at": "2026-01-01T09:05:00Z",
        }
    ],
    "usage_units": 42000,
    "usage_events": 4,
    "login_count": 2,
    "response_due_date": "2026-01-11T00:00:00Z",
    "ce3_matches": [{"transaction_id": "TXN1", "amount_usd": "99.00", "days_ago": 150}],
    "ce3_window_days": 245,
    "signals": {"tos_accepted": True},
}


def _request(**overrides: Any) -> NarrativeRequest:
    request = NarrativeRequest(
        reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        stage="INQUIRY",
        amount_usd=Decimal("99.00"),
        payer_id=PAYER,
        merchant_name="Aurora Analytics",
        facts=FACTS,
        max_chars=1800,
    )
    return replace(request, **overrides) if overrides else request


def _openai_settings() -> Settings:
    return Settings(
        app_env="test",
        llm_mode="openai",
        openai_api_key="sk-test-key",
        openai_model="gpt-4o-mini",
    )


def _elastic_settings() -> Settings:
    return Settings(
        app_env="test",
        elastic_url="https://elastic.example",
        elastic_api_key="es-test-key",
        elastic_index_prefix="verdictpay",
    )


def _raise_timeout(request: httpx.Request) -> httpx.Response:
    raise httpx.TimeoutException("timed out", request=request)


# --------------------------------------------------------------------- template
async def test_template_is_deterministic_and_structured() -> None:
    provider = TemplateNarrativeProvider()

    first = await provider.compose(_request())
    second = await provider.compose(_request())

    assert provider.mode == "template"
    assert first == second
    assert first.isascii()
    assert len(first) <= 1800
    assert len(first.split("\n\n")) == 4


async def test_template_cites_only_locked_facts() -> None:
    provider = TemplateNarrativeProvider()

    text = await provider.compose(_request())

    assert "v2.4-2026-01" in text
    assert "b" * 64 in text
    assert "q3_financial_model.xlsx" in text
    assert "c" * 64 in text
    assert "a" * 64 in text
    assert "TXN1" in text
    assert "42000" in text
    assert "4 events" in text
    assert "2 authenticated logins" in text
    assert "2026-01-11T00:00:00Z" in text
    lowered = text.lower()
    for banned in ("guarantee", "100%", "we will win"):
        assert banned not in lowered

    facts = schemas.CaseFacts.model_validate(FACTS)
    assert validate_narrative(text, facts) == (True, "ok")


async def test_template_folds_non_ascii_merchant_name() -> None:
    provider = TemplateNarrativeProvider()

    text = await provider.compose(_request(merchant_name="Aurora Analitica Ltd"))

    assert text.isascii()
    assert text.startswith("Aurora Analitica Ltd respectfully responds")


async def test_template_truncates_to_max_chars() -> None:
    provider = TemplateNarrativeProvider()
    full = await provider.compose(_request())

    truncated = await provider.compose(_request(max_chars=200))
    empty = await provider.compose(_request(max_chars=0))

    assert truncated == full[:200].rstrip()
    assert len(truncated) <= 200
    assert empty == ""


async def test_template_degrades_when_fact_pack_is_incomplete() -> None:
    provider = TemplateNarrativeProvider()

    text = await provider.compose(_request(facts={"payer_id": PAYER}))
    short = await provider.compose(_request(facts={"payer_id": PAYER}, max_chars=40))

    assert text.startswith(
        "Aurora Analytics responds to the PayPal dispute for payer YRZ829104KLA"
    )
    assert text.isascii()
    assert "guarantee" not in text.lower()
    assert len(text) <= 1800
    assert len(short) <= 40


# ----------------------------------------------------------------------- openai
@respx.mock
async def test_openai_falls_back_on_non_2xx() -> None:
    provider = OpenAINarrativeProvider(_openai_settings())
    route = respx.post(OPENAI_URL).mock(
        return_value=httpx.Response(400, json={"error": {"message": "bad request"}})
    )
    request = _request()

    text = await provider.compose(request)

    assert text == await TemplateNarrativeProvider().compose(request)
    assert route.call_count == 1
    sent = json.loads(route.calls[0].request.content)
    assert sent["model"] == "gpt-4o-mini"
    assert sent["temperature"] == 0
    assert sent["messages"][0] == {"role": "system", "content": SYSTEM_PROMPT}
    assert "sk-test-key" not in json.dumps(sent)
    assert route.calls[0].request.headers["authorization"] == "Bearer sk-test-key"


@respx.mock
async def test_openai_retries_once_on_5xx_then_uses_answer() -> None:
    provider = OpenAINarrativeProvider(_openai_settings())
    candidate = (
        "The payer accepted the Terms of Service and the ledger chain is verifiable."
    )
    route = respx.post(OPENAI_URL).mock(
        side_effect=[
            httpx.Response(502, json={"error": {"message": "upstream"}}),
            httpx.Response(
                200, json={"choices": [{"message": {"content": candidate}}]}
            ),
        ]
    )

    text = await provider.compose(_request())

    assert text == candidate
    assert route.call_count == 2


@respx.mock
async def test_openai_falls_back_on_timeout() -> None:
    provider = OpenAINarrativeProvider(_openai_settings())
    route = respx.post(OPENAI_URL).mock(side_effect=_raise_timeout)
    request = _request()

    text = await provider.compose(request)

    assert text == await TemplateNarrativeProvider().compose(request)
    assert route.call_count == 1


@respx.mock
async def test_openai_falls_back_on_malformed_response() -> None:
    provider = OpenAINarrativeProvider(_openai_settings())
    route = respx.post(OPENAI_URL).mock(
        return_value=httpx.Response(200, json={"choices": []})
    )
    request = _request()

    text = await provider.compose(request)

    assert text == await TemplateNarrativeProvider().compose(request)
    assert route.call_count == 1


@respx.mock
async def test_openai_without_api_key_never_calls_network() -> None:
    provider = OpenAINarrativeProvider(
        Settings(app_env="test", llm_mode="openai", openai_api_key="")
    )
    request = _request()

    text = await provider.compose(request)

    assert text == await TemplateNarrativeProvider().compose(request)


@respx.mock
async def test_openai_truncates_verified_answer() -> None:
    provider = OpenAINarrativeProvider(_openai_settings())
    candidate = "The payer accepted the Terms of Service. " * 10
    respx.post(OPENAI_URL).mock(
        return_value=httpx.Response(
            200, json={"choices": [{"message": {"content": candidate}}]}
        )
    )

    text = await provider.compose(_request(max_chars=100))

    assert text == candidate[:100].rstrip()
    assert len(text) <= 100


# ----------------------------------------------------------------------- search
async def test_null_search_index_is_a_total_noop() -> None:
    index = NullSearchIndex()

    assert index.enabled is False
    assert isinstance(index, SearchIndex)
    assert await index.index_telemetry({"event_type": "SESSION_AUTH"}) is None
    assert await index.index_transaction({"transaction_id": "TXN-1"}) is None
    assert await index.close() is None


@respx.mock
async def test_elastic_posts_valid_ndjson() -> None:
    index = ElasticSearchIndex(_elastic_settings())
    route = respx.post(ELASTIC_BULK_URL).mock(
        return_value=httpx.Response(200, json={"errors": False, "items": []})
    )
    document = {"event_type": "ASSET_DELIVERED", "payer_id": PAYER, "sequence": 3}

    assert index.enabled is True
    await index.index_telemetry(document)

    request = route.calls[0].request
    lines = request.content.decode("utf-8").splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0]) == {"index": {"_index": "verdictpay-telemetry"}}
    assert json.loads(lines[1]) == document
    assert request.headers["content-type"] == "application/x-ndjson"
    assert request.headers["authorization"] == "ApiKey es-test-key"
    await index.close()


@respx.mock
async def test_elastic_swallows_500_and_uses_transactions_index(
    caplog: pytest.LogCaptureFixture,
) -> None:
    index = ElasticSearchIndex(_elastic_settings())
    route = respx.post(ELASTIC_BULK_URL).mock(
        return_value=httpx.Response(500, json={"error": "boom"})
    )
    caplog.set_level(logging.WARNING, logger="verdictpay.search.elastic")

    await index.index_transaction({"transaction_id": "TXN-1"})

    assert route.call_count == 1
    lines = route.calls[0].request.content.decode("utf-8").splitlines()
    assert json.loads(lines[0]) == {"index": {"_index": "verdictpay-transactions"}}
    warnings = [record for record in caplog.records if record.name == "verdictpay.search.elastic"]
    assert len(warnings) == 1
    assert warnings[0].extra_fields["index"] == "verdictpay-transactions"
    assert warnings[0].extra_fields["error"] == "HTTPStatusError"
    await index.close()


@respx.mock
async def test_elastic_swallows_transport_errors() -> None:
    index = ElasticSearchIndex(_elastic_settings())

    def _raise_connect_error(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("unreachable", request=request)

    route = respx.post(ELASTIC_BULK_URL).mock(side_effect=_raise_connect_error)

    await index.index_telemetry({"event_type": "TOS_ACCEPTED"})

    assert route.call_count == 1
    await index.close()


# ------------------------------------------------- Gemini failure must not raise
class _BoomClient:
    """A Gemini client whose every call fails, like a real API outage."""

    available = True

    def __init__(self) -> None:
        self.calls = 0

    async def generate_json(self, **_kwargs: Any) -> dict[str, Any]:
        self.calls += 1
        raise RuntimeError("gemini is down")


async def test_gemini_outage_falls_back_to_template_instead_of_raising() -> None:
    """A Gemini failure must degrade, not 500 the dossier endpoint.

    Regression: the fallback passed the JSON-shaped ``request.facts`` mapping
    straight into ``build_template_narrative``, which requires a typed
    ``CaseFacts`` and raised TypeError. With LLM_MODE=gemini — the deployed
    configuration — every Gemini hiccup became a 500 on the dossier PDF,
    manifest and verification routes instead of the documented template path.
    """
    from app.integrations.llm.gemini_provider import GeminiNarrativeProvider

    provider = GeminiNarrativeProvider(Settings(app_env="test", llm_mode="gemini", gemini_api_key="k"))
    provider._client = _BoomClient()  # type: ignore[attr-defined]

    narrative = await provider.compose(_request())

    assert isinstance(narrative, str)
    assert len(narrative) > 200
    assert PAYER in narrative
    # Grounded: $99.00 appears only because it is a locked CE3 fact, and the
    # template cites it as a prior-matching transaction, not as new evidence.
    assert "USD 99.00" in narrative
    assert "TXN1" in narrative


async def test_gemini_fallback_hydrates_the_typed_fact_pack() -> None:
    from app.integrations.llm.gemini_provider import GeminiNarrativeProvider

    provider = GeminiNarrativeProvider(Settings(app_env="test", llm_mode="gemini", gemini_api_key="k"))
    request = _request()

    hydrated = provider._hydrate_facts(request)

    assert isinstance(hydrated, schemas.CaseFacts)
    assert hydrated.payer_id == PAYER
    assert hydrated.chain_head == "a" * 64


async def test_gemini_fallback_with_corrupt_facts_asserts_no_figures() -> None:
    from app.integrations.llm.gemini_provider import GeminiNarrativeProvider

    provider = GeminiNarrativeProvider(Settings(app_env="test", llm_mode="gemini", gemini_api_key="k"))
    request = replace(_request(), facts={"payer_id": None, "nonsense": object()})
    provider._client = _BoomClient()  # type: ignore[attr-defined]

    narrative = await provider.compose(request)

    assert isinstance(narrative, str)
    assert "could not be rehydrated" in narrative
    assert "99.00" not in narrative
