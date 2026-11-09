"""Order-lifecycle money invariants: an order is not a payment.

The product's central claim is that nothing can mistake "order created" for "money
received". That claim lives in four places at once — the API response, the persisted
``PaypalOrder`` row, the ``PaypalTransaction`` ledger and the reporting read path — so
each test here checks the invariant where it can actually be violated, against the real
SQLite database, not just the JSON.

Coverage mapping (deliberately no duplication)
----------------------------------------------
``tests/integration/test_demo_runs.py`` (demo-api) already proves the happy-path
``capture-before-approve -> approve -> capture`` sequence through the API responses.
``tests/integration/test_webhook_flow.py`` already proves sequential byte-identical
webhook replay. This file therefore covers only the gaps:

* an order that is merely CREATED owns no money — asserted at the ledger, not the body;
* a refused capture leaves the order retryable and writes no ledger row;
* capture is idempotent: replaying it returns the stored receipt and mints exactly one
  transaction;
* the reporting read path reports the captured transaction with its capture id;
* webhook de-duplication keys on ``event_id``, not on the payload — a second delivery of
  the same event id with a *different* body is still a replay and mutates nothing.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy import func, select

from app.db.models import DisputeCase, PaypalOrder, PaypalTransaction, WebhookEventRecord
from app.security import compute_signature


async def _checkout(client, plan: str = "pro") -> dict:
    response = await client.post("/api/v1/sandbox/checkout", json={"plan": plan})
    assert response.status_code == 200, response.text
    return response.json()


async def _ledger(client) -> list[PaypalTransaction]:
    async with client.app.state.db.session() as session:
        return list((await session.scalars(select(PaypalTransaction))).all())


async def _order(client, order_id: str) -> PaypalOrder:
    async with client.app.state.db.session() as session:
        row = await session.scalar(select(PaypalOrder).where(PaypalOrder.order_id == order_id))
    assert row is not None, f"PayPal order {order_id} was never persisted"
    return row


# ------------------------------------------------------------------ create is not money
async def test_created_order_is_not_a_payment(client) -> None:
    """CREATED must never be readable as CAPTURED, and the ledger must stay empty."""
    checkout = await _checkout(client)

    assert checkout["lifecycle_stage"] == "CREATED"
    assert checkout["lifecycle_stage"] != "CAPTURED"
    assert checkout["status"] == "CREATED"
    # The buyer still has to approve, so a real approval URL must be handed out.
    assert checkout["approval_url"].startswith("https://")
    assert checkout["order_id"] in checkout["approval_url"]
    assert checkout["gateway_mode"] == "PAYPAL_SANDBOX"
    assert checkout["provenance"] == "paypal_sandbox"
    assert checkout["run_id"].startswith("run_")

    # The invariant that matters: no ledger row exists for an unpaid order.
    assert await _ledger(client) == []

    row = await _order(client, checkout["order_id"])
    assert row.lifecycle_stage == "CREATED"
    assert row.capture_id is None
    assert row.capture_status is None
    assert row.captured_at is None
    assert row.amount_usd == 99
    assert row.run_id == checkout["run_id"]


async def test_capture_before_approval_is_refused_and_left_retryable(client) -> None:
    """A pre-approval capture is a 409 that persists nothing and blocks nothing."""
    checkout = await _checkout(client)
    order_id = checkout["order_id"]

    refused = await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})
    assert refused.status_code == 409, refused.text
    error = refused.json()["error"]
    assert error["code"] == "order_not_approved"
    # The message must tell the buyer what to do next, not just fail.
    assert "approval_url" in error["message"]

    # Still unpaid, still no ledger row, and the refusal is recorded honestly.
    row = await _order(client, order_id)
    assert row.lifecycle_stage == "CREATED"
    assert row.capture_id is None
    assert row.capture_status == "ORDER_NOT_APPROVED"
    assert await _ledger(client) == []

    # A 409 is retryable: approving afterwards must make the same capture succeed.
    approved = await client.post(f"/api/v1/sandbox/orders/{order_id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["lifecycle_stage"] == "APPROVED"

    captured = await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})
    assert captured.status_code == 200, captured.text
    assert captured.json()["lifecycle_stage"] == "CAPTURED"


# ------------------------------------------------------- capture persists exactly one row
async def test_approve_then_capture_persists_one_transaction_with_capture_id(client) -> None:
    """The full lifecycle, asserted where the money is: the ledger row."""
    checkout = await _checkout(client, plan="scale")
    order_id = checkout["order_id"]

    approved = await client.post(f"/api/v1/sandbox/orders/{order_id}/approve")
    assert approved.status_code == 200
    assert approved.json()["lifecycle_stage"] == "APPROVED"
    assert await _ledger(client) == [], "approval alone must never write a ledger row"

    captured = await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})
    assert captured.status_code == 200, captured.text
    body = captured.json()

    assert body["lifecycle_stage"] == "CAPTURED"
    assert body["capture_status"] == "COMPLETED"
    assert body["amount_usd"] == "299.00"
    capture_id = body["capture_id"]
    assert capture_id, "a completed capture must carry an id"
    # The nested projection and the ledger must agree, or the UI shows two truths.
    assert body["transaction"]["transaction_id"] == capture_id
    assert body["transaction"]["status"] == "CAPTURED"
    assert body["transaction"]["amount_usd"] == "299.00"

    rows = await _ledger(client)
    assert len(rows) == 1
    transaction = rows[0]
    assert transaction.transaction_id == capture_id
    assert transaction.capture_id == capture_id
    assert transaction.order_id == order_id
    assert transaction.status == "CAPTURED"
    assert transaction.amount_usd == 299
    assert transaction.run_id == checkout["run_id"]

    row = await _order(client, order_id)
    assert row.lifecycle_stage == "CAPTURED"
    assert row.status == "COMPLETED"
    assert row.capture_id == capture_id
    assert row.captured_at is not None


async def test_replayed_capture_returns_the_same_receipt_and_does_not_double_charge(client) -> None:
    """Capture is idempotent: the second call is a receipt, never a second payment."""
    checkout = await _checkout(client)
    order_id = checkout["order_id"]
    await client.post(f"/api/v1/sandbox/orders/{order_id}/approve")

    first = await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})
    second = await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})

    assert first.status_code == 200
    assert second.status_code == 200, second.text
    assert second.json()["capture_id"] == first.json()["capture_id"]
    assert second.json()["detail"] == (
        "This order was already captured; the stored receipt is returned."
    )

    rows = await _ledger(client)
    assert len(rows) == 1, "a replayed capture must not mint a second transaction"
    assert rows[0].transaction_id == first.json()["capture_id"]


async def test_captured_transaction_is_visible_on_the_reporting_read_path(client) -> None:
    """The ledger row the capture wrote must reach the reporting contract unchanged."""
    checkout = await _checkout(client)
    order_id = checkout["order_id"]
    await client.post(f"/api/v1/sandbox/orders/{order_id}/approve")
    captured = (await client.post(f"/api/v1/sandbox/orders/{order_id}/capture", json={})).json()

    response = await client.get("/api/v1/reporting/transactions")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 1
    reported = rows[0]
    assert reported["transaction_id"] == captured["capture_id"]
    assert reported["order_id"] == order_id
    assert reported["status"] == "CAPTURED"
    assert reported["amount_usd"] == "99.00"
    assert reported["source"] == "paypal_sandbox"


# ------------------------------------------------------------------ webhook idempotency
def _webhook_payload(*, dispute_id: str, event_id: str, amount: str) -> dict:
    base = f"https://api-m.sandbox.paypal.com/v1/customer/disputes/{dispute_id}"
    return {
        "id": event_id,
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource_type": "dispute",
        "summary": "A dispute was created",
        "resource": {
            "dispute_id": dispute_id,
            "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            "dispute_life_cycle_stage": "INQUIRY",
            "dispute_channel": "INTERNAL",
            "status": "OPEN",
            "dispute_amount": {"currency_code": "USD", "value": amount},
            "payer": {"payer_id": "YRZ829104KLA"},
            "seller_transaction_id": "5O1WEBHOOKLIFECYCLE",
            "seller_response_due_date": "2026-11-16T00:00:00Z",
            "create_time": "2026-11-06T00:00:00Z",
            "links": [{"rel": "self", "href": base}],
        },
    }


def _signed(client, payload: dict) -> tuple[bytes, dict[str, str]]:
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    timestamp = str(int(datetime.now(UTC).timestamp()))
    signature = compute_signature(client.settings.verdictpay_webhook_secret, timestamp, body)
    return body, {"X-VerdictPay-Timestamp": timestamp, "X-VerdictPay-Signature": signature}


async def _count(client, model) -> int:
    async with client.app.state.db.session() as session:
        return int(await session.scalar(select(func.count()).select_from(model)) or 0)


async def test_webhook_replay_keys_on_event_id_not_on_payload(client) -> None:
    """Same event id, DIFFERENT body: still a replay, and it mutates nothing.

    PayPal retries a delivery with the same ``id`` but can re-serialise the resource
    (fresh ``create_time``, adjusted amount). De-duplication must key on the event id
    alone, otherwise a retry would silently overwrite a case the merchant already acted
    on. ``test_webhook_flow.py`` covers byte-identical replay; this covers the case that
    would slip through an implementation that hashed the body.
    """
    first_body, first_headers = _signed(
        client, _webhook_payload(dispute_id="PP-D-LIFECYCLE-1", event_id="WH-LIFECYCLE-1", amount="99.00")
    )
    first = await client.post("/api/v1/webhooks/paypal", content=first_body, headers=first_headers)
    assert first.status_code == 200, first.text
    assert first.json()["duplicate"] is False
    assert first.json()["dispute_id"] == "PP-D-LIFECYCLE-1"

    # A retry of the SAME event, re-serialised with a different amount.
    retry_body, retry_headers = _signed(
        client, _webhook_payload(dispute_id="PP-D-LIFECYCLE-1", event_id="WH-LIFECYCLE-1", amount="49.00")
    )
    retry = await client.post("/api/v1/webhooks/paypal", content=retry_body, headers=retry_headers)
    assert retry.status_code == 200, retry.text
    assert retry.json()["duplicate"] is True
    assert retry.json()["event_id"] == "WH-LIFECYCLE-1"
    assert retry.json()["dispute_id"] == "PP-D-LIFECYCLE-1"

    # One event row, one case, and the case still carries the FIRST delivery's amount.
    assert await _count(client, WebhookEventRecord) == 1
    assert await _count(client, DisputeCase) == 1
    async with client.app.state.db.session() as session:
        case = await session.scalar(select(DisputeCase).where(DisputeCase.dispute_id == "PP-D-LIFECYCLE-1"))
    assert case is not None
    assert case.amount_usd == 99
    detail = (await client.get("/api/v1/disputes/PP-D-LIFECYCLE-1")).json()
    assert detail["amount_usd"] == "99.00"


async def test_distinct_event_ids_for_one_dispute_do_not_multiply_cases(client) -> None:
    """Two different events about one dispute update one case — never two."""
    body, headers = _signed(
        client, _webhook_payload(dispute_id="PP-D-LIFECYCLE-2", event_id="WH-LIFECYCLE-2A", amount="99.00")
    )
    assert (await client.post("/api/v1/webhooks/paypal", content=body, headers=headers)).status_code == 200

    body, headers = _signed(
        client, _webhook_payload(dispute_id="PP-D-LIFECYCLE-2", event_id="WH-LIFECYCLE-2B", amount="99.00")
    )
    second = await client.post("/api/v1/webhooks/paypal", content=body, headers=headers)
    assert second.status_code == 200
    assert second.json()["duplicate"] is False  # a new event, not a replay

    assert await _count(client, WebhookEventRecord) == 2
    assert await _count(client, DisputeCase) == 1
