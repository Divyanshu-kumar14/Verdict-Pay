"""Simulator gateway: the keyless demo path, asserted exactly.

Every test uses the real SimulatorGateway (never a mock) because this is the
code path a judge runs. Wall-clock appears only where real edges (webhook
tolerance) are under test.
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from app.config import Settings
from app.domain.enums import DisputeChannel, DisputeStage, DisputeStatus
from app.domain.protocols import (
    EvidenceDocument,
    EvidenceSubmission,
    PayPalDisputeRecord,
    PayPalGateway,
    SandboxOrder,
)
from app.errors import UpstreamError
from app.integrations.paypal.simulator import (
    CLIENT_IP,
    DEVICE_FINGERPRINT,
    SimulatorGateway,
    synthetic_transaction_id,
    synthetic_transactions,
)
from app.security import compute_signature

PAYER = "YRZ829104KLA"
PDF_BYTES = b"%PDF-1.4 demo dossier"


@pytest.fixture
def gateway(settings: Settings) -> SimulatorGateway:
    return SimulatorGateway(settings)


async def _open_dispute(
    gateway: SimulatorGateway,
    *,
    amount: str = "99.00",
    reason_code: str = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: DisputeStage = DisputeStage.INQUIRY,
    channel: DisputeChannel = DisputeChannel.INTERNAL,
) -> tuple[SandboxOrder, PayPalDisputeRecord]:
    order = await gateway.create_order(
        payer_id=PAYER, amount=Decimal(amount), description="Pro plan"
    )
    dispute = await gateway.create_sandbox_dispute(
        payer_id=PAYER,
        order_id=order.order_id,
        reason_code=reason_code,
        amount=Decimal(amount),
        stage=stage,
        channel=channel,
    )
    return order, dispute


def _submission(
    dispute_id: str,
    *,
    key: str = "evidence-key-1",
    documents: list[EvidenceDocument] | None = None,
    notes: str = "Signed delivery by the buyer.",
) -> EvidenceSubmission:
    return EvidenceSubmission(
        dispute_id=dispute_id,
        evidence_type="PROOF_OF_DELIVERY",
        notes=notes,
        documents=documents
        if documents is not None
        else [EvidenceDocument(name="dossier.pdf", content=PDF_BYTES)],
        idempotency_key=key,
    )


def _webhook_body(
    dispute_id: str, *, event_id: str = "WH-DISPUTE-1"
) -> bytes:
    payload = {
        "id": event_id,
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource_type": "dispute",
        "summary": "A dispute was created.",
        "resource": {"dispute_id": dispute_id},
    }
    return json.dumps(payload).encode("utf-8")


def _signed_headers(secret: str, raw_body: bytes, *, timestamp: str) -> dict[str, str]:
    return {
        "X-VerdictPay-Timestamp": timestamp,
        "X-VerdictPay-Signature": compute_signature(secret, timestamp, raw_body),
    }


async def test_protocol_conformance(gateway: SimulatorGateway) -> None:
    assert isinstance(gateway, PayPalGateway)
    assert gateway.mode == "LOCAL_SIMULATOR"


async def test_create_order_ids_are_deterministic(settings: Settings) -> None:
    first_gateway = SimulatorGateway(settings)
    second_gateway = SimulatorGateway(settings)

    first = await first_gateway.create_order(
        payer_id=PAYER, amount=Decimal("99.00"), description="Pro plan"
    )
    second = await second_gateway.create_order(
        payer_id=PAYER, amount=Decimal("99.00"), description="Pro plan"
    )

    order_suffix = hashlib.sha256(f"{PAYER}:1".encode()).hexdigest().upper()[:14]
    subscription_suffix = hashlib.sha256(f"sub:{PAYER}:1".encode()).hexdigest().upper()[:10]
    assert first.order_id == second.order_id == f"5O1{order_suffix}"
    assert first.subscription_id == second.subscription_id == f"I-BW{subscription_suffix}"
    # An order is not a payment: it must start CREATED, not COMPLETED.
    assert first.status == "CREATED"
    assert first.lifecycle_stage == "CREATED"
    assert first.approval_url == (
        f"https://sandbox.paypal.com/checkoutnow?token={first.order_id}"
    )
    assert first.amount == Decimal("99.00")
    assert first.currency == "USD"
    assert first.payer_id == PAYER
    assert first.created_at.tzinfo is UTC


async def test_create_order_rejects_invalid_input(gateway: SimulatorGateway) -> None:
    with pytest.raises(UpstreamError, match="invalid_order_amount"):
        await gateway.create_order(payer_id=PAYER, amount=Decimal("0.00"))
    with pytest.raises(UpstreamError, match="invalid_order_amount"):
        await gateway.create_order(payer_id=PAYER, amount=Decimal("-1.00"))
    with pytest.raises(UpstreamError, match="payer_id_required"):
        await gateway.create_order(payer_id="  ", amount=Decimal("99.00"))
    with pytest.raises(UpstreamError, match="invalid_currency"):
        await gateway.create_order(
            payer_id=PAYER, amount=Decimal("99.00"), currency="US"
        )
    with pytest.raises(UpstreamError, match="description_required"):
        await gateway.create_order(
            payer_id=PAYER, amount=Decimal("99.00"), description=" "
        )


async def test_create_sandbox_dispute_shape(gateway: SimulatorGateway) -> None:
    order, dispute = await _open_dispute(gateway)

    assert dispute.dispute_id == "PP-D-40001"
    assert dispute.reason_code == "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    assert dispute.stage is DisputeStage.INQUIRY
    assert dispute.channel is DisputeChannel.INTERNAL
    assert dispute.status is DisputeStatus.OPEN
    assert dispute.amount == Decimal("99.00")
    assert dispute.currency == "USD"
    assert dispute.payer_id == PAYER
    assert dispute.order_id == order.order_id
    assert dispute.subscription_id == order.subscription_id
    assert dispute.seller_response_due_date == dispute.created_at + timedelta(days=10)
    assert dispute.links["send-message"].endswith("/send-message")
    assert dispute.links["make-offer"].endswith("/make-offer")
    assert dispute.links["accept-claim"].endswith("/accept-claim")
    assert "provide-evidence" not in dispute.links


@pytest.mark.parametrize(
    ("stage", "channel", "expected"),
    [
        (
            DisputeStage.INQUIRY,
            DisputeChannel.INTERNAL,
            {"self", "send-message", "make-offer", "accept-claim"},
        ),
        (
            DisputeStage.INQUIRY,
            DisputeChannel.EXTERNAL,
            {"self", "send-message", "make-offer", "accept-claim"},
        ),
        (
            DisputeStage.CHARGEBACK,
            DisputeChannel.INTERNAL,
            {"self", "send-message", "make-offer", "accept-claim", "provide-evidence"},
        ),
        (
            DisputeStage.PRE_ARBITRATION,
            DisputeChannel.EXTERNAL,
            {"self", "accept-claim", "provide-evidence"},
        ),
        (DisputeStage.RESOLVED, DisputeChannel.INTERNAL, {"self"}),
        (DisputeStage.CLOSED, DisputeChannel.INTERNAL, {"self"}),
    ],
)
async def test_links_match_hateoas_law(
    gateway: SimulatorGateway,
    settings: Settings,
    stage: DisputeStage,
    channel: DisputeChannel,
    expected: set[str],
) -> None:
    _order, dispute = await _open_dispute(gateway, stage=stage, channel=channel)

    assert set(dispute.links) == expected
    assert dispute.links["self"] == (
        f"{settings.paypal_api_base}/v1/customer/disputes/{dispute.dispute_id}"
    )
    if stage is DisputeStage.INQUIRY:
        assert "provide-evidence" not in dispute.links
    if stage is DisputeStage.PRE_ARBITRATION:
        assert "send-message" not in dispute.links
        assert "make-offer" not in dispute.links


async def test_full_dispute_lifecycle(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    dispute_id = dispute.dispute_id

    message = await gateway.send_message(dispute_id, "We have server-side logs.")
    assert message.status_code == 200
    assert message.latency_ms == 0
    assert message.body["message_id"] == "MSG-001"
    assert (await gateway.get_dispute(dispute_id)).status is (
        DisputeStatus.WAITING_FOR_SELLER_RESPONSE
    )

    offer = await gateway.make_offer(dispute_id, Decimal("30.00"), "Goodwill offer")
    assert offer.status_code == 200
    assert offer.body["offer_amount"] == {"currency_code": "USD", "value": "30.00"}
    assert offer.body["status"] == "WAITING_FOR_SELLER_RESPONSE"

    evidence = await gateway.provide_evidence(_submission(dispute_id))
    assert evidence.status_code == 200
    assert evidence.body == {
        "dispute_id": dispute_id,
        "evidence_type": "PROOF_OF_DELIVERY",
        "documents": ["dossier.pdf"],
    }
    assert (await gateway.get_dispute(dispute_id)).status is DisputeStatus.UNDER_REVIEW

    required = await gateway.require_evidence(dispute_id)
    assert required.status_code == 200
    assert required.body["dispute_life_cycle_stage"] == "CHARGEBACK"
    escalated = await gateway.get_dispute(dispute_id)
    assert escalated.stage is DisputeStage.CHARGEBACK
    assert "provide-evidence" in escalated.links

    second_evidence = await gateway.provide_evidence(
        _submission(dispute_id, key="evidence-key-2")
    )
    assert second_evidence.status_code == 200

    accepted = await gateway.accept_claim(dispute_id, "Accepted to close the case.")
    assert accepted.status_code == 200
    assert accepted.body["status"] == "RESOLVED"
    assert (await gateway.get_dispute(dispute_id)).status is DisputeStatus.RESOLVED

    assert [call[0] for call in gateway.calls] == [
        "create_order",
        "create_sandbox_dispute",
        "send_message",
        "make_offer",
        "provide_evidence",
        "require_evidence",
        "provide_evidence",
        "accept_claim",
    ]


async def test_get_and_list_disputes_newest_first(gateway: SimulatorGateway) -> None:
    _order, first = await _open_dispute(gateway)
    _order, second = await _open_dispute(gateway)

    listed = await gateway.list_disputes()
    assert [record.dispute_id for record in listed] == [
        second.dispute_id,
        first.dispute_id,
    ]
    assert [record.dispute_id for record in await gateway.list_disputes(page_size=1)] == [
        second.dispute_id
    ]
    with pytest.raises(UpstreamError, match="invalid_page_size"):
        await gateway.list_disputes(page_size=0)
    with pytest.raises(UpstreamError, match="dispute_not_found"):
        await gateway.get_dispute("PP-D-99999")


async def test_send_message_requires_text(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    with pytest.raises(UpstreamError, match="message_required"):
        await gateway.send_message(dispute.dispute_id, "   ")
    with pytest.raises(UpstreamError, match="message_too_long"):
        await gateway.send_message(dispute.dispute_id, "x" * 2001)


async def test_make_offer_rejects_out_of_range(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway, amount="99.00")
    for invalid in (Decimal("0.00"), Decimal("-5.00"), Decimal("99.01")):
        with pytest.raises(UpstreamError, match="invalid_offer_amount"):
            await gateway.make_offer(dispute.dispute_id, invalid, "nope")

    accepted = await gateway.make_offer(
        dispute.dispute_id, Decimal("99.00"), "Full amount"
    )
    assert accepted.body["offer_amount"]["value"] == "99.00"


async def test_provide_evidence_records_documents(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    submission = _submission(
        dispute.dispute_id,
        documents=[
            EvidenceDocument(name="dossier.pdf", content=PDF_BYTES),
            EvidenceDocument(
                name="ledger.csv", content=b"event,hash", content_type="text/csv"
            ),
        ],
    )

    response = await gateway.provide_evidence(submission)

    assert response.body["documents"] == ["dossier.pdf", "ledger.csv"]
    assert response.latency_ms == 0
    assert (await gateway.get_dispute(dispute.dispute_id)).status is (
        DisputeStatus.UNDER_REVIEW
    )
    assert gateway.calls[-1] == (
        "provide_evidence",
        {
            "dispute_id": dispute.dispute_id,
            "idempotency_key": "evidence-key-1",
            "evidence_type": "PROOF_OF_DELIVERY",
            "documents": ["dossier.pdf", "ledger.csv"],
            "bytes": len(PDF_BYTES) + len(b"event,hash"),
        },
    )


async def test_provide_evidence_validation(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    dispute_id = dispute.dispute_id

    with pytest.raises(UpstreamError, match="evidence_documents_required"):
        await gateway.provide_evidence(_submission(dispute_id, documents=[]))
    with pytest.raises(UpstreamError, match="evidence_document_empty"):
        await gateway.provide_evidence(
            _submission(dispute_id, documents=[EvidenceDocument(name="empty.pdf", content=b"")])
        )
    with pytest.raises(UpstreamError, match="evidence_document_name_required"):
        await gateway.provide_evidence(
            _submission(
                dispute_id, documents=[EvidenceDocument(name="  ", content=PDF_BYTES)]
            )
        )
    with pytest.raises(UpstreamError, match="evidence_too_large"):
        await gateway.provide_evidence(
            _submission(
                dispute_id,
                documents=[
                    EvidenceDocument(
                        name="huge.pdf", content=b"x" * (10 * 1024 * 1024 + 1)
                    )
                ],
            )
        )
    with pytest.raises(UpstreamError, match="evidence_notes_too_long"):
        await gateway.provide_evidence(_submission(dispute_id, notes="n" * 2001))
    with pytest.raises(UpstreamError, match="idempotency_key_required"):
        await gateway.provide_evidence(_submission(dispute_id, key="  "))
    with pytest.raises(UpstreamError, match="dispute_not_found"):
        await gateway.provide_evidence(_submission("PP-D-99999"))
    with pytest.raises(UpstreamError, match="evidence_type_required"):
        await gateway.provide_evidence(
            EvidenceSubmission(
                dispute_id=dispute_id,
                evidence_type="  ",
                notes="",
                documents=[EvidenceDocument(name="a.pdf", content=PDF_BYTES)],
                idempotency_key="blank-type",
            )
        )


async def test_provide_evidence_idempotent_replay(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    submission = _submission(dispute.dispute_id)

    first = await gateway.provide_evidence(submission)
    second = await gateway.provide_evidence(submission)

    expected = dict(first.body)
    expected["note"] = "idempotent_replay"
    assert first.body == {
        "dispute_id": dispute.dispute_id,
        "evidence_type": "PROOF_OF_DELIVERY",
        "documents": ["dossier.pdf"],
    }
    assert second.body == expected
    assert second.status_code == first.status_code == 200
    assert [call[0] for call in gateway.calls].count("provide_evidence") == 1
    assert gateway.calls[-1][0] == "provide_evidence_replay"


async def test_require_evidence_escalates_to_chargeback(gateway: SimulatorGateway) -> None:
    _order, dispute = await _open_dispute(gateway)
    assert "provide-evidence" not in dispute.links

    response = await gateway.require_evidence(dispute.dispute_id, action="SELLER_EVIDENCE")

    assert response.body == {
        "dispute_id": dispute.dispute_id,
        "action": "SELLER_EVIDENCE",
        "dispute_life_cycle_stage": "CHARGEBACK",
        "status": "OPEN",
    }
    escalated = await gateway.get_dispute(dispute.dispute_id)
    assert escalated.stage is DisputeStage.CHARGEBACK
    assert "provide-evidence" in escalated.links


async def test_suspend_subscription_known_and_unknown(
    gateway: SimulatorGateway, settings: Settings
) -> None:
    with pytest.raises(UpstreamError, match="subscription_not_found"):
        await gateway.suspend_subscription("I-UNKNOWN", "fraud")

    order, _dispute = await _open_dispute(gateway)
    response = await gateway.suspend_subscription(order.subscription_id, "friendly fraud")

    assert response.status_code == 200
    assert response.body == {
        "subscription_id": order.subscription_id,
        "status": "SUSPENDED",
        "reason": "friendly fraud",
    }
    assert gateway.suspended_subscriptions == {order.subscription_id: "friendly fraud"}
    assert gateway.calls[-1] == (
        "suspend_subscription",
        {"subscription_id": order.subscription_id, "reason": "friendly fraud"},
    )

    demo = await gateway.suspend_subscription(settings.demo_subscription_id, "claim")
    assert demo.body["status"] == "SUSPENDED"


async def test_synthetic_transactions_are_exact() -> None:
    fixed = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)

    records = synthetic_transactions(PAYER, now=fixed)

    assert len(records) == 3
    assert [record.amount for record in records] == [
        Decimal("99.00"),
        Decimal("99.00"),
        Decimal("49.00"),
    ]
    assert [record.created_at for record in records] == [
        fixed - timedelta(days=150),
        fixed - timedelta(days=240),
        fixed - timedelta(days=330),
    ]
    assert records[0].transaction_id == synthetic_transaction_id(PAYER, 150)
    assert records[0].transaction_id == (
        "TXN" + hashlib.sha256(f"{PAYER}150".encode()).hexdigest().upper()[:16]
    )
    assert {record.client_ip for record in records} == {CLIENT_IP}
    assert {record.device_fingerprint for record in records} == {DEVICE_FINGERPRINT}
    assert {record.status for record in records} == {"COMPLETED"}
    assert {record.currency for record in records} == {"USD"}
    assert {record.payer_id for record in records} == {PAYER}


async def test_search_transactions_filters_window(
    settings: Settings,
) -> None:
    fixed = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
    gateway = SimulatorGateway(settings, clock=lambda: fixed)

    mid_window = await gateway.search_transactions(
        payer_id=PAYER,
        start=fixed - timedelta(days=200),
        end=fixed - timedelta(days=100),
    )
    assert [record.transaction_id for record in mid_window] == [
        synthetic_transaction_id(PAYER, 150)
    ]

    full_window = await gateway.search_transactions(
        payer_id=PAYER,
        start=fixed - timedelta(days=400),
        end=fixed,
    )
    assert [record.transaction_id for record in full_window] == [
        synthetic_transaction_id(PAYER, days) for days in (150, 240, 330)
    ]

    empty_window = await gateway.search_transactions(
        payer_id=PAYER,
        start=fixed - timedelta(days=100),
        end=fixed,
    )
    assert empty_window == []

    with pytest.raises(UpstreamError, match="invalid_transaction_window"):
        await gateway.search_transactions(
            payer_id=PAYER, start=fixed, end=fixed - timedelta(days=1)
        )


async def test_verify_webhook_success(gateway: SimulatorGateway, settings: Settings) -> None:
    _order, dispute = await _open_dispute(gateway)
    raw_body = _webhook_body(dispute.dispute_id)
    timestamp = str(int(time.time()))

    verification = await gateway.verify_webhook(
        _signed_headers(settings.verdictpay_webhook_secret, raw_body, timestamp=timestamp),
        raw_body,
    )

    assert verification.verified is True
    assert verification.reason is None
    assert verification.event is not None
    assert verification.event.event_id == "WH-DISPUTE-1"
    assert verification.event.event_type == "CUSTOMER.DISPUTE.CREATED"
    assert verification.event.resource_type == "dispute"
    assert verification.event.summary == "A dispute was created."
    assert verification.event.dispute is not None
    assert verification.event.dispute.dispute_id == dispute.dispute_id
    assert verification.event.dispute.stage is DisputeStage.INQUIRY


async def test_verify_webhook_rejects_tampered_body(
    gateway: SimulatorGateway, settings: Settings
) -> None:
    raw_body = _webhook_body("PP-D-40001")
    timestamp = str(int(time.time()))
    headers = _signed_headers(
        settings.verdictpay_webhook_secret, raw_body, timestamp=timestamp
    )

    tampered = await gateway.verify_webhook(headers, raw_body + b" ")
    assert tampered.verified is False
    assert tampered.reason == "signature_mismatch"

    stale_timestamp = str(int(time.time()) - 301)
    stale_headers = _signed_headers(
        settings.verdictpay_webhook_secret, raw_body, timestamp=stale_timestamp
    )
    stale = await gateway.verify_webhook(stale_headers, raw_body)
    assert stale.verified is False
    assert stale.reason == "timestamp_outside_tolerance"


async def test_verify_webhook_missing_headers_and_unsigned_dev_mode(
    settings: Settings,
) -> None:
    raw_body = _webhook_body("PP-D-40001")

    strict = SimulatorGateway(settings)
    rejected = await strict.verify_webhook({}, raw_body)
    assert rejected.verified is False
    assert rejected.reason == "missing_signature_headers"

    dev_settings = Settings(app_env="local", allow_unsigned_webhooks=True)
    dev_gateway = SimulatorGateway(dev_settings)
    accepted = await dev_gateway.verify_webhook({}, raw_body)
    assert accepted.verified is True
    assert accepted.reason == "unsigned_dev_mode"
    assert accepted.event is not None
    assert accepted.event.event_id == "WH-DISPUTE-1"


async def test_verify_webhook_invalid_json(gateway: SimulatorGateway, settings: Settings) -> None:
    raw_body = b"{not-json"
    timestamp = str(int(time.time()))

    verification = await gateway.verify_webhook(
        _signed_headers(settings.verdictpay_webhook_secret, raw_body, timestamp=timestamp),
        raw_body,
    )

    assert verification.verified is False
    assert verification.reason == "invalid_json"


async def test_hydrate_restores_persisted_cases(
    settings: Settings,
) -> None:
    source = SimulatorGateway(settings)
    order, first = await _open_dispute(source)
    _order, second = await _open_dispute(source)
    assert first.subscription_id == order.subscription_id

    target = SimulatorGateway(settings)
    await target.hydrate([first, second])

    assert target.calls == []
    restored = await target.get_dispute(first.dispute_id)
    assert restored.links == first.links
    assert restored.stage is first.stage
    assert restored.status is first.status
    assert restored.seller_response_due_date == first.seller_response_due_date

    following = await target.create_sandbox_dispute(
        payer_id=PAYER,
        order_id=order.order_id,
        reason_code="UNAUTHORIZED",
        amount=Decimal("99.00"),
    )
    assert following.dispute_id == "PP-D-40003"

    empty_links = replace(first, links={})
    await target.hydrate([empty_links])
    rehydrated = await target.get_dispute(first.dispute_id)
    assert set(rehydrated.links) == {"self", "send-message", "make-offer", "accept-claim"}
    assert (await target.get_dispute(following.dispute_id)).dispute_id == "PP-D-40003"

    suspended = await target.suspend_subscription(order.subscription_id, "restored case")
    assert suspended.body["status"] == "SUSPENDED"

async def test_order_lifecycle_requires_approval_before_capture(settings: Settings) -> None:
    """The simulator must model PayPal: an unapproved order cannot be captured."""
    gateway = SimulatorGateway(settings)
    order = await gateway.create_order(payer_id=PAYER, amount=Decimal("99.00"))
    assert order.lifecycle_stage == "CREATED"

    with pytest.raises(UpstreamError, match="order_not_approved"):
        await gateway.capture_order(order.order_id)

    approved = await gateway.approve_order(order.order_id)
    assert approved.status == "APPROVED"
    assert approved.lifecycle_stage == "APPROVED"

    capture = await gateway.capture_order(order.order_id)
    assert capture.capture_status == "COMPLETED"
    assert capture.completed is True
    assert capture.capture_id and capture.capture_id.startswith("CAP")
    assert capture.amount == Decimal("99.00")

    final = await gateway.get_order(order.order_id)
    assert final.status == "COMPLETED"
    assert final.lifecycle_stage == "CAPTURED"


async def test_get_order_rejects_unknown_id(settings: Settings) -> None:
    gateway = SimulatorGateway(settings)
    with pytest.raises(UpstreamError, match="order_not_found"):
        await gateway.get_order("5O1DOESNOTEXIST")
