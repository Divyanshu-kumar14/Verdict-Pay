"""Locked-facts narrative and validator tests (Phase 3.2)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

import pytest

from app.api import schemas
from app.domain.evidence.narrative import (
    MAX_NARRATIVE_CHARS,
    build_template_narrative,
    facts_as_prompt,
    validate_narrative,
)
from app.domain.protocols import NarrativeRequest

REASON = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
MERCHANT = "Aurora Analytics"
PAYER = "YRZ829104KLA"


def _facts(**overrides: object) -> schemas.CaseFacts:
    base: dict[str, object] = {
        "payer_id": PAYER,
        "chain_valid": True,
        "chain_head": "4" * 64,
        "event_count": 4,
        "completeness": 1.0,
        "tos_version": "v2.4-2026-01",
        "tos_hash": "a" * 64,
        "tos_accepted_at": datetime(2026, 2, 19, 10, 0, tzinfo=UTC),
        "first_seen": datetime(2026, 2, 19, 12, 0, tzinfo=UTC),
        "last_seen": datetime(2026, 2, 22, 12, 0, tzinfo=UTC),
        "ips": ["198.51.100.5", "203.0.113.10"],
        "devices": ["dev-abc", "dev-xyz"],
        "deliveries": [
            {
                "resource_id": "q3_financial_model.xlsx",
                "sha256": "b" * 64,
                "delivered_at": "2026-02-21T12:00:00+00:00",
            }
        ],
        "usage_units": 42000,
        "usage_events": 1,
        "login_count": 5,
        "response_due_date": datetime(2026, 3, 8, 12, 0, tzinfo=UTC),
        "ce3_matches": [
            {
                "transaction_id": "TXN-200",
                "amount_usd": "49.00",
                "status": "COMPLETED",
                "days_ago": 200,
                "matched_on": "ip",
            },
            {
                "transaction_id": "TXN-300",
                "amount_usd": "59.00",
                "status": "COMPLETED",
                "days_ago": 300,
                "matched_on": "device",
            },
        ],
        "ce3_window_days": 365,
        "signals": {
            "tos_accepted": True,
            "ip_match": True,
            "asset_delivered": True,
            "usage_metered": True,
            "chain_verified": True,
            "ce3_historical_match": True,
        },
    }
    base.update(overrides)
    return schemas.CaseFacts(**base)  # type: ignore[arg-type]


def _narrative(facts: schemas.CaseFacts | None = None) -> str:
    return build_template_narrative(
        facts=facts or _facts(),
        reason_code=REASON,
        stage="INQUIRY",
        amount_usd=Decimal("25.00"),
        merchant_name=MERCHANT,
    )


def _request(facts: schemas.CaseFacts, *, max_chars: int = 8000) -> NarrativeRequest:
    return NarrativeRequest(
        reason_code=REASON,
        stage="INQUIRY",
        amount_usd=Decimal("25.00"),
        payer_id=PAYER,
        merchant_name=MERCHANT,
        facts=facts.model_dump(mode="json"),
        max_chars=max_chars,
    )


def test_template_cites_every_required_fact() -> None:
    facts = _facts()
    text = _narrative(facts)
    assert text.isascii()
    assert len([part for part in text.split("\n\n") if part.strip()]) == 4
    assert PAYER in text
    assert "v2.4-2026-01" in text
    assert "a" * 64 in text
    assert "4" * 64 in text
    assert "q3_financial_model.xlsx" in text
    assert "b" * 64 in text
    assert "42000 metered units" in text
    assert "5 authenticated logins" in text
    assert "4 events" in text
    assert "2026-03-08T12:00:00Z" in text
    assert "TXN-200" in text
    assert "USD 49.00" in text
    assert "200 days ago" in text
    assert "365-day lookback window" in text
    assert "guarantee" not in text.lower()
    assert "100%" not in text


def test_template_validates_against_its_own_facts() -> None:
    facts = _facts()
    assert validate_narrative(_narrative(facts), facts) == (True, "ok")


def test_sparse_facts_still_validate() -> None:
    facts = schemas.CaseFacts(
        payer_id=PAYER,
        chain_valid=False,
        chain_head="",
        event_count=0,
        completeness=0.0,
        signals={},
    )
    text = _narrative(facts)
    assert validate_narrative(text, facts) == (True, "ok")
    assert "No Terms of Service acceptance" in text
    assert "No asset delivery" in text
    assert "no prior completed transactions" in text


def test_invented_number_is_rejected() -> None:
    facts = _facts()
    text = _narrative(facts) + " The payer additionally owes 98765.43 USD."
    assert validate_narrative(text, facts) == (
        False,
        "unverified_number:98765.43",
    )


def test_invented_date_is_rejected() -> None:
    facts = _facts()
    text = _narrative(facts) + " The account was created on 1999-12-31."
    assert validate_narrative(text, facts) == (False, "unverified_date:1999-12-31")


@pytest.mark.parametrize(
    "addition,expected_reason",
    [
        (" We guarantee recovery.", "banned_phrase:guarantee"),
        (" A 100% outcome is certain.", "banned_phrase:100%"),
        (" We will win this dispute.", "banned_phrase:we will win"),
    ],
)
def test_banned_phrases_are_rejected(addition: str, expected_reason: str) -> None:
    facts = _facts()
    assert validate_narrative(_narrative(facts) + addition, facts) == (
        False,
        expected_reason,
    )


def test_empty_narrative_is_rejected() -> None:
    assert validate_narrative("   ", _facts()) == (False, "empty_narrative")


def test_too_long_narrative_is_rejected() -> None:
    facts = _facts()
    assert validate_narrative("A" * (MAX_NARRATIVE_CHARS + 1), facts) == (
        False,
        "narrative_too_long",
    )


def test_non_ascii_narrative_is_rejected() -> None:
    facts = _facts()
    assert validate_narrative(_narrative(facts) + " café", facts) == (False, "non_ascii")


def test_facts_as_prompt_is_deterministic_and_locked() -> None:
    facts = _facts()
    first = facts_as_prompt(facts)
    second = facts_as_prompt(facts)
    assert first == second
    assert first.isascii()
    assert "payer_id=YRZ829104KLA" in first
    assert "chain_head=" + "4" * 64 in first
    assert "login_count=5" in first
    assert "ce3_matches=" in first
    assert "TXN-200" in first
    assert "LOCKED FACTS" in first


async def test_template_provider_delegates() -> None:
    from app.integrations.llm.template_provider import TemplateNarrativeProvider

    facts = _facts()
    provider = TemplateNarrativeProvider()
    assert provider.mode == "template"
    assert await provider.compose(_request(facts)) == _narrative(facts)


async def test_template_provider_truncates_to_max_chars() -> None:
    from app.integrations.llm.template_provider import TemplateNarrativeProvider

    facts = _facts()
    full = _narrative(facts)
    provider = TemplateNarrativeProvider()
    short = await provider.compose(_request(facts, max_chars=100))
    assert len(short) <= 100
    assert short == full[:100].rstrip()


def test_numbers_hidden_inside_a_digest_are_not_allowed() -> None:
    """A figure that only appears inside a SHA-256 hex string must not validate."""
    from app.api import schemas
    from app.domain.evidence.narrative import validate_narrative

    head = "ab4521cd" + "0" * 56
    facts = schemas.CaseFacts(
        payer_id="PAYER1", chain_valid=True, chain_head=head, event_count=3, completeness=0.5
    )
    ok, reason = validate_narrative("The buyer was refunded 4521 dollars.", facts)
    assert ok is False
    assert reason == "unverified_number:4521"
    ok, _ = validate_narrative(f"The chain head is {head} across 3 events.", facts)
    assert ok is True
    ok, reason = validate_narrative(f"The chain head is {'f' * 64}.", facts)
    assert ok is False
    assert reason.startswith("unverified_digest:")


def test_formatted_counts_and_percents_of_facts_validate() -> None:
    from app.api import schemas
    from app.domain.evidence.narrative import validate_narrative

    facts = schemas.CaseFacts(
        payer_id="PAYER1",
        chain_valid=True,
        chain_head="",
        event_count=4,
        completeness=0.8333,
        usage_units=42000,
    )
    ok, reason = validate_narrative(
        "The account consumed 42,000 metered units; telemetry completeness is 83.33%.", facts
    )
    assert ok, reason
    ok, reason = validate_narrative("The account consumed 43,000 metered units.", facts)
    assert not ok
    assert reason == "unverified_number:43000"


def test_sub_100_fraction_is_never_rounded_up_to_100() -> None:
    """A 99.99% fraction must not license a bare "100" claim."""
    from app.api import schemas
    from app.domain.evidence.narrative import validate_narrative

    facts = schemas.CaseFacts(
        payer_id="PAYER1",
        chain_valid=True,
        chain_head="",
        event_count=3,
        completeness=0.9999,
    )
    ok, reason = validate_narrative("Telemetry completeness is 100 percent.", facts)
    assert not ok
    assert reason == "unverified_number:100"

    ok, reason = validate_narrative("Telemetry completeness is 99.99 percent.", facts)
    assert ok, reason


def test_exactly_full_fraction_may_be_cited_as_100() -> None:
    from app.api import schemas
    from app.domain.evidence.narrative import validate_narrative

    facts = schemas.CaseFacts(
        payer_id="PAYER1",
        chain_valid=True,
        chain_head="",
        event_count=3,
        completeness=1.0,
    )
    ok, reason = validate_narrative("Telemetry completeness is 100 percent.", facts)
    assert ok, reason
