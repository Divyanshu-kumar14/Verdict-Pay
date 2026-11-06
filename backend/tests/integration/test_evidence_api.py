"""Evidence dossier build + upload, with replay-safe idempotency."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from app.db.models import DisputeCase


async def _chargeback_case(client) -> dict:
    usage = await client.post(
        "/api/v1/sandbox/usage",
        json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T"},
    )
    assert usage.status_code == 200
    response = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T", "stage": "CHARGEBACK"},
    )
    assert response.status_code == 200
    return response.json()["dispute"]


async def test_chargeback_recommends_provide_evidence(client) -> None:
    dispute = await _chargeback_case(client)
    assert dispute["stage"] == "CHARGEBACK"
    assert dispute["recommended_action"] == "PROVIDE_EVIDENCE"


async def test_dossier_pdf_is_streamed_and_secret_free(client) -> None:
    dispute = await _chargeback_case(client)
    response = await client.get(f"/api/v1/disputes/{dispute['dispute_id']}/dossier.pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.headers["content-disposition"] == (
        f'inline; filename="VerdictPay_Dossier_{dispute["dispute_id"]}.pdf"'
    )
    pdf_bytes = response.content
    assert pdf_bytes.startswith(b"%PDF")
    assert pdf_bytes.rstrip().endswith(b"%%EOF")
    assert len(pdf_bytes) > 2000
    assert client.settings.verdictpay_api_key.encode() not in pdf_bytes

    cached = Path(client.settings.artifacts_dir) / f"{dispute['dispute_id']}.pdf"
    assert cached.exists()
    assert cached.read_bytes() == pdf_bytes
    assert hashlib.sha256(pdf_bytes).hexdigest() == hashlib.sha256(cached.read_bytes()).hexdigest()


async def test_provide_evidence_upload_is_202_and_idempotent(client) -> None:
    dispute = await _chargeback_case(client)
    gateway = client.app.state.gateway
    dispute_id = dispute["dispute_id"]

    first = await client.post(
        f"/api/v1/disputes/{dispute_id}/actions/PROVIDE_EVIDENCE",
        json={"idempotency_key": "evidence-key-1"},
    )
    assert first.status_code == 202
    body = first.json()
    assert body["action"] == "PROVIDE_EVIDENCE"
    assert body["status"] == "EXECUTED"
    assert body["case"]["dossier_available"] is True
    assert body["case"]["status"] == "UNDER_REVIEW"
    assert body["upstream"]["evidence_type"] == "PROOF_OF_FULFILLMENT"
    assert body["upstream"]["documents"] == [f"VerdictPay_Dossier_{dispute_id}.pdf"]

    uploads_after_first = sum(1 for name, _ in gateway.calls if name == "provide_evidence")
    assert uploads_after_first == 1

    replay = await client.post(
        f"/api/v1/disputes/{dispute_id}/actions/PROVIDE_EVIDENCE",
        json={"idempotency_key": "evidence-key-1"},
    )
    assert replay.status_code == 202
    assert replay.json()["action_id"] == body["action_id"]
    uploads_after_replay = sum(1 for name, _ in gateway.calls if name == "provide_evidence")
    assert uploads_after_replay == 1

    async with client.app.state.db.session() as session:
        case = await session.get(DisputeCase, dispute_id)
        assert case is not None
        assert case.dossier_pdf_url == f"/api/v1/disputes/{dispute_id}/dossier.pdf"
        assert case.status == "UNDER_REVIEW"

    detail = (await client.get(f"/api/v1/disputes/{dispute_id}")).json()
    assert detail["dossier_available"] is True
    assert len(detail["actions"]) == 1
    assert detail["actions"][0]["action_id"] == body["action_id"]
    assert detail["actions"][0]["latency_ms"] >= 0


async def test_other_reason_codes_map_to_expected_evidence_type(client) -> None:
    await client.post(
        "/api/v1/sandbox/usage",
        json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T"},
    )
    dispute = (
        await client.post(
            "/api/v1/sandbox/dispute",
            json={
                "payer_id": "YRZ829104KLA",
                "order_id": "5O190127TN364715T",
                "stage": "CHARGEBACK",
                "reason_code": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
            },
        )
    ).json()["dispute"]
    response = await client.post(
        f"/api/v1/disputes/{dispute['dispute_id']}/actions/PROVIDE_EVIDENCE",
        json={"idempotency_key": "snad-key-1"},
    )
    assert response.status_code == 202
    assert response.json()["upstream"]["evidence_type"] == "OTHER"


# --------------------------------------------------------------- dossier integrity
async def _manifest(client, dispute_id: str) -> dict:
    response = await client.get(f"/api/v1/disputes/{dispute_id}/dossier/manifest")
    assert response.status_code == 200, response.text
    return response.json()


async def test_dossier_pdf_carries_the_manifest_hash(client) -> None:
    dispute = await _chargeback_case(client)
    response = await client.get(f"/api/v1/disputes/{dispute['dispute_id']}/dossier.pdf")

    assert response.status_code == 200
    header = response.headers["x-dossier-sha256"]
    assert header == hashlib.sha256(response.content).hexdigest()
    assert len(header) == 64
    int(header, 16)  # 64 hex characters, no prefix


async def test_manifest_hash_equals_hash_of_downloaded_bytes(client) -> None:
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]

    manifest = await _manifest(client, dispute_id)
    pdf = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")

    assert manifest["dispute_id"] == dispute_id
    assert manifest["filename"] == f"VerdictPay_Dossier_{dispute_id}.pdf"
    assert manifest["download_url"] == f"/api/v1/disputes/{dispute_id}/dossier.pdf"
    assert manifest["sha256"] == hashlib.sha256(pdf.content).hexdigest()
    assert manifest["size_bytes"] == len(pdf.content)
    assert len(manifest["sha256"]) == 64
    assert manifest["narrative_source"] == "template"
    assert manifest["chain_valid"] is True
    assert manifest["chain_head"]
    assert manifest["event_count"] >= 1
    assert len(manifest["snapshot_hash"]) == 64

    # Both integrity endpoints agree, and the manifest is stable across calls.
    again = await _manifest(client, dispute_id)
    assert again["sha256"] == manifest["sha256"]
    assert again["generated_at"] == manifest["generated_at"]
    assert again["snapshot_hash"] == manifest["snapshot_hash"]


async def test_manifest_snapshot_hash_is_canonical_json(client) -> None:
    """snapshot_hash must be reproducible from the frozen facts alone."""
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]
    manifest = await _manifest(client, dispute_id)

    async with client.app.state.db.session() as session:
        case = await session.get(DisputeCase, dispute_id)
        assert case is not None
        frozen = case.facts_snapshot["_dossier"]

    canonical = json.dumps(
        frozen["facts"], sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")
    assert hashlib.sha256(canonical).hexdigest() == manifest["snapshot_hash"]


async def test_verify_accepts_an_untouched_dossier(client) -> None:
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]
    await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")

    response = await client.get(f"/api/v1/disputes/{dispute_id}/dossier/verify")
    assert response.status_code == 200
    verification = response.json()

    assert verification["verified"] is True
    assert verification["checks"] == {
        "chain_valid": True,
        "snapshot_present": True,
        "hash_matches": True,
        "size_matches": True,
    }
    assert verification["expected_sha256"] == verification["actual_sha256"]
    assert len(verification["actual_sha256"]) == 64
    detail = verification["detail"]
    assert "Verified" in detail
    assert "byte-identical" in detail
    # Honest wording: determinism, not a legal guarantee.
    assert "not a legal attestation" in detail
    assert "tamper-proof" not in detail.lower()


async def test_verify_detects_a_flipped_byte_in_the_stored_pdf(client) -> None:
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]
    pdf = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")
    expected = await _manifest(client, dispute_id)

    # Simulate tampering: corrupt the cached artefact directly on disk.
    stored = Path(client.settings.artifacts_dir) / f"{dispute_id}.pdf"
    original = stored.read_bytes()
    tampered = bytearray(original)
    tampered[len(tampered) // 2] ^= 0xFF
    stored.write_bytes(bytes(tampered))
    assert stored.read_bytes() != pdf.content

    response = await client.get(f"/api/v1/disputes/{dispute_id}/dossier/verify")
    assert response.status_code == 200
    verification = response.json()

    assert verification["verified"] is False
    assert verification["checks"]["hash_matches"] is False
    assert verification["checks"]["chain_valid"] is True
    assert verification["expected_sha256"] == expected["sha256"]
    assert verification["actual_sha256"] != expected["sha256"]
    assert verification["actual_sha256"] == hashlib.sha256(bytes(tampered)).hexdigest()
    detail = verification["detail"]
    assert "Tampering detected" in detail
    assert "deterministic re-render" in detail
    # Still no legal over-claim after a positive detection.
    assert "not a legal attestation" in detail

    # Restoring the canonical bytes restores the verdict: the check is on bytes.
    stored.write_bytes(original)
    restored = (await client.get(f"/api/v1/disputes/{dispute_id}/dossier/verify")).json()
    assert restored["verified"] is True
    assert restored["checks"]["hash_matches"] is True


async def test_frozen_dossier_survives_a_case_stage_change(client) -> None:
    """The dossier is bound to its frozen snapshot, not to live case state."""
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]
    first = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")
    manifest = await _manifest(client, dispute_id)

    await client.post(
        f"/api/v1/disputes/{dispute_id}/actions/ACCEPT_CLAIM",
        json={"idempotency_key": "accept-after-dossier"},
    )

    second = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")
    assert second.content == first.content
    assert hashlib.sha256(second.content).hexdigest() == manifest["sha256"]
    verification = (await client.get(f"/api/v1/disputes/{dispute_id}/dossier/verify")).json()
    assert verification["verified"] is True


async def test_manifest_and_verify_require_a_known_dispute(client) -> None:
    missing = "PP-D-99999"
    assert (await client.get(f"/api/v1/disputes/{missing}/dossier/manifest")).status_code == 404
    assert (await client.get(f"/api/v1/disputes/{missing}/dossier/verify")).status_code == 404


class _ExplodingNarrative:
    """Simulates any provider-side bug (e.g. a broken Gemini fallback)."""

    mode = "gemini"
    model_name = "exploder"

    async def compose(self, request):
        raise TypeError("facts must be a schemas.CaseFacts instance")


async def test_a_broken_narrative_provider_never_500s_the_dossier(client) -> None:
    """A model/fallback bug degrades to the template, it must not break the PDF."""
    dispute = await _chargeback_case(client)
    dispute_id = dispute["dispute_id"]
    original = client.app.state.narrative
    client.app.state.narrative = _ExplodingNarrative()
    try:
        pdf = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")
        assert pdf.status_code == 200, pdf.text
        assert pdf.content.startswith(b"%PDF")

        manifest = await _manifest(client, dispute_id)
        assert manifest["sha256"] == hashlib.sha256(pdf.content).hexdigest()
        assert manifest["narrative_source"] == "template"

        verification = (await client.get(f"/api/v1/disputes/{dispute_id}/dossier/verify")).json()
        assert verification["verified"] is True
    finally:
        client.app.state.narrative = original
