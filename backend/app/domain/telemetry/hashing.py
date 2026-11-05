"""Canonical JSON and SHA-256 hash-chain primitives for the telemetry ledger.

Chain contract (FROZEN; changing it invalidates every stored row):

    payload_hash = sha256(canonical_json(payload)).hexdigest()
    chain_hash = sha256(
        f"{prev_hash}:{event_type}:{payer_id}:{created_at.isoformat()}:{payload_hash}"
        .encode("utf-8")
    ).hexdigest()

* canonical_json is
  json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
  default=str) encoded as UTF-8, so the same logical payload always hashes to the
  same bytes.
* created_at is normalised to an aware UTC datetime before formatting (naive
  values are interpreted as UTC). That keeps the hash of a freshly written row
  equal to the hash recomputed after the value has round-tripped through SQLite,
  which drops the offset.
* Each customer stream starts at sequence 0 from GENESIS_HASH and every later row
  points at its predecessor's chain_hash.

The functions in this module are pure: no I/O, no wall clock unless the caller
passes one in.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from app.api.schemas import ChainBreak, ChainVerification
from app.db.models import TelemetryLedger

GENESIS_HASH = "0" * 64


def utc_timestamp(value: datetime) -> datetime:
    """Return an aware UTC datetime; naive values are interpreted as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def canonical_payload(payload: Mapping[str, Any]) -> bytes:
    """Encode a payload as deterministic, UTF-8, canonical JSON bytes."""
    return json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    ).encode("utf-8")


def payload_hash(payload: Mapping[str, Any]) -> str:
    """Return the SHA-256 hex digest of the canonical payload bytes."""
    return hashlib.sha256(canonical_payload(payload)).hexdigest()


def compute_chain_hash(
    *,
    prev_hash: str,
    event_type: str,
    payer_id: str,
    created_at: datetime,
    payload_hash: str,
) -> str:
    """Return the SHA-256 hex digest that links a row to its predecessor.

    The hashed material is exactly
    "prev_hash:event_type:payer_id:created_at.isoformat():payload_hash" with
    created_at normalised to UTC first.
    """
    material = (
        f"{prev_hash}:{event_type}:{payer_id}:"
        f"{utc_timestamp(created_at).isoformat()}:{payload_hash}"
    )
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def verify_rows(
    rows: Sequence[TelemetryLedger],
    *,
    payer_id: str | None = None,
    now: datetime | None = None,
) -> ChainVerification:
    """Recompute the chain over rows and report every broken link.

    Rows are ordered by sequence. The first row must open the stream at
    sequence 0 with GENESIS_HASH as its predecessor; each following row must
    point at the previous row's stored chain_hash and continue the sequence
    without a gap. A tampered payload, a broken link or a gap produces one
    ChainBreak on the offending row.

    payer_id is only needed to label a verification of an empty stream, and now
    lets callers keep the output deterministic.
    """
    ordered = sorted(rows, key=lambda row: row.sequence)
    breaks: list[ChainBreak] = []
    expected_prev = GENESIS_HASH
    expected_sequence = 0

    for row in ordered:
        recomputed_hash = compute_chain_hash(
            prev_hash=row.prev_hash,
            event_type=row.event_type,
            payer_id=row.payer_id,
            created_at=row.created_at,
            payload_hash=payload_hash(row.payload),
        )
        if (
            row.sequence != expected_sequence
            or row.prev_hash != expected_prev
            or row.chain_hash != recomputed_hash
        ):
            breaks.append(
                ChainBreak(
                    sequence=row.sequence,
                    event_id=row.event_id or row.id,
                    expected_prev_hash=expected_prev,
                    actual_prev_hash=row.prev_hash,
                    stored_hash=row.chain_hash,
                    recomputed_hash=recomputed_hash,
                )
            )
        expected_prev = row.chain_hash
        expected_sequence = row.sequence + 1

    head_hash = ordered[-1].chain_hash if ordered else GENESIS_HASH
    stream_payer = ordered[0].payer_id if ordered else ""
    resolved_payer = payer_id if payer_id is not None else stream_payer

    return ChainVerification(
        payer_id=resolved_payer,
        valid=not breaks,
        event_count=len(ordered),
        head_hash=head_hash,
        broken_at_sequence=breaks[0].sequence if breaks else None,
        breaks=breaks,
        verified_at=utc_timestamp(now) if now is not None else datetime.now(UTC),
    )
