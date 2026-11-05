"""Exact fact-pack assembly tests (Phase 3.1)."""

from __future__ import annotations

from dataclasses import FrozenInstanceError
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

import pytest

from app.domain.evidence.facts import CaseInput, TelemetryEventView, assemble_facts
from app.domain.protocols import PayPalTransactionRecord

NOW = datetime(2026, 3, 1, 12, 0, tzinfo=UTC)
PAYER = "YRZ829104KLA"


def _event(
    event_type: str,
    sequence: int,
    created_at: datetime,
    *,
    client_ip: str = "203.0.113.10",
    device: str = "dev-abc",
    resource_id: str | None = None,
    resource_hash: str | None = None,
    units: int = 0,
    chain_hash: str | None = None,
    payload: dict[str, Any] | None = None,
) -> TelemetryEventView:
    return TelemetryEventView(
        event_type=event_type,
        sequence=sequence,
        client_ip=client_ip,
        device_fingerprint=device,
        resource_id=resource_id,
        resource_hash=resource_hash,
        units_consumed=units,
        chain_hash=chain_hash or str(sequence % 10) * 64,
        created_at=created_at,
        payload=payload or {},
    )


def _txn(
    transaction_id: str,
    days_ago: int,
    *,
    status: str = "COMPLETED",
    ip: str = "203.0.113.10",
    device: str = "dev-other",
    amount: str = "49.00",
) -> PayPalTransactionRecord:
    return PayPalTransactionRecord(
        transaction_id=transaction_id,
        payer_id=PAYER,
        amount=Decimal(amount),
        currency="USD",
        status=status,
        client_ip=ip,
        device_fingerprint=device,
        created_at=NOW - timedelta(days=days_ago),
    )


def _events() -> list[TelemetryEventView]:
    return [
        _event(
            "TOS_ACCEPTED",
            1,
            NOW - timedelta(days=10),
            payload={
                "tos_version": "v2.4-2026-01",
                "tos_content_sha256": "a" * 64,
                "accepted_at": "2026-02-19T10:00:00+00:00",
                "metadata": {"logins": 5},
            },
        ),
        _event(
            "SESSION_AUTH",
            2,
            NOW - timedelta(days=9),
            payload={"metadata": {"logins": 5}},
        ),
        _event(
            "ASSET_DELIVERED",
            3,
            NOW - timedelta(days=8),
            client_ip="198.51.100.5",
            device="dev-xyz",
            resource_id="q3_financial_model.xlsx",
            resource_hash="b" * 64,
        ),
        _event("USAGE_METERED", 4, NOW - timedelta(days=7), units=42000),
    ]


def _transactions() -> list[PayPalTransactionRecord]:
    return [
        _txn("TXN-200", 200),
        _txn("TXN-300", 300, ip="198.51.100.99", device="dev-abc", amount="59.00"),
        _txn("TXN-400", 400, amount="99.00"),
    ]


def _case(**overrides: Any) -> CaseInput:
    base: dict[str, Any] = {
        "payer_id": PAYER,
        "amount_usd": Decimal("25.00"),
        "currency": "USD",
        "reason_code": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "stage": "INQUIRY",
        "merchant_name": "Aurora Analytics",
        "events": _events(),
        "transactions": _transactions(),
        "chain_valid": True,
        "now": NOW,
        "response_due_date": NOW + timedelta(days=7),
    }
    base.update(overrides)
    return CaseInput(**base)


def test_assemble_facts_exact_values() -> None:
    facts = assemble_facts(_case())
    assert facts.payer_id == PAYER
    assert facts.chain_valid is True
    assert facts.chain_head == "4" * 64
    assert facts.event_count == 4
    assert facts.completeness == 1.0
    assert facts.tos_version == "v2.4-2026-01"
    assert facts.tos_hash == "a" * 64
    assert facts.tos_accepted_at == datetime(2026, 2, 19, 10, 0, tzinfo=UTC)
    assert facts.first_seen == NOW - timedelta(days=10)
    assert facts.last_seen == NOW - timedelta(days=7)
    assert facts.ips == ["198.51.100.5", "203.0.113.10"]
    assert facts.devices == ["dev-abc", "dev-xyz"]
    assert facts.deliveries == [
        {
            "resource_id": "q3_financial_model.xlsx",
            "sha256": "b" * 64,
            "delivered_at": "2026-02-21T12:00:00+00:00",
        }
    ]
    assert facts.usage_units == 42000
    assert facts.usage_events == 1
    assert facts.login_count == 5
    assert facts.response_due_date == NOW + timedelta(days=7)


def test_signals_and_ce3_exact() -> None:
    facts = assemble_facts(_case())
    assert facts.signals == {
        "tos_accepted": True,
        "ip_match": True,
        "asset_delivered": True,
        "usage_metered": True,
        "chain_verified": True,
        "ce3_historical_match": True,
    }
    assert facts.ce3_window_days == 365
    assert facts.ce3_matches == [
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
    ]


def test_ce3_window_boundaries_and_status_filter() -> None:
    transactions = [
        _txn("TXN-119", 119),
        _txn("TXN-120", 120),
        _txn("TXN-365", 365),
        _txn("TXN-366", 366),
        _txn("TXN-PENDING", 200, status="PENDING"),
    ]
    facts = assemble_facts(_case(transactions=transactions))
    assert [match["transaction_id"] for match in facts.ce3_matches] == [
        "TXN-120",
        "TXN-365",
    ]
    assert facts.ce3_matches[0]["days_ago"] == 120
    assert facts.ce3_window_days == 365


def test_no_ce3_matches_reports_zero_window() -> None:
    facts = assemble_facts(_case(transactions=[_txn("TXN-50", 50)]))
    assert facts.ce3_matches == []
    assert facts.ce3_window_days == 0
    assert facts.signals["ce3_historical_match"] is False


def test_login_count_falls_back_to_session_event_count() -> None:
    events = [
        _event("SESSION_AUTH", 1, NOW - timedelta(days=2)),
        _event("SESSION_AUTH", 2, NOW - timedelta(days=1)),
    ]
    facts = assemble_facts(_case(events=events, transactions=[]))
    assert facts.login_count == 2
    assert facts.event_count == 2
    assert facts.chain_head == "2" * 64


def test_tos_accepted_at_falls_back_to_event_time() -> None:
    event = _event(
        "TOS_ACCEPTED",
        1,
        NOW - timedelta(days=3),
        payload={"tos_version": "v9.0"},
    )
    facts = assemble_facts(_case(events=[event], transactions=[]))
    assert facts.tos_version == "v9.0"
    assert facts.tos_hash is None
    assert facts.tos_accepted_at == NOW - timedelta(days=3)


def test_empty_events_produce_empty_facts() -> None:
    facts = assemble_facts(_case(events=[], transactions=[], chain_valid=False))
    assert facts.event_count == 0
    assert facts.chain_head == ""
    assert facts.first_seen is None
    assert facts.last_seen is None
    assert facts.ips == []
    assert facts.devices == []
    assert facts.deliveries == []
    assert facts.usage_units == 0
    assert facts.usage_events == 0
    assert facts.login_count == 0
    assert facts.completeness == 0.0
    assert all(value is False for value in facts.signals.values())
    assert facts.tos_version is None


def test_deliveries_newest_first_and_capped() -> None:
    events = [
        _event(
            "ASSET_DELIVERED",
            index,
            NOW - timedelta(days=index),
            resource_id=f"asset-{index}.zip",
            resource_hash=f"{index:064x}",
        )
        for index in range(1, 4)
    ]
    facts = assemble_facts(_case(events=events, transactions=[]))
    assert [row["resource_id"] for row in facts.deliveries] == [
        "asset-1.zip",
        "asset-2.zip",
        "asset-3.zip",
    ]
    assert facts.deliveries[0]["sha256"] == f"{1:064x}"


def test_case_input_is_frozen() -> None:
    case = _case()
    with pytest.raises(FrozenInstanceError):
        case.payer_id = "other"  # type: ignore[misc]
    event = _events()[0]
    with pytest.raises(FrozenInstanceError):
        event.sequence = 99  # type: ignore[misc]


def test_invalid_payer_rejected() -> None:
    with pytest.raises(ValueError, match="payer_id"):
        assemble_facts(_case(payer_id=""))
