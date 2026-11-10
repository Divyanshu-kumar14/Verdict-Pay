"""Exact-value tests for the canonical JSON and SHA-256 chain primitives.

Every expected hash below is a literal computed independently with hashlib, so a
change to the frozen serialisation format fails these tests immediately.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from app.db.models import TelemetryLedger
from app.domain.telemetry.hashing import (
    GENESIS_HASH,
    canonical_payload,
    compute_chain_hash,
    payload_hash,
    utc_timestamp,
    verify_rows,
)

MERCHANT_ID = "mch_hash_tests"
PAYER_ID = "YRZ829104KLA"
FIXED_NOW = datetime(2025, 3, 1, 13, 0, tzinfo=UTC)

KNOWN_PAYLOAD: dict[str, Any] = {
    "event_id": "evt_known_vector_0001",
    "event_type": "SESSION_AUTH",
    "payer_id": "YRZ829104KLA",
    "sequence": 0,
    "tos_version": "v2.4-2026-01",
    "units": 42000,
}
KNOWN_CANONICAL = (
    b'{"event_id":"evt_known_vector_0001","event_type":"SESSION_AUTH",'
    b'"payer_id":"YRZ829104KLA","sequence":0,"tos_version":"v2.4-2026-01","units":42000}'
)
KNOWN_PAYLOAD_HASH = "f914c609d353a42d5ca6fc92a5632eabcf1eec83e633b82ed5e9787fd3a37692"
KNOWN_CHAIN_HASH = "229fb23aeb4dcc815dcdd0abc075d28d240c1dc9ca7af0852ac965a6b20f8012"

ROW_CREATED = (
    datetime(2025, 3, 1, 12, 0, tzinfo=UTC),
    datetime(2025, 3, 1, 12, 1, tzinfo=UTC),
    datetime(2025, 3, 1, 12, 2, tzinfo=UTC),
)
ROW_PAYLOADS: tuple[dict[str, Any], ...] = (
    {
        "created_at": "2025-03-01T12:00:00+00:00",
        "event_id": "evt_000",
        "event_type": "SESSION_AUTH",
        "payer_id": PAYER_ID,
        "units": 0,
    },
    {
        "created_at": "2025-03-01T12:01:00+00:00",
        "event_id": "evt_001",
        "event_type": "ASSET_DELIVERED",
        "payer_id": PAYER_ID,
        "units": 0,
    },
    {
        "created_at": "2025-03-01T12:02:00+00:00",
        "event_id": "evt_002",
        "event_type": "USAGE_METERED",
        "payer_id": PAYER_ID,
        "units": 42000,
    },
)
ROW_CHAIN_HASHES = (
    "c0985b9d069f4cf61c08b7944d1437085af4028f7e6853ac0dbda9a8a285ba73",
    "e4a2f9483a56b3c418e8d6e74932e3fd1024c6258397d08bc820abec64ba1e9e",
    "c61e564047a3746e89fd283c0465770d5b299377149bce6d1a62d4675d5e5423",
)
TAMPERED_PAYLOAD_HASH = "b02a740e3f1899d93e499f25982fa4771935ffd9beaee1ef7825f3c1a22d4acf"
TAMPERED_CHAIN_HASH = "49d4567d55a58a45db15ddaab917ee09b514e43b9cb8f5290b0093818bf9b498"


def ledger_row(
    *,
    sequence: int,
    payload: dict[str, Any],
    prev_hash: str,
    chain_hash: str,
    created_at: datetime,
) -> TelemetryLedger:
    """Build an in-memory ledger row with the given chain pointers."""
    return TelemetryLedger(
        id=f"tel_{sequence:04d}",
        event_id=f"evt_{sequence:03d}",
        merchant_id=MERCHANT_ID,
        payer_id=PAYER_ID,
        order_id=None,
        subscription_id=None,
        event_type=str(payload["event_type"]),
        sequence=sequence,
        client_ip="203.0.113.7",
        device_fingerprint="fp_device_alpha",
        resource_id=None,
        resource_hash=None,
        units_consumed=int(payload["units"]),
        payload=payload,
        prev_hash=prev_hash,
        chain_hash=chain_hash,
        created_at=created_at,
    )


def chain_rows() -> list[TelemetryLedger]:
    """Build the three-row reference chain used by the verification tests."""
    rows: list[TelemetryLedger] = []
    prev = GENESIS_HASH
    for index, (payload, chain_hash) in enumerate(zip(ROW_PAYLOADS, ROW_CHAIN_HASHES, strict=True)):
        rows.append(
            ledger_row(
                sequence=index,
                payload=payload,
                prev_hash=prev,
                chain_hash=chain_hash,
                created_at=ROW_CREATED[index],
            )
        )
        prev = chain_hash
    return rows


def test_genesis_hash_is_sixty_four_zeros() -> None:
    assert GENESIS_HASH == "0" * 64
    assert len(GENESIS_HASH) == 64


def test_canonical_payload_known_vector() -> None:
    assert canonical_payload(KNOWN_PAYLOAD) == KNOWN_CANONICAL
    assert payload_hash(KNOWN_PAYLOAD) == KNOWN_PAYLOAD_HASH


def test_canonical_payload_is_key_order_independent() -> None:
    reordered: dict[str, Any] = {}
    for key in reversed(list(KNOWN_PAYLOAD)):
        reordered[key] = KNOWN_PAYLOAD[key]
    assert canonical_payload(reordered) == KNOWN_CANONICAL
    assert payload_hash(reordered) == KNOWN_PAYLOAD_HASH


def test_canonical_payload_preserves_utf8() -> None:
    assert canonical_payload({"name": "café", "z": 1}) == '{"name":"café","z":1}'.encode()


def test_compute_chain_hash_known_vector() -> None:
    assert (
        compute_chain_hash(
            prev_hash=GENESIS_HASH,
            event_type="SESSION_AUTH",
            payer_id=PAYER_ID,
            created_at=datetime(2025, 3, 1, 12, 0, tzinfo=UTC),
            payload_hash=KNOWN_PAYLOAD_HASH,
        )
        == KNOWN_CHAIN_HASH
    )


def test_naive_created_at_hashes_like_utc_aware() -> None:
    aware = datetime(2025, 3, 1, 12, 0, tzinfo=UTC)
    naive = datetime(2025, 3, 1, 12, 0)
    assert utc_timestamp(naive) == aware
    assert compute_chain_hash(
        prev_hash=GENESIS_HASH,
        event_type="SESSION_AUTH",
        payer_id=PAYER_ID,
        created_at=naive,
        payload_hash=KNOWN_PAYLOAD_HASH,
    ) == compute_chain_hash(
        prev_hash=GENESIS_HASH,
        event_type="SESSION_AUTH",
        payer_id=PAYER_ID,
        created_at=aware,
        payload_hash=KNOWN_PAYLOAD_HASH,
    )


def test_verify_rows_valid_chain() -> None:
    verification = verify_rows(chain_rows(), payer_id=PAYER_ID, now=FIXED_NOW)
    assert verification.valid is True
    assert verification.event_count == 3
    assert verification.head_hash == ROW_CHAIN_HASHES[2]
    assert verification.payer_id == PAYER_ID
    assert verification.broken_at_sequence is None
    assert verification.breaks == []
    assert verification.verified_at == FIXED_NOW


def test_verify_rows_defaults_payer_from_stream() -> None:
    verification = verify_rows(chain_rows(), now=FIXED_NOW)
    assert verification.payer_id == PAYER_ID


def test_verify_rows_detects_tampered_payload() -> None:
    rows = chain_rows()
    tampered_payload = dict(ROW_PAYLOADS[1])
    tampered_payload["units"] = 99
    rows[1] = ledger_row(
        sequence=1,
        payload=tampered_payload,
        prev_hash=rows[1].prev_hash,
        chain_hash=rows[1].chain_hash,
        created_at=ROW_CREATED[1],
    )

    verification = verify_rows(rows, payer_id=PAYER_ID, now=FIXED_NOW)

    assert verification.valid is False
    assert verification.broken_at_sequence == 1
    assert len(verification.breaks) == 1
    chain_break = verification.breaks[0]
    assert chain_break.sequence == 1
    assert chain_break.event_id == "evt_001"
    assert chain_break.expected_prev_hash == ROW_CHAIN_HASHES[0]
    assert chain_break.actual_prev_hash == ROW_CHAIN_HASHES[0]
    assert chain_break.stored_hash == ROW_CHAIN_HASHES[1]
    assert chain_break.recomputed_hash == TAMPERED_CHAIN_HASH
    assert payload_hash(tampered_payload) == TAMPERED_PAYLOAD_HASH
    assert verification.head_hash == ROW_CHAIN_HASHES[2]


def test_verify_rows_detects_sequence_gap() -> None:
    rows = [chain_rows()[0], chain_rows()[2]]

    verification = verify_rows(rows, payer_id=PAYER_ID, now=FIXED_NOW)

    assert verification.valid is False
    assert verification.event_count == 2
    assert verification.broken_at_sequence == 2
    chain_break = verification.breaks[0]
    assert chain_break.sequence == 2
    assert chain_break.expected_prev_hash == ROW_CHAIN_HASHES[0]
    assert chain_break.actual_prev_hash == ROW_CHAIN_HASHES[1]
    assert chain_break.stored_hash == ROW_CHAIN_HASHES[2]
    assert chain_break.recomputed_hash == ROW_CHAIN_HASHES[2]


def test_verify_rows_empty_stream_is_valid_genesis() -> None:
    verification = verify_rows([], payer_id="UNKNOWN_PAYER", now=FIXED_NOW)
    assert verification.valid is True
    assert verification.event_count == 0
    assert verification.head_hash == GENESIS_HASH
    assert verification.payer_id == "UNKNOWN_PAYER"
    assert verification.broken_at_sequence is None
    assert verification.breaks == []
