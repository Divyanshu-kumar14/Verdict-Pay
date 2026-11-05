"""Service-level tests for the append-only telemetry ledger.

These tests run against a real SQLite database (fresh file per test) and the real
TelemetryService; nothing about the hash chain is mocked.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import TelemetryEventIn
from app.config import Settings
from app.db.models import Merchant, TelemetryLedger
from app.db.session import Database
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.hashing import (
    GENESIS_HASH,
    compute_chain_hash,
    payload_hash,
)
from app.domain.telemetry.service import TelemetryService
from app.errors import ValidationFailedError
from app.security import hash_api_key

PAYER_ID = "YRZ829104KLA"
OCCURRED_AT = datetime(2025, 3, 1, 12, 0, tzinfo=UTC)
SECOND_MERCHANT_ID = "mch_second_merchant"


def make_event(**overrides: Any) -> TelemetryEventIn:
    """Build a valid telemetry event; overrides replace the defaults."""
    values: dict[str, Any] = {
        "event_type": TelemetryEventType.SESSION_AUTH,
        "paypal_payer_id": PAYER_ID,
        "client_ip": "203.0.113.7",
        "device_fingerprint": "fp_device_alpha",
        "occurred_at": OCCURRED_AT,
        "event_id": "evt_001",
    }
    values.update(overrides)
    return TelemetryEventIn(**values)


async def ensure_merchant(session: AsyncSession, merchant_id: str, name: str) -> Merchant:
    """Insert a merchant row (the ledger has a foreign key to it)."""
    merchant = Merchant(
        id=merchant_id,
        name=name,
        api_key_hash=hash_api_key(f"secret-for-{merchant_id}"),
    )
    session.add(merchant)
    await session.commit()
    return merchant


async def count_rows(session: AsyncSession, payer_id: str = PAYER_ID) -> int:
    """Count ledger rows for one payer, regardless of merchant."""
    value = await session.scalar(
        select(func.count())
        .select_from(TelemetryLedger)
        .where(TelemetryLedger.payer_id == payer_id)
    )
    return int(value or 0)


@pytest_asyncio.fixture
async def database(settings: Settings) -> AsyncIterator[Database]:
    db = Database(settings.database_url)
    await db.create_all()
    try:
        yield db
    finally:
        await db.dispose()


@pytest_asyncio.fixture
async def session(database: Database, settings: Settings) -> AsyncIterator[AsyncSession]:
    async with database.session() as active:
        await ensure_merchant(active, settings.demo_merchant_id, settings.demo_merchant_name)
        yield active


@pytest_asyncio.fixture
async def service(session: AsyncSession, settings: Settings) -> TelemetryService:
    return TelemetryService(session, settings.demo_merchant_id)


async def test_record_appends_linked_chain(service: TelemetryService) -> None:
    events = [
        make_event(event_id=f"evt_{index:03d}", occurred_at=OCCURRED_AT + timedelta(minutes=index))
        for index in range(3)
    ]

    results = await service.record_many(events)

    assert [result.created for result in results] == [True, True, True]
    rows = [result.row for result in results]
    assert [row.sequence for row in rows] == [0, 1, 2]
    assert rows[0].prev_hash == GENESIS_HASH
    assert rows[1].prev_hash == rows[0].chain_hash
    assert rows[2].prev_hash == rows[1].chain_hash
    assert all(len(row.chain_hash) == 64 for row in rows)
    assert rows[0].payload["event_id"] == "evt_000"
    assert rows[0].payload["event_type"] == "SESSION_AUTH"
    assert rows[0].payload["created_at"] == "2025-03-01T12:00:00+00:00"
    assert rows[1].payload["created_at"] == "2025-03-01T12:01:00+00:00"
    assert rows[1].chain_hash == compute_chain_hash(
        prev_hash=rows[0].chain_hash,
        event_type="SESSION_AUTH",
        payer_id=PAYER_ID,
        created_at=OCCURRED_AT + timedelta(minutes=1),
        payload_hash=payload_hash(rows[1].payload),
    )

    verification = await service.verify(PAYER_ID)
    assert verification.valid is True
    assert verification.event_count == 3
    assert verification.head_hash == rows[2].chain_hash
    assert verification.payer_id == PAYER_ID
    assert verification.broken_at_sequence is None
    assert verification.breaks == []


async def test_payload_contains_full_event_dump(service: TelemetryService) -> None:
    event = make_event(
        event_id="evt_payload",
        event_type=TelemetryEventType.TOS_ACCEPTED,
        tos_version="v2.4-2026-01",
        tos_content_sha256="b" * 64,
        metadata={"sdk": "verdictpay-sdk", "attempt": 1},
    )

    result = await service.record(event)

    assert result.row.payload == {
        "event_type": "TOS_ACCEPTED",
        "paypal_payer_id": PAYER_ID,
        "client_ip": "203.0.113.7",
        "device_fingerprint": "fp_device_alpha",
        "units_consumed": 0,
        "occurred_at": "2025-03-01T12:00:00Z",
        "tos_version": "v2.4-2026-01",
        "tos_content_sha256": "b" * 64,
        "metadata": {"sdk": "verdictpay-sdk", "attempt": 1},
        "event_id": "evt_payload",
        "created_at": "2025-03-01T12:00:00+00:00",
    }
    assert "paypal_order_id" not in result.row.payload
    assert "paypal_subscription_id" not in result.row.payload


async def test_record_generates_event_id_when_missing(service: TelemetryService) -> None:
    result = await service.record(make_event(event_id=None))

    assert result.created is True
    assert result.row.event_id is not None
    assert result.row.event_id.startswith("evt_")
    assert result.row.payload["event_id"] == result.row.event_id


async def test_record_deduplicates_event_id(
    service: TelemetryService, session: AsyncSession
) -> None:
    first = await service.record(make_event(event_id="evt_dupe"))
    second = await service.record(make_event(event_id="evt_dupe", client_ip="198.51.100.9"))

    assert first.created is True
    assert second.created is False
    assert second.row.id == first.row.id
    assert second.row.client_ip == "203.0.113.7"
    assert await count_rows(session) == 1
    verification = await service.verify(PAYER_ID)
    assert verification.event_count == 1
    assert verification.valid is True


async def test_concurrent_records_keep_sequences_gapless(
    service: TelemetryService, session: AsyncSession
) -> None:
    events = [
        make_event(event_id=f"evt_c{index:02d}", occurred_at=OCCURRED_AT + timedelta(seconds=index))
        for index in range(20)
    ]

    results = await asyncio.gather(*(service.record(event) for event in events))

    assert [result.created for result in results] == [True] * 20
    sequences = sorted(result.row.sequence for result in results)
    assert sequences == list(range(20))
    assert len({result.row.id for result in results}) == 20
    assert len({result.row.chain_hash for result in results}) == 20
    assert await count_rows(session) == 20
    verification = await service.verify(PAYER_ID)
    assert verification.valid is True
    assert verification.event_count == 20


async def test_verify_detects_payload_tampered_at_sql_level(
    service: TelemetryService, session: AsyncSession
) -> None:
    results = await service.record_many(
        [
            make_event(event_id=f"evt_{index:03d}", occurred_at=OCCURRED_AT + timedelta(minutes=index))
            for index in range(3)
        ]
    )
    rows = [result.row for result in results]
    tampered_payload = dict(rows[1].payload)
    tampered_payload["units_consumed"] = 99

    await session.execute(
        text("UPDATE telemetry_ledger SET payload = :payload WHERE id = :row_id"),
        {"payload": json.dumps(tampered_payload), "row_id": rows[1].id},
    )
    await session.commit()
    session.expire_all()

    verification = await service.verify(PAYER_ID)

    assert verification.valid is False
    assert verification.broken_at_sequence == 1
    assert len(verification.breaks) == 1
    chain_break = verification.breaks[0]
    assert chain_break.sequence == 1
    assert chain_break.event_id == "evt_001"
    assert chain_break.expected_prev_hash == rows[0].chain_hash
    assert chain_break.actual_prev_hash == rows[0].chain_hash
    assert chain_break.stored_hash == rows[1].chain_hash
    assert chain_break.recomputed_hash != rows[1].chain_hash
    assert verification.head_hash == rows[2].chain_hash


async def test_orm_guard_forbids_updating_a_ledger_row(
    service: TelemetryService, session: AsyncSession
) -> None:
    result = await service.record(make_event(event_id="evt_immutable_update"))
    row = result.row
    row.units_consumed = 5

    with pytest.raises(RuntimeError, match="append-only"):
        await session.commit()

    await session.rollback()


async def test_orm_guard_forbids_deleting_a_ledger_row(
    service: TelemetryService, session: AsyncSession
) -> None:
    result = await service.record(make_event(event_id="evt_immutable_delete"))
    row = result.row

    await session.delete(row)
    with pytest.raises(RuntimeError, match="append-only"):
        await session.commit()

    await session.rollback()
    assert await count_rows(session) == 1


async def test_timeline_summary_exact(service: TelemetryService) -> None:
    await service.record_many(
        [
            make_event(
                event_id="evt_tos",
                event_type=TelemetryEventType.TOS_ACCEPTED,
                tos_version="v2.4-2026-01",
                tos_content_sha256="b" * 64,
                occurred_at=OCCURRED_AT,
            ),
            make_event(
                event_id="evt_login_one",
                event_type=TelemetryEventType.SESSION_AUTH,
                occurred_at=OCCURRED_AT + timedelta(minutes=1),
            ),
            make_event(
                event_id="evt_login_two",
                event_type=TelemetryEventType.SESSION_AUTH,
                client_ip="198.51.100.9",
                device_fingerprint="fp_device_beta",
                occurred_at=OCCURRED_AT + timedelta(minutes=2),
            ),
            make_event(
                event_id="evt_asset",
                event_type=TelemetryEventType.ASSET_DELIVERED,
                client_ip="198.51.100.9",
                device_fingerprint="fp_device_beta",
                resource_id="q3_financial_model.xlsx",
                resource_sha256="a" * 64,
                occurred_at=OCCURRED_AT + timedelta(minutes=3),
            ),
            make_event(
                event_id="evt_usage",
                event_type=TelemetryEventType.USAGE_METERED,
                units_consumed=42000,
                occurred_at=OCCURRED_AT + timedelta(minutes=4),
            ),
        ]
    )

    timeline = await service.timeline(PAYER_ID)

    assert timeline.payer_id == PAYER_ID
    assert len(timeline.events) == 5
    assert [event.sequence for event in timeline.events] == [0, 1, 2, 3, 4]
    assert [event.event_type for event in timeline.events] == [
        TelemetryEventType.TOS_ACCEPTED,
        TelemetryEventType.SESSION_AUTH,
        TelemetryEventType.SESSION_AUTH,
        TelemetryEventType.ASSET_DELIVERED,
        TelemetryEventType.USAGE_METERED,
    ]
    summary = timeline.summary
    assert summary.first_seen == OCCURRED_AT
    assert summary.last_seen == OCCURRED_AT + timedelta(minutes=4)
    assert summary.distinct_ips == 2
    assert summary.distinct_devices == 2
    assert summary.total_units == 42000
    assert summary.assets_delivered == 1
    assert summary.login_count == 2
    assert summary.tos_versions == ["v2.4-2026-01"]
    assert timeline.chain.valid is True
    assert timeline.chain.event_count == 5
    assert timeline.chain.head_hash == timeline.events[4].chain_hash

    standalone = await service.summary(PAYER_ID)
    assert standalone == summary


async def test_verify_unknown_payer_is_valid_and_empty(service: TelemetryService) -> None:
    verification = await service.verify("UNKNOWN_PAYER")

    assert verification.valid is True
    assert verification.event_count == 0
    assert verification.head_hash == GENESIS_HASH
    assert verification.payer_id == "UNKNOWN_PAYER"
    assert verification.broken_at_sequence is None
    assert verification.breaks == []


async def test_occurred_at_far_in_future_is_rejected(
    service: TelemetryService, session: AsyncSession
) -> None:
    future = datetime.now(UTC) + timedelta(minutes=6)

    with pytest.raises(ValidationFailedError) as exc_info:
        await service.record(make_event(event_id="evt_future", occurred_at=future))

    error = exc_info.value
    assert error.code == "validation_error"
    assert error.status_code == 422
    assert error.details == [
        {
            "field": "occurred_at",
            "message": "occurred_at must not be more than 5 minutes ahead of now.",
            "code": "future_timestamp",
        }
    ]
    assert await count_rows(session) == 0


async def test_occurred_at_within_future_tolerance_is_accepted(
    service: TelemetryService,
) -> None:
    within_tolerance = datetime.now(UTC) + timedelta(minutes=4)

    result = await service.record(
        make_event(event_id="evt_near_future", occurred_at=within_tolerance)
    )

    assert result.created is True
    assert result.row.created_at == within_tolerance


async def test_naive_occurred_at_is_treated_as_utc(service: TelemetryService) -> None:
    naive = datetime(2025, 3, 1, 12, 0)

    result = await service.record(make_event(event_id="evt_naive", occurred_at=naive))

    row = result.row
    assert row.created_at == OCCURRED_AT
    assert row.payload["created_at"] == "2025-03-01T12:00:00+00:00"
    assert row.chain_hash == compute_chain_hash(
        prev_hash=GENESIS_HASH,
        event_type="SESSION_AUTH",
        payer_id=PAYER_ID,
        created_at=naive,
        payload_hash=payload_hash(row.payload),
    )


async def test_merchant_scoping_isolates_streams(
    service: TelemetryService, session: AsyncSession, settings: Settings
) -> None:
    await ensure_merchant(session, SECOND_MERCHANT_ID, "Second Merchant")
    other_service = TelemetryService(session, SECOND_MERCHANT_ID)

    first = await service.record(make_event(event_id="evt_merchant_one"))
    second = await other_service.record(
        make_event(event_id="evt_merchant_two", client_ip="198.51.100.9")
    )

    assert first.row.chain_hash != second.row.chain_hash
    own = await service.verify(PAYER_ID)
    other = await other_service.verify(PAYER_ID)
    assert own.event_count == 1
    assert other.event_count == 1
    assert own.head_hash == first.row.chain_hash
    assert other.head_hash == second.row.chain_hash
    assert await count_rows(session) == 2
    assert (await service.timeline(PAYER_ID)).summary.distinct_ips == 1
    assert (await other_service.timeline(PAYER_ID)).summary.distinct_ips == 1
