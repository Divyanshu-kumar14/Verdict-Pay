"""Evidence dossier build + upload, with replay-safe idempotency."""

from __future__ import annotations

import hashlib
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
