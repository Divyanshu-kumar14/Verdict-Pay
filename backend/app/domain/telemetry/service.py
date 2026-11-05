"""Append-only telemetry ledger service.

Every (merchant_id, payer_id) pair owns an independent SHA-256 hash chain. Appends
are serialized by a process-wide asyncio lock registry, and the database unique
constraints (merchant_id, payer_id, sequence) and (merchant_id, event_id) are the
durable backstop, so a forked chain or a duplicate event cannot be committed.

Event identity: every ingested event gets an event_id (the client-supplied value
or a generated one). The id is part of the stored payload, so replays dedupe
against the ledger and verification can rebuild the payload hash from the row
alone.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from weakref import WeakKeyDictionary

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.schemas import (
    ChainVerification,
    CustomerTimeline,
    TelemetryEventIn,
    TelemetryEventOut,
    TimelineSummary,
)
from app.db.base import new_id
from app.db.models import TelemetryLedger
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.hashing import (
    GENESIS_HASH,
    compute_chain_hash,
    payload_hash,
    utc_timestamp,
    verify_rows,
)
from app.errors import ConflictError, ValidationFailedError

FUTURE_TOLERANCE = timedelta(minutes=5)
"""How far ahead of the server clock an occurred_at may be."""

StreamKey = tuple[str, str]
"""(merchant_id, payer_id) identity of one hash-chain stream."""

_STREAM_LOCKS: WeakKeyDictionary[asyncio.AbstractEventLoop, dict[StreamKey, asyncio.Lock]] = (
    WeakKeyDictionary()
)
_UNBOUND_LOCKS: dict[tuple[int, str, str], asyncio.Lock] = {}


def _stream_lock(merchant_id: str, payer_id: str) -> asyncio.Lock:
    """Return the process-wide append lock for one customer stream.

    Locks are scoped per running event loop so a fresh loop (tests, workers)
    never reuses a lock bound to a previous one.
    """
    loop = asyncio.get_running_loop()
    key: StreamKey = (merchant_id, payer_id)
    try:
        locks = _STREAM_LOCKS.setdefault(loop, {})
    except TypeError:
        return _UNBOUND_LOCKS.setdefault((id(loop), merchant_id, payer_id), asyncio.Lock())
    lock = locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        locks[key] = lock
    return lock


@dataclass(frozen=True, slots=True)
class RecordResult:
    """Outcome of one append attempt; created is False for a deduplicated event."""

    row: TelemetryLedger
    created: bool


def build_payload(event: TelemetryEventIn, created_at: datetime) -> dict[str, Any]:
    """Build the canonical ledger payload for one event.

    The payload is the full event dump (JSON mode, unset optionals dropped) plus
    an explicit created_at key carrying the exact UTC timestamp used in the chain
    hash, so the row verifies from its stored payload alone.
    """
    payload = event.model_dump(mode="json", exclude_none=True)
    payload["created_at"] = utc_timestamp(created_at).isoformat()
    return payload


def to_event_out(row: TelemetryLedger) -> TelemetryEventOut:
    """Map a stored ledger row onto the frozen HTTP event contract."""
    return TelemetryEventOut(
        id=row.id,
        event_id=row.event_id,
        event_type=TelemetryEventType(row.event_type),
        paypal_payer_id=row.payer_id,
        sequence=row.sequence,
        client_ip=row.client_ip,
        device_fingerprint=row.device_fingerprint,
        resource_id=row.resource_id,
        resource_sha256=row.resource_hash,
        units_consumed=row.units_consumed,
        prev_hash=row.prev_hash,
        chain_hash=row.chain_hash,
        created_at=utc_timestamp(row.created_at),
    )


def _tos_versions(rows: Sequence[TelemetryLedger]) -> list[str]:
    versions: set[str] = set()
    for row in rows:
        value = (row.payload or {}).get("tos_version")
        if isinstance(value, str) and value:
            versions.add(value)
    return sorted(versions)


def summarize_rows(rows: Sequence[TelemetryLedger]) -> TimelineSummary:
    """Aggregate one customer's ledger rows into the timeline summary contract."""
    ordered = sorted(rows, key=lambda row: row.sequence)
    timestamps = [utc_timestamp(row.created_at) for row in ordered]
    return TimelineSummary(
        first_seen=min(timestamps) if timestamps else None,
        last_seen=max(timestamps) if timestamps else None,
        distinct_ips=len({row.client_ip for row in ordered}),
        distinct_devices=len({row.device_fingerprint for row in ordered}),
        total_units=sum(row.units_consumed for row in ordered),
        assets_delivered=sum(
            1 for row in ordered if row.event_type == TelemetryEventType.ASSET_DELIVERED.value
        ),
        login_count=sum(
            1 for row in ordered if row.event_type == TelemetryEventType.SESSION_AUTH.value
        ),
        tos_versions=_tos_versions(ordered),
    )


class TelemetryService:
    """Reads and appends the merchant-scoped, per-customer telemetry hash chain."""

    def __init__(self, session: AsyncSession, merchant_id: str) -> None:
        self._session = session
        self._merchant_id = merchant_id

    @property
    def merchant_id(self) -> str:
        """Merchant this service is scoped to; every query filters on it."""
        return self._merchant_id

    async def record(self, event: TelemetryEventIn) -> RecordResult:
        """Append one event to its payer's chain, or return the existing row.

        A repeated event_id is not appended twice: the stored row is returned
        with created=False. The append runs under the stream lock so sequences
        stay gapless, and one IntegrityError race is retried after re-reading
        the head.
        """
        created_at = self._resolve_created_at(event.occurred_at)
        stored_event = self._with_event_id(event)
        async with _stream_lock(self._merchant_id, stored_event.paypal_payer_id):
            existing = await self._find_by_event_id(stored_event.event_id)
            if existing is not None:
                return RecordResult(row=existing, created=False)
            try:
                row = await self._append(stored_event, created_at)
            except IntegrityError:
                await self._session.rollback()
                existing = await self._find_by_event_id(stored_event.event_id)
                if existing is not None:
                    return RecordResult(row=existing, created=False)
                try:
                    row = await self._append(stored_event, created_at)
                except IntegrityError as exc:
                    await self._session.rollback()
                    raise ConflictError(
                        "Telemetry append lost the race for a stream sequence."
                    ) from exc
            return RecordResult(row=row, created=True)

    async def record_many(self, events: Sequence[TelemetryEventIn]) -> list[RecordResult]:
        """Append several events in order, preserving duplicates as created=False."""
        results: list[RecordResult] = []
        for event in events:
            results.append(await self.record(event))
        return results

    async def verify(self, payer_id: str) -> ChainVerification:
        """Recompute one customer's chain and report the first broken link."""
        rows = await self._stream(payer_id)
        return verify_rows(rows, payer_id=payer_id, now=datetime.now(UTC))

    async def timeline(self, payer_id: str) -> CustomerTimeline:
        """Return the customer's ordered events, summary aggregates and chain proof."""
        rows = await self._stream(payer_id)
        return CustomerTimeline(
            payer_id=payer_id,
            events=[to_event_out(row) for row in rows],
            summary=summarize_rows(rows),
            chain=verify_rows(rows, payer_id=payer_id, now=datetime.now(UTC)),
        )

    async def summary(self, payer_id: str) -> TimelineSummary:
        """Return only the aggregate summary for one customer."""
        return summarize_rows(await self._stream(payer_id))

    # ------------------------------------------------------------------ internals
    @staticmethod
    def _resolve_created_at(occurred_at: datetime | None) -> datetime:
        if occurred_at is None:
            return datetime.now(UTC)
        created_at = utc_timestamp(occurred_at)
        if created_at - datetime.now(UTC) > FUTURE_TOLERANCE:
            raise ValidationFailedError(
                "occurred_at is more than 5 minutes in the future.",
                details=[
                    {
                        "field": "occurred_at",
                        "message": "occurred_at must not be more than 5 minutes ahead of now.",
                        "code": "future_timestamp",
                    }
                ],
            )
        return created_at

    @staticmethod
    def _with_event_id(event: TelemetryEventIn) -> TelemetryEventIn:
        if event.event_id:
            return event
        return event.model_copy(update={"event_id": new_id("evt_")})

    async def _stream(self, payer_id: str) -> list[TelemetryLedger]:
        result = await self._session.scalars(
            select(TelemetryLedger)
            .where(
                TelemetryLedger.merchant_id == self._merchant_id,
                TelemetryLedger.payer_id == payer_id,
            )
            .order_by(TelemetryLedger.sequence)
        )
        return list(result.all())

    async def _head(self, payer_id: str) -> TelemetryLedger | None:
        return await self._session.scalar(
            select(TelemetryLedger)
            .where(
                TelemetryLedger.merchant_id == self._merchant_id,
                TelemetryLedger.payer_id == payer_id,
            )
            .order_by(TelemetryLedger.sequence.desc())
            .limit(1)
        )

    async def _find_by_event_id(self, event_id: str | None) -> TelemetryLedger | None:
        if event_id is None:
            return None
        return await self._session.scalar(
            select(TelemetryLedger).where(
                TelemetryLedger.merchant_id == self._merchant_id,
                TelemetryLedger.event_id == event_id,
            )
        )

    async def _append(self, event: TelemetryEventIn, created_at: datetime) -> TelemetryLedger:
        head = await self._head(event.paypal_payer_id)
        prev_hash = head.chain_hash if head is not None else GENESIS_HASH
        sequence = head.sequence + 1 if head is not None else 0
        payload = build_payload(event, created_at)
        event_type = event.event_type.value
        row = TelemetryLedger(
            id=new_id("tel_"),
            event_id=event.event_id,
            merchant_id=self._merchant_id,
            payer_id=event.paypal_payer_id,
            order_id=event.paypal_order_id,
            subscription_id=event.paypal_subscription_id,
            event_type=event_type,
            sequence=sequence,
            client_ip=event.client_ip,
            device_fingerprint=event.device_fingerprint,
            resource_id=event.resource_id,
            resource_hash=event.resource_sha256,
            units_consumed=event.units_consumed,
            payload=payload,
            prev_hash=prev_hash,
            chain_hash=compute_chain_hash(
                prev_hash=prev_hash,
                event_type=event_type,
                payer_id=event.paypal_payer_id,
                created_at=created_at,
                payload_hash=payload_hash(payload),
            ),
            created_at=created_at,
        )
        self._session.add(row)
        await self._session.commit()
        return row
