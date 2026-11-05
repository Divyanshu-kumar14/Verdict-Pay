"""PayPal webhook verification, replay safety and case creation."""

from __future__ import annotations

import json
from datetime import UTC, datetime

from app.security import compute_signature


def _payload(
    *,
    dispute_id: str,
    event_id: str,
    payer_id: str,
    order_id: str,
    amount: str = "49.00",
    stage: str = "INQUIRY",
    channel: str = "INTERNAL",
    status: str = "OPEN",
    reason: str = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
) -> dict:
    base = f"https://api-m.sandbox.paypal.com/v1/customer/disputes/{dispute_id}"
    return {
        "id": event_id,
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource_type": "dispute",
        "summary": "A dispute was created",
        "resource": {
            "dispute_id": dispute_id,
            "reason": reason,
            "dispute_life_cycle_stage": stage,
            "dispute_channel": channel,
            "status": status,
            "dispute_amount": {"currency_code": "USD", "value": amount},
            "payer": {"payer_id": payer_id},
            "seller_transaction_id": order_id,
            "seller_response_due_date": "2026-11-16T00:00:00Z",
            "create_time": "2026-11-06T00:00:00Z",
            "links": [
                {"rel": "self", "href": base},
                {"rel": "send-message", "href": f"{base}/send-message"},
                {"rel": "make-offer", "href": f"{base}/make-offer"},
                {"rel": "accept-claim", "href": f"{base}/accept-claim"},
            ],
        },
    }


def _body(payload: dict) -> bytes:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def _headers(settings, body: bytes, *, secret: str | None = None) -> dict[str, str]:
    timestamp = str(int(datetime.now(UTC).timestamp()))
    signature = compute_signature(secret or settings.verdictpay_webhook_secret, timestamp, body)
    return {"X-VerdictPay-Timestamp": timestamp, "X-VerdictPay-Signature": signature}


async def test_signed_webhook_creates_case(client) -> None:
    settings = client.settings
    body = _body(
        _payload(
            dispute_id="PP-D-99001",
            event_id="WH-TEST-0001",
            payer_id="PAYER-WEBHOOK-01",
            order_id="5O1WEBHOOKORDER01",
        )
    )
    response = await client.post(
        "/api/v1/webhooks/paypal", content=body, headers=_headers(settings, body)
    )
    assert response.status_code == 200
    assert response.json() == {
        "received": True,
        "event_id": "WH-TEST-0001",
        "duplicate": False,
        "dispute_id": "PP-D-99001",
    }

    detail = (await client.get("/api/v1/disputes/PP-D-99001")).json()
    assert detail["amount_usd"] == "49.00"
    assert detail["stage"] == "INQUIRY"
    assert detail["channel"] == "INTERNAL"
    assert detail["status"] == "OPEN"
    assert detail["payer_id"] == "PAYER-WEBHOOK-01"
    assert detail["order_id"] == "5O1WEBHOOKORDER01"
    assert detail["subscription_suspended"] is False
    assert detail["recommended_action"] == "MAKE_OFFER"
    assert detail["facts"]["event_count"] == 0
    assert detail["facts"]["chain_valid"] is True


async def test_replayed_event_is_duplicate_and_creates_nothing(client) -> None:
    settings = client.settings
    payload = _payload(
        dispute_id="PP-D-99002",
        event_id="WH-TEST-0002",
        payer_id="PAYER-WEBHOOK-02",
        order_id="5O1WEBHOOKORDER02",
    )
    body = _body(payload)
    headers = _headers(settings, body)

    first = await client.post("/api/v1/webhooks/paypal", content=body, headers=headers)
    second = await client.post("/api/v1/webhooks/paypal", content=body, headers=headers)

    assert first.status_code == 200
    assert first.json()["duplicate"] is False
    assert second.status_code == 200
    assert second.json() == {
        "received": True,
        "event_id": "WH-TEST-0002",
        "duplicate": True,
        "dispute_id": "PP-D-99002",
    }

    listing = (await client.get("/api/v1/disputes")).json()
    assert listing["meta"]["total"] == 1
    detail = (await client.get("/api/v1/disputes/PP-D-99002")).json()
    assert detail["actions"] == []


async def test_bad_signature_is_401_envelope(client) -> None:
    settings = client.settings
    body = _body(
        _payload(
            dispute_id="PP-D-99003",
            event_id="WH-TEST-0003",
            payer_id="PAYER-WEBHOOK-03",
            order_id="5O1WEBHOOKORDER03",
        )
    )
    response = await client.post(
        "/api/v1/webhooks/paypal",
        content=body,
        headers=_headers(settings, body, secret="not-the-secret"),
    )
    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "webhook_verification_failed"
    assert error["message"] == "signature_mismatch"

    listing = (await client.get("/api/v1/disputes")).json()
    assert listing["meta"]["total"] == 0


async def test_unsigned_webhook_is_401_when_not_allowed(client) -> None:
    body = _body(
        _payload(
            dispute_id="PP-D-99004",
            event_id="WH-TEST-0004",
            payer_id="PAYER-WEBHOOK-04",
            order_id="5O1WEBHOOKORDER04",
        )
    )
    response = await client.post("/api/v1/webhooks/paypal", content=body)
    assert response.status_code == 401
    error = response.json()["error"]
    assert error["code"] == "webhook_verification_failed"
    assert error["message"] == "missing_signature_headers"


async def test_webhook_for_known_dispute_updates_the_same_case(client) -> None:
    settings = client.settings
    created = (
        await client.post(
            "/api/v1/sandbox/dispute",
            json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T"},
        )
    ).json()["dispute"]
    body = _body(
        _payload(
            dispute_id=created["dispute_id"],
            event_id="WH-TEST-0005",
            payer_id="YRZ829104KLA",
            order_id="5O190127TN364715T",
            amount="99.00",
        )
    )
    response = await client.post(
        "/api/v1/webhooks/paypal", content=body, headers=_headers(settings, body)
    )
    assert response.status_code == 200
    assert response.json()["dispute_id"] == created["dispute_id"]

    listing = (await client.get("/api/v1/disputes")).json()
    assert listing["meta"]["total"] == 1
    detail = (await client.get(f"/api/v1/disputes/{created['dispute_id']}")).json()
    assert detail["amount_usd"] == "99.00"
    assert detail["subscription_suspended"] is True


async def test_malformed_json_is_401(client) -> None:
    settings = client.settings
    body = b"{not-json"
    response = await client.post(
        "/api/v1/webhooks/paypal", content=body, headers=_headers(settings, body)
    )
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "invalid_json"
