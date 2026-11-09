"""Dossier tamper-evidence: valid bytes verify, a 1-byte copy fails (FIX 3).

Pure unit test: operates only on in-memory copies. It never writes to the
artifacts directory and never mutates a stored dossier — the integration suite
already covers the on-disk verify path.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from app.api import schemas
from app.db.models import TelemetryLedger
from app.domain.evidence.pdf import DossierInput, render_dossier
from app.domain.telemetry.hashing import (
    GENESIS_HASH,
    compute_chain_hash,
    payload_hash,
    verify_rows,
)
from app.services.evidence_service import (
    DossierRecord,
    canonical_snapshot_bytes,
    sha256_hex,
    snapshot_hash,
)

PAYER = "YRZ829104KLA"
DISPUTE = "PP-D-TAMPER01"


def _facts() -> schemas.CaseFacts:
    return schemas.CaseFacts(
        payer_id=PAYER,
        chain_valid=True,
        chain_head="ab" * 32,
        event_count=4,
        completeness=1.0,
        tos_version="v2.4-2026-01",
        tos_hash="cd" * 32,
        tos_accepted_at=datetime(2026, 2, 19, 10, 0, tzinfo=UTC),
        first_seen=datetime(2026, 2, 19, 12, 0, tzinfo=UTC),
        last_seen=datetime(2026, 2, 22, 12, 0, tzinfo=UTC),
        ips=["203.0.113.7"],
        devices=["fp_device_alpha"],
        deliveries=[
            {
                "resource_id": "q3_financial_model.xlsx",
                "sha256": "ef" * 32,
                "delivered_at": "2026-02-21T12:00:00+00:00",
            }
        ],
        usage_units=42000,
        usage_events=3,
        login_count=5,
        response_due_date=datetime(2026, 3, 8, 12, 0, tzinfo=UTC),
        ce3_matches=[],
        ce3_window_days=365,
        signals={"tos_accepted": True, "chain_verified": True},
    )


def _render(facts: schemas.CaseFacts) -> tuple[bytes, DossierRecord]:
    pdf = render_dossier(
        DossierInput(
            dispute_id=DISPUTE,
            facts=facts,
            narrative="Seller rebuttal grounded in the frozen fact pack.",
            narrative_source="template",
            reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            stage="CHARGEBACK",
            amount_usd=Decimal("99.00"),
            currency="USD",
            merchant_name="Aurora Analytics",
            generated_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
        )
    )
    record = DossierRecord(
        facts=facts.model_dump(mode="json"),
        narrative="Seller rebuttal grounded in the frozen fact pack.",
        narrative_source="template",
        reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        stage="CHARGEBACK",
        amount_usd="99.00",
        currency="USD",
        merchant_name="Aurora Analytics",
        sha256=sha256_hex(pdf),
        size_bytes=len(pdf),
        generated_at=datetime(2026, 3, 1, 12, 0, tzinfo=UTC),
    )
    return pdf, record


def _row(sequence: int, payload: dict, prev: str, created_at: datetime) -> TelemetryLedger:
    return TelemetryLedger(
        id=f"tel_tamper_{sequence:04d}",
        event_id=f"evt_tamper_{sequence:03d}",
        merchant_id="mch_tamper",
        payer_id=PAYER,
        order_id=None,
        subscription_id=None,
        event_type=str(payload["event_type"]),
        sequence=sequence,
        client_ip="203.0.113.7",
        device_fingerprint="fp_device_alpha",
        resource_id=None,
        resource_hash=None,
        units_consumed=0,
        payload=dict(payload),
        prev_hash=prev,
        chain_hash=compute_chain_hash(
            prev_hash=prev,
            event_type=str(payload["event_type"]),
            payer_id=PAYER,
            created_at=created_at,
            payload_hash=payload_hash(payload),
        ),
        created_at=created_at,
    )


def test_valid_dossier_rerender_is_byte_identical() -> None:
    facts = _facts()
    first, record = _render(facts)
    second, _ = _render(facts)

    assert first.startswith(b"%PDF")
    assert second == first  # frozen inputs -> deterministic bytes
    assert sha256_hex(first) == record.sha256
    assert len(record.sha256) == 64
    assert DossierRecord.from_snapshot(record.as_snapshot()) is not None
    assert DossierRecord.from_snapshot(record.as_snapshot()).sha256 == record.sha256


def test_one_byte_tamper_copy_fails_hash_match() -> None:
    pdf, record = _render(_facts())

    tampered = bytearray(pdf)
    tampered[len(tampered) // 2] ^= 0xFF
    tampered_bytes = bytes(tampered)

    assert tampered_bytes != pdf  # the copy, not the original, changed
    assert sha256_hex(tampered_bytes) != record.sha256
    assert sha256_hex(pdf) == record.sha256  # original untouched: still verifies
    assert len(tampered_bytes) == record.size_bytes  # size alone would not catch it


def test_snapshot_hash_is_canonical_and_tamper_sensitive() -> None:
    facts = _facts().model_dump(mode="json")
    assert snapshot_hash(facts) == sha256_hex(canonical_snapshot_bytes(facts))

    tampered = dict(facts)
    tampered["usage_units"] = int(facts["usage_units"]) + 1
    assert snapshot_hash(tampered) != snapshot_hash(facts)
    assert snapshot_hash(dict(facts)) == snapshot_hash(facts)  # original untouched


def test_chain_crypto_valid_verifies_and_tampered_copy_fails() -> None:
    created = (
        datetime(2026, 2, 19, 12, 0, tzinfo=UTC),
        datetime(2026, 2, 19, 12, 1, tzinfo=UTC),
    )
    payloads = [
        {"event_type": "SESSION_AUTH", "payer_id": PAYER, "units": 0},
        {"event_type": "ASSET_DELIVERED", "payer_id": PAYER, "units": 0},
    ]
    rows = [_row(0, payloads[0], GENESIS_HASH, created[0])]
    rows.append(_row(1, payloads[1], rows[0].chain_hash, created[1]))

    valid = verify_rows(rows, payer_id=PAYER)
    assert valid.valid is True
    assert valid.event_count == 2
    assert valid.breaks == []

    # 1-byte-equivalent tamper on a copy: change one payload value, keep stored hash.
    bad_payload = dict(payloads[1])
    bad_payload["units"] = 1
    tampered_rows = [
        rows[0],
        TelemetryLedger(
            id=rows[1].id,
            event_id=rows[1].event_id,
            merchant_id=rows[1].merchant_id,
            payer_id=rows[1].payer_id,
            order_id=None,
            subscription_id=None,
            event_type=rows[1].event_type,
            sequence=rows[1].sequence,
            client_ip=rows[1].client_ip,
            device_fingerprint=rows[1].device_fingerprint,
            resource_id=None,
            resource_hash=None,
            units_consumed=rows[1].units_consumed,
            payload=bad_payload,  # tampered copy
            prev_hash=rows[1].prev_hash,
            chain_hash=rows[1].chain_hash,  # stale stored hash
            created_at=created[1],
        ),
    ]
    broken = verify_rows(tampered_rows, payer_id=PAYER)
    assert broken.valid is False
    assert broken.broken_at_sequence == 1

    # Original rows still verify: the tamper never touched them.
    assert verify_rows(rows, payer_id=PAYER).valid is True
