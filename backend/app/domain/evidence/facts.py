"""Immutable fact pack built from telemetry and PayPal history.

Pure function: no SQLAlchemy, no network, no wall clock. The resulting
CaseFacts is the single locked source of truth for the narrative and the PDF
dossier (ADR-003), so identical rows always produce identical facts.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Final

from app.api import schemas
from app.domain.disputes.win_probability import SignalSet, completeness
from app.domain.enums import TelemetryEventType
from app.domain.protocols import PayPalTransactionRecord

_CENTS: Final[Decimal] = Decimal("0.01")
_CE3_MIN_DAYS: Final[int] = 120
_CE3_MAX_DAYS: Final[int] = 365
_CE3_MIN_MATCHES: Final[int] = 2
_MAX_DELIVERIES: Final[int] = 25
_MAX_CE3_MATCHES: Final[int] = 10
_COMPLETED_STATUS: Final[str] = "COMPLETED"

SIGNAL_KEYS: Final[tuple[str, ...]] = (
    "tos_accepted",
    "ip_match",
    "asset_delivered",
    "usage_metered",
    "chain_verified",
    "ce3_historical_match",
)


@dataclass(frozen=True, slots=True)
class TelemetryEventView:
    """A telemetry ledger row flattened for the domain; no SQLAlchemy import."""

    event_type: str
    sequence: int
    client_ip: str
    device_fingerprint: str
    resource_id: str | None
    resource_hash: str | None
    units_consumed: int
    chain_hash: str
    created_at: datetime
    payload: Mapping[str, Any]


@dataclass(frozen=True, slots=True)
class CaseInput:
    """Everything the fact pack needs for one dispute, as immutable values."""

    payer_id: str
    amount_usd: Decimal
    currency: str
    reason_code: str
    stage: str
    merchant_name: str
    events: Sequence[TelemetryEventView]
    transactions: Sequence[PayPalTransactionRecord]
    chain_valid: bool
    now: datetime
    response_due_date: datetime | None = None


def _as_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime (naive values are assumed UTC)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    """Render a datetime as a deterministic ISO-8601 UTC string."""
    return _as_utc(value).isoformat()


def _parse_datetime(value: Any) -> datetime | None:
    """Parse an ISO-8601 string or pass a datetime through; None when invalid."""
    if isinstance(value, datetime):
        return _as_utc(value)
    if isinstance(value, str) and value:
        try:
            return _as_utc(datetime.fromisoformat(value))
        except ValueError:
            return None
    return None


def _money_str(value: Any) -> str:
    """Render money as a two-decimal string, quantized ROUND_HALF_UP."""
    amount = value if isinstance(value, Decimal) else Decimal(str(value))
    return str(amount.quantize(_CENTS, rounding=ROUND_HALF_UP))


def _is_event(event: TelemetryEventView, expected: TelemetryEventType) -> bool:
    """Compare a stored event_type string against a domain enum value."""
    return str(event.event_type) == expected.value


def _most_frequent(values: Sequence[str]) -> str | None:
    """Return the most frequent value, ties broken lexicographically."""
    if not values:
        return None
    counts = Counter(values)
    return min(counts, key=lambda value: (-counts[value], value))


def _tos_event(events: Sequence[TelemetryEventView]) -> TelemetryEventView | None:
    """Return the latest TOS_ACCEPTED event, or None when there is none."""
    latest: TelemetryEventView | None = None
    for event in events:
        if not _is_event(event, TelemetryEventType.TOS_ACCEPTED):
            continue
        if latest is None:
            latest = event
            continue
        if (_as_utc(event.created_at), event.sequence) > (
            _as_utc(latest.created_at),
            latest.sequence,
        ):
            latest = event
    return latest


def _tos_values(
    event: TelemetryEventView | None,
) -> tuple[str | None, str | None, datetime | None]:
    """Extract the accepted ToS version, document hash and acceptance time."""
    if event is None:
        return None, None, None
    payload = event.payload if isinstance(event.payload, Mapping) else {}
    version = payload.get("tos_version") or payload.get("version")
    content_hash = (
        payload.get("tos_content_sha256")
        or payload.get("tos_hash")
        or payload.get("content_sha256")
    )
    accepted_at = _parse_datetime(payload.get("accepted_at")) or _as_utc(event.created_at)
    return (
        str(version) if version else None,
        str(content_hash) if content_hash else None,
        accepted_at,
    )


def _primary_ip(events: Sequence[TelemetryEventView]) -> str | None:
    """Return the checkout IP (the TOS event's IP), else the modal IP."""
    tos = _tos_event(events)
    if tos is not None:
        return tos.client_ip
    return _most_frequent([event.client_ip for event in events])


def _primary_device(events: Sequence[TelemetryEventView]) -> str | None:
    """Return the checkout device, else the modal device fingerprint."""
    tos = _tos_event(events)
    if tos is not None:
        return tos.device_fingerprint
    return _most_frequent([event.device_fingerprint for event in events])


def _login_count(events: Sequence[TelemetryEventView]) -> int:
    """Sum metadata.logins on SESSION_AUTH events, else count those events."""
    sessions = [event for event in events if _is_event(event, TelemetryEventType.SESSION_AUTH)]
    explicit: list[int] = []
    for event in sessions:
        payload = event.payload if isinstance(event.payload, Mapping) else {}
        metadata = payload.get("metadata")
        if not isinstance(metadata, Mapping):
            continue
        logins = metadata.get("logins")
        if isinstance(logins, int) and not isinstance(logins, bool) and logins >= 0:
            explicit.append(logins)
    if explicit:
        return sum(explicit)
    return len(sessions)


def _deliveries(events: Sequence[TelemetryEventView]) -> list[dict[str, Any]]:
    """Return delivered assets newest first, capped at 25 rows."""
    rows: list[dict[str, Any]] = []
    for event in events:
        if not _is_event(event, TelemetryEventType.ASSET_DELIVERED):
            continue
        if not event.resource_hash:
            continue
        rows.append(
            {
                "resource_id": event.resource_id,
                "sha256": event.resource_hash,
                "delivered_at": _iso(event.created_at),
            }
        )
    rows.sort(key=lambda row: (row["delivered_at"], row["sha256"]), reverse=True)
    return rows[:_MAX_DELIVERIES]


def _ce3_matches(
    transactions: Sequence[PayPalTransactionRecord],
    *,
    now: datetime,
    primary_ip: str | None,
    primary_device: str | None,
) -> list[dict[str, Any]]:
    """Find prior completed transactions sharing the payer's IP or device."""
    matches: list[dict[str, Any]] = []
    for transaction in transactions:
        if str(transaction.status) != _COMPLETED_STATUS:
            continue
        created_at = _as_utc(transaction.created_at)
        days_ago = (now - created_at).days
        if days_ago < _CE3_MIN_DAYS or days_ago > _CE3_MAX_DAYS:
            continue
        ip_hit = bool(primary_ip) and transaction.client_ip == primary_ip
        device_hit = bool(primary_device) and (
            transaction.device_fingerprint == primary_device
        )
        if not (ip_hit or device_hit):
            continue
        if ip_hit and device_hit:
            matched_on = "both"
        elif ip_hit:
            matched_on = "ip"
        else:
            matched_on = "device"
        matches.append(
            {
                "transaction_id": transaction.transaction_id,
                "amount_usd": _money_str(transaction.amount),
                "status": str(transaction.status),
                "days_ago": days_ago,
                "matched_on": matched_on,
            }
        )
    matches.sort(key=lambda match: (match["days_ago"], match["transaction_id"]))
    return matches[:_MAX_CE3_MATCHES]


def _chain_head(events: Sequence[TelemetryEventView]) -> str:
    """Return the chain hash of the highest-sequence event, else an empty string."""
    if not events:
        return ""
    head = max(events, key=lambda event: (event.sequence, _as_utc(event.created_at)))
    return head.chain_hash


def _validate(case: CaseInput) -> None:
    """Reject malformed external input before the fact pack is built."""
    if not isinstance(case, CaseInput):
        raise TypeError("case must be a CaseInput instance")
    if not isinstance(case.payer_id, str) or not case.payer_id:
        raise ValueError("payer_id must be a non-empty string")
    if not isinstance(case.amount_usd, Decimal):
        raise TypeError("amount_usd must be a Decimal")
    if case.amount_usd < 0:
        raise ValueError("amount_usd must be non-negative")
    if not case.currency or not case.reason_code or not case.stage:
        raise ValueError("currency, reason_code and stage must be non-empty")
    if not isinstance(case.now, datetime):
        raise TypeError("now must be a datetime")
    if not isinstance(case.events, Sequence) or not isinstance(case.transactions, Sequence):
        raise TypeError("events and transactions must be sequences")


def assemble_facts(case: CaseInput) -> schemas.CaseFacts:
    """Build the immutable, deterministic fact pack for one dispute."""
    _validate(case)
    now = _as_utc(case.now)
    events = list(case.events)

    tos = _tos_event(events)
    tos_version, tos_hash, tos_accepted_at = _tos_values(tos)
    primary_ip = _primary_ip(events)
    primary_device = _primary_device(events)
    deliveries = _deliveries(events)
    usage_units = sum(event.units_consumed for event in events)
    usage_events = sum(1 for event in events if _is_event(event, TelemetryEventType.USAGE_METERED))
    ce3_matches = _ce3_matches(
        case.transactions,
        now=now,
        primary_ip=primary_ip,
        primary_device=primary_device,
    )
    scan_starts = [_as_utc(event.created_at) for event in events]

    signals = SignalSet(
        tos_accepted=tos is not None,
        ip_match=bool(primary_ip)
        and any(
            _is_event(event, TelemetryEventType.SESSION_AUTH)
            and event.client_ip == primary_ip
            for event in events
        ),
        asset_delivered=any(
            _is_event(event, TelemetryEventType.ASSET_DELIVERED) and bool(event.resource_hash)
            for event in events
        ),
        usage_metered=usage_units > 0,
        chain_verified=bool(case.chain_valid),
        ce3_historical_match=len(ce3_matches) >= _CE3_MIN_MATCHES,
    )

    return schemas.CaseFacts(
        payer_id=case.payer_id,
        chain_valid=bool(case.chain_valid),
        chain_head=_chain_head(events),
        event_count=len(events),
        completeness=completeness(signals),
        tos_version=tos_version,
        tos_hash=tos_hash,
        tos_accepted_at=tos_accepted_at,
        first_seen=min(scan_starts) if scan_starts else None,
        last_seen=max(scan_starts) if scan_starts else None,
        ips=sorted({event.client_ip for event in events}),
        devices=sorted({event.device_fingerprint for event in events}),
        deliveries=deliveries,
        usage_units=usage_units,
        usage_events=usage_events,
        login_count=_login_count(events),
        response_due_date=(
            _as_utc(case.response_due_date) if case.response_due_date is not None else None
        ),
        ce3_matches=ce3_matches,
        ce3_window_days=_CE3_MAX_DAYS if ce3_matches else 0,
        signals={key: bool(getattr(signals, key)) for key in SIGNAL_KEYS},
    )
