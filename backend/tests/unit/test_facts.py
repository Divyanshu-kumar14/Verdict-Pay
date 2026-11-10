"""Exact fact-pack assembly tests (Phase 3.1)."""

from __future__ import annotations

from dataclasses import FrozenInstanceError, replace
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
    # A PayPal Wallet INR is never CE 3.0 eligible: 5 of 6 signals.
    assert facts.completeness == 0.8333
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


CARD = "cred-hash-1"
LOGIN = "login-hash-1"
SHIP = "ship-hash-1"


def _card_events() -> list[TelemetryEventView]:
    events = _events()
    first = events[0]
    payload = dict(first.payload)
    payload["metadata"] = {
        "logins": 5,
        "payment_credential_hash": CARD,
        "account_login_id_hash": LOGIN,
        "shipping_address_hash": SHIP,
    }
    events[0] = replace(first, payload=payload)
    return events


def _card_txn(transaction_id: str, seconds_ago: int, **overrides: Any) -> PayPalTransactionRecord:
    base: dict[str, Any] = {
        "transaction_id": transaction_id,
        "payer_id": PAYER,
        "amount": Decimal("49.00"),
        "currency": "USD",
        "status": "COMPLETED",
        "client_ip": "203.0.113.10",
        "device_fingerprint": "dev-abc",
        "created_at": NOW - timedelta(seconds=seconds_ago),
        "payment_rail": "UNBRANDED_CARD",
        "payment_credential_hash": CARD,
        "account_login_id_hash": LOGIN,
        "shipping_address_hash": SHIP,
    }
    base.update(overrides)
    return PayPalTransactionRecord(**base)


def _card_case(transactions: list[PayPalTransactionRecord], **overrides: Any) -> CaseInput:
    return _case(
        reason_code="UNAUTHORIZED",
        payment_rail="UNBRANDED_CARD",
        external_reason_code="10.4",
        order_id="O-D",
        disputed_at=NOW,
        events=_card_events(),
        transactions=transactions,
        **overrides,
    )


DAY = 86400


def test_wallet_dispute_is_never_ce3_eligible() -> None:
    facts = assemble_facts(
        _case(transactions=[_card_txn("A", 200 * DAY), _card_txn("B", 300 * DAY)])
    )
    assert facts.ce3_matches == []
    assert facts.signals["ce3_historical_match"] is False
    assert facts.ce3_proof is not None
    assert facts.ce3_proof["veto_code"] == "VETO_CE3_NOT_ELIGIBLE"


def test_card_10_4_three_way_match_exact() -> None:
    facts = assemble_facts(
        _card_case([_card_txn("TXN-200", 200 * DAY), _card_txn("TXN-300", 300 * DAY)])
    )
    assert facts.signals["ce3_historical_match"] is True
    assert facts.ce3_proof["verified"] is True
    assert len(facts.ce3_proof["sha256_manifest"]) == 64
    assert [m["transaction_id"] for m in facts.ce3_matches] == ["TXN-300", "TXN-200"]
    assert facts.ce3_matches[0]["matched_on"] == (
        "ip_hash+device_id_hash+account_login_id_hash+shipping_address_hash"
    )


def test_ip_or_device_alone_is_not_enough() -> None:
    # The old rule (ip_hit OR device_hit) would have accepted this pair.
    history = [
        _card_txn(
            "A",
            200 * DAY,
            device_fingerprint="dev-other",
            account_login_id_hash="x",
            shipping_address_hash="y",
        ),
        _card_txn(
            "B",
            300 * DAY,
            client_ip="198.51.100.99",
            account_login_id_hash="x2",
            shipping_address_hash="y2",
        ),
    ]
    facts = assemble_facts(_card_case(history))
    assert facts.signals["ce3_historical_match"] is False
    assert facts.ce3_proof["veto_code"] == "VETO_CE3_MISSING_PRIMARY_ANCHOR"


@pytest.mark.parametrize(
    "seconds,verified",
    [
        (120 * DAY - 1, False),  # 119d 23h 59m 59s
        (120 * DAY, True),
        (365 * DAY, True),
        (365 * DAY + 1, False),
    ],
)
def test_ce3_window_is_second_precise(seconds: int, verified: bool) -> None:
    facts = assemble_facts(_card_case([_card_txn("EDGE", seconds), _card_txn("MID", 200 * DAY)]))
    assert facts.ce3_proof["verified"] is verified
    if not verified:
        assert facts.ce3_proof["veto_code"] == "VETO_CE3_WINDOW_OUT_OF_RANGE"


def test_status_filter_accepts_captured_and_drops_pending() -> None:
    facts = assemble_facts(
        _card_case(
            [
                _card_txn("CAP", 200 * DAY, status="CAPTURED"),
                _card_txn("DONE", 250 * DAY),
                _card_txn("PEND", 300 * DAY, status="PENDING"),
            ]
        )
    )
    assert {m["transaction_id"] for m in facts.ce3_matches} == {"CAP", "DONE"}


def test_tc40_or_prior_dispute_contaminates_history() -> None:
    facts = assemble_facts(
        _card_case(
            [
                _card_txn("A", 200 * DAY, has_tc40=True),
                _card_txn("B", 300 * DAY, has_prior_dispute=True),
            ]
        )
    )
    assert facts.ce3_proof["veto_code"] == "VETO_CE3_CONTAMINATED_HISTORY"


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
