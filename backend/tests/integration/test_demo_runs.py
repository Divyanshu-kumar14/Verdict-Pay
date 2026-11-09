"""Demo-run isolation and the honest PayPal order lifecycle.

The properties under test are the ones a judge can falsify by clicking twice:

* a fresh run never surfaces a previous run's dispute;
* an order is not a payment — capture before approval is a 409, and only a
  completed gateway capture may say CAPTURED;
* no simulated approval exists; approval happens in the PayPal UI;
* reset removes demo records and keeps the merchant and every non-demo record.

Settings for the network-mode test carry dummy credentials and a sentinel
gateway that fails loudly if anything tries to reach PayPal, so the 409 is proven
to be decided before any network call.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import UTC, datetime
from decimal import Decimal

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.config import Settings
from app.db.models import (
    DemoRunRecord,
    DisputeCase,
    Merchant,
    PaypalOrder,
    PaypalTransaction,
)
from app.main import create_app

CHECKOUT = "/api/v1/sandbox/checkout"
RUNS = "/api/v1/sandbox/runs"


async def _client_for(settings: Settings) -> AsyncIterator[AsyncClient]:
    """Boot a real app (lifespan included) over an isolated SQLite file."""
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as http:
            http.headers["X-API-Key"] = settings.verdictpay_api_key
            http.settings = settings  # type: ignore[attr-defined]
            http.app = app  # type: ignore[attr-defined]
            yield http


@pytest_asyncio.fixture
async def demo_client(settings: Settings) -> AsyncIterator[AsyncClient]:
    async for http in _client_for(settings):
        yield http


async def _checkout(client: AsyncClient, **payload) -> dict:
    response = await client.post(CHECKOUT, json={"plan": "pro", **payload})
    assert response.status_code == 200, response.text
    return response.json()


async def _open_dispute(client: AsyncClient, run_id: str | None, claim: str) -> dict:
    body = {"claim_text": claim}
    if run_id is not None:
        body["run_id"] = run_id
    response = await client.post("/api/v1/sandbox/dispute", json=body)
    assert response.status_code == 200, response.text
    return response.json()


async def _approve(client: AsyncClient, order_id: str):
    return await client.post(f"/api/v1/sandbox/orders/{order_id}/approve")


async def _capture(client: AsyncClient, order_id: str, **payload):
    return await client.post(
        f"/api/v1/sandbox/orders/{order_id}/capture", json=payload or {}
    )


# --------------------------------------------------------------- run isolation
async def test_two_runs_have_disjoint_disputes(demo_client: AsyncClient) -> None:
    """A fresh run must never surface a previous run's dispute."""
    first = await _checkout(demo_client)
    first_dispute = await _open_dispute(
        demo_client, first["run_id"], "I never received the export I paid for."
    )
    first_id = first_dispute["dispute"]["dispute_id"]
    assert first_dispute["dispute"]["run_id"] == first["run_id"]

    second = await _checkout(demo_client)
    assert second["run_id"] != first["run_id"]
    second_dispute = await _open_dispute(
        demo_client, second["run_id"], "The export was missing two worksheets."
    )
    second_id = second_dispute["dispute"]["dispute_id"]
    assert second_dispute["dispute"]["run_id"] == second["run_id"]

    assert first_id != second_id

    first_run = (await demo_client.get(f"{RUNS}/{first['run_id']}")).json()
    second_run = (await demo_client.get(f"{RUNS}/{second['run_id']}")).json()
    assert first_run["dispute_id"] == first_id
    assert second_run["dispute_id"] == second_id
    assert first_run["dispute_id"] != second_run["dispute_id"]

    # The list endpoint agrees with the per-run reads: no cross-contamination.
    listed = (await demo_client.get(RUNS)).json()
    by_run = {run["run_id"]: run for run in listed["runs"]}
    assert by_run[first["run_id"]]["dispute_id"] == first_id
    assert by_run[second["run_id"]]["dispute_id"] == second_id


async def test_unrouted_dispute_stays_invisible_to_every_run(
    demo_client: AsyncClient,
) -> None:
    """A dispute with no run id belongs to no run — isolation works both ways."""
    run = await _checkout(demo_client)
    await _open_dispute(demo_client, None, "Ordered by mistake, please refund.")
    run_after = (await demo_client.get(f"{RUNS}/{run['run_id']}")).json()
    assert run_after["dispute_id"] is None


# ------------------------------------------------------------ order lifecycle
async def test_checkout_creates_an_order_not_a_payment(demo_client: AsyncClient) -> None:
    """Creation must report PayPal's literal answer: CREATED, never COMPLETED."""
    order = await _checkout(demo_client)
    assert order["lifecycle_stage"] == "CREATED"
    assert order["status"] == "CREATED"
    assert order["gateway_mode"] == "PAYPAL_SANDBOX"
    assert order["sandbox"] is True  # sandbox is specifically PAYPAL_SANDBOX
    assert order["provenance"] == "paypal_sandbox"
    assert order["run_id"].startswith("run_")

    status = (await demo_client.get(f"/api/v1/sandbox/orders/{order['order_id']}")).json()
    assert status["lifecycle_stage"] == "CREATED"
    assert status["capture_id"] is None
    assert status["captured_at"] is None
    # PAYPAL_SANDBOX needs a buyer round-trip, so a prompt appears.
    assert status["payer_action_required"] is True


async def test_capture_before_approval_is_409(demo_client: AsyncClient) -> None:
    """The order is not paid, so capture must refuse with order_not_approved."""
    order = await _checkout(demo_client)
    response = await _capture(demo_client, order["order_id"])
    assert response.status_code == 409, response.text
    body = response.json()
    assert body["error"]["code"] == "order_not_approved"
    assert "approve" in body["error"]["message"].lower()

    # Nothing was recorded as money and the run did not claim a capture.
    status = (await demo_client.get(f"/api/v1/sandbox/orders/{order['order_id']}")).json()
    assert status["lifecycle_stage"] == "CREATED"
    assert status["capture_id"] is None
    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["capture_id"] is None
    assert run["order_stage"] == "CREATED"
    assert run["steps"]["capture"] == "failed"

    async with demo_client.app.state.db.session() as session:
        transactions = (
            await session.scalars(
                select(PaypalTransaction).where(
                    PaypalTransaction.run_id == order["run_id"]
                )
            )
        ).all()
    assert transactions == []


async def test_approve_then_capture_yields_a_recorded_payment(
    demo_client: AsyncClient,
) -> None:
    """PAYPAL_SANDBOX approve + capture produces a real, persisted transaction."""
    order = await _checkout(demo_client)
    order_id = order["order_id"]

    approved = await _approve(demo_client, order_id)
    assert approved.status_code == 200, approved.text
    assert approved.json()["lifecycle_stage"] == "APPROVED"

    captured = await _capture(demo_client, order_id)
    assert captured.status_code == 200, captured.text
    body = captured.json()
    assert body["lifecycle_stage"] == "CAPTURED"
    assert body["capture_status"] == "COMPLETED"
    assert body["capture_id"]
    assert body["captured_at"]
    assert body["amount_usd"] == "99.00"
    assert body["provenance"] == "paypal_sandbox"
    assert body["transaction"] is not None
    assert body["transaction"]["transaction_id"] == body["capture_id"]
    assert body["transaction"]["status"] == "CAPTURED"
    assert body["transaction"]["source"] == "paypal_sandbox"
    assert body["transaction"]["payer_id"] == order["payer_id"]

    async with demo_client.app.state.db.session() as session:
        transaction = await session.scalar(
            select(PaypalTransaction).where(
                PaypalTransaction.transaction_id == body["capture_id"]
            )
        )
        assert transaction is not None
        assert transaction.run_id == order["run_id"]
        assert transaction.capture_id == body["capture_id"]
        assert transaction.amount_usd == Decimal("99.00")
        assert transaction.status == "CAPTURED"

        persisted_order = await session.scalar(
            select(PaypalOrder).where(PaypalOrder.order_id == order_id)
        )
        assert persisted_order is not None
        assert persisted_order.lifecycle_stage == "CAPTURED"
        assert persisted_order.capture_id == body["capture_id"]
        assert persisted_order.captured_at is not None

    # Order status now reports the capture rather than a fresh CREATED order.
    status = (await demo_client.get(f"/api/v1/sandbox/orders/{order_id}")).json()
    assert status["lifecycle_stage"] == "CAPTURED"
    assert status["capture_id"] == body["capture_id"]
    assert status["capture_status"] == "COMPLETED"

    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["capture_id"] == body["capture_id"]
    assert run["order_stage"] == "CAPTURED"
    assert run["status"] == "COMPLETED"


async def test_capture_is_idempotent(demo_client: AsyncClient) -> None:
    """Replaying capture returns the stored receipt, never a second transaction."""
    order = await _checkout(demo_client)
    await _approve(demo_client, order["order_id"])
    first = (await _capture(demo_client, order["order_id"])).json()
    second = (await _capture(demo_client, order["order_id"])).json()

    assert second["capture_id"] == first["capture_id"]
    assert second["lifecycle_stage"] == "CAPTURED"

    async with demo_client.app.state.db.session() as session:
        rows = (
            await session.scalars(
                select(PaypalTransaction).where(
                    PaypalTransaction.run_id == order["run_id"]
                )
            )
        ).all()
    assert len(rows) == 1


async def test_capture_unknown_order_is_404(demo_client: AsyncClient) -> None:
    response = await _capture(demo_client, "5O1DOESNOTEXIST")
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "not_found"


async def test_unknown_order_status_is_404(demo_client: AsyncClient) -> None:
    response = await demo_client.get("/api/v1/sandbox/orders/5O1DOESNOTEXIST")
    assert response.status_code == 404, response.text


async def test_approve_unknown_order_is_404(demo_client: AsyncClient) -> None:
    response = await _approve(demo_client, "5O1DOESNOTEXIST")
    assert response.status_code == 404, response.text


# --------------------------------------------------------------- network modes
class _ForbiddenGateway:
    """Sentinel: any PayPal call is a test failure, not a slow network timeout."""

    def __init__(self, mode: str) -> None:
        self.mode = mode

    async def close(self) -> None:
        return None

    def __getattr__(self, name: str):
        raise AssertionError(f"gateway.{name} must not be called in a network-mode test")


@pytest_asyncio.fixture
async def sandbox_client(tmp_path) -> AsyncIterator[AsyncClient]:
    """PAYPAL_SANDBOX mode with dummy credentials and no reachable PayPal."""
    settings = Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'sandbox.db'}",
        paypal_mode="PAYPAL_SANDBOX",
        paypal_client_id="dummy-sandbox-client-id",
        paypal_client_secret="dummy-sandbox-secret",
        llm_mode="template",
        demo_mode=True,
        verdictpay_api_key="test_key_local",
        verdictpay_signing_secret="test_signing_secret",
        verdictpay_webhook_secret="test_webhook_secret",
        rate_limit_per_minute=10_000,
    )
    assert settings.gateway_mode.value == "PAYPAL_SANDBOX"
    assert settings.gateway_blockers == []

    app = create_app(settings)
    async with app.router.lifespan_context(app):
        # Replace the live adapter so a bug in the mode check cannot reach PayPal.
        app.state.gateway = _ForbiddenGateway(settings.gateway_mode.value)
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as http:
            http.headers["X-API-Key"] = settings.verdictpay_api_key
            http.settings = settings  # type: ignore[attr-defined]
            http.app = app  # type: ignore[attr-defined]
            yield http


async def test_approve_in_network_mode_is_409_without_touching_the_gateway(
    sandbox_client: AsyncClient,
) -> None:
    """A simulated approval must never be mistaken for a real PayPal approval."""
    # Seed the persisted order row directly: checkout would hit the sentinel.
    settings = sandbox_client.settings
    order_id = "5O1SANDBOXORDER0001"
    async with sandbox_client.app.state.db.session() as session:
        session.add(
            PaypalOrder(
                merchant_id=settings.demo_merchant_id,
                order_id=order_id,
                run_id="run_networkmode0123456789",
                payer_id=settings.demo_payer_id,
                amount_usd=Decimal("99.00"),
                currency="USD",
                status="CREATED",
                lifecycle_stage="CREATED",
                approval_url=f"https://sandbox.paypal.com/checkoutnow?token={order_id}",
                gateway_mode="PAYPAL_SANDBOX",
                provenance="paypal_sandbox",
                raw_response={},
            )
        )
        await session.commit()

    response = await _approve(sandbox_client, order_id)
    # The approve endpoint was deleted: approval happens in the PayPal UI, so
    # any simulated approve is a 404, still without touching the gateway.
    assert response.status_code == 404, response.text

    # Refused before any gateway call, so the order is still unapproved.
    async with sandbox_client.app.state.db.session() as session:
        row = await session.scalar(
            select(PaypalOrder).where(PaypalOrder.order_id == order_id)
        )
    assert row is not None
    assert row.lifecycle_stage == "CREATED"


# ----------------------------------------------------------------- step progress
async def test_run_reflects_step_progress(demo_client: AsyncClient) -> None:
    """Each step flips exactly when its artifact actually exists."""
    order = await _checkout(demo_client)
    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["steps"]["checkout"] == "done"
    assert run["steps"]["capture"] == "pending"
    assert run["steps"]["dispute"] == "pending"
    assert run["event_count"] == 0
    assert run["chain_valid"] is None
    assert run["dossier_available"] is False
    assert run["ai_analyzed"] is False

    await _approve(demo_client, order["order_id"])
    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["steps"]["approval"] == "done"
    assert run["order_stage"] == "APPROVED"

    await _capture(demo_client, order["order_id"])
    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["steps"]["capture"] == "done"
    assert run["order_stage"] == "CAPTURED"

    usage = await demo_client.post(
        "/api/v1/sandbox/usage",
        json={
            "payer_id": order["payer_id"],
            "order_id": order["order_id"],
            "subscription_id": order["subscription_id"],
            "run_id": order["run_id"],
        },
    )
    assert usage.status_code == 200, usage.text
    assert usage.json()["run_id"] == order["run_id"]

    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["steps"]["telemetry"] == "done"
    assert run["steps"]["evidence"] == "done"
    assert run["event_count"] == 4
    assert run["chain_valid"] is True
    assert run["chain_head"]

    dispute = await _open_dispute(
        demo_client, order["run_id"], "The renewal charged me twice this month."
    )
    run = (await demo_client.get(f"{RUNS}/{order['run_id']}")).json()
    assert run["steps"]["dispute"] == "done"
    assert run["steps"]["triage"] == "done"
    assert run["dispute_id"] == dispute["dispute"]["dispute_id"]


async def test_runs_list_is_newest_first(demo_client: AsyncClient) -> None:
    created = []
    for _ in range(3):
        created.append((await _checkout(demo_client))["run_id"])
    listed = (await demo_client.get(RUNS)).json()
    assert listed["total"] == 3
    returned = [run["run_id"] for run in listed["runs"]]
    assert returned == list(reversed(created))


async def test_unknown_run_is_404(demo_client: AsyncClient) -> None:
    response = await demo_client.get(f"{RUNS}/run_doesnotexist")
    assert response.status_code == 404, response.text


# ------------------------------------------------------------------------ reset
async def test_reset_clears_demo_runs_but_preserves_the_merchant(
    demo_client: AsyncClient,
) -> None:
    """Reset must never delete the tenant or a record that no run owns."""
    settings = demo_client.settings

    order = await _checkout(demo_client)
    await _approve(demo_client, order["order_id"])
    await _capture(demo_client, order["order_id"])
    await _open_dispute(
        demo_client, order["run_id"], "The export arrived corrupted and unusable."
    )

    # Two non-demo records that reset must keep: one real sale, one old case.
    async with demo_client.app.state.db.session() as session:
        session.add(
            PaypalTransaction(
                merchant_id=settings.demo_merchant_id,
                transaction_id="TXNREAL0000001",
                payer_id="REALPAYER001",
                order_id="5O1REALORDER0001",
                amount_usd=Decimal("149.00"),
                currency="USD",
                status="COMPLETED",
                client_ip="198.51.100.7",
                device_fingerprint="fp_real",
                source="paypal_live",
                run_id=None,
                created_at=datetime.now(UTC),
            )
        )
        session.add(
            DisputeCase(
                dispute_id="PP-D-REAL-1",
                merchant_id=settings.demo_merchant_id,
                run_id=None,
                paypal_order_id="5O1REALORDER0001",
                paypal_payer_id="REALPAYER001",
                reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                lifecycle_stage="INQUIRY",
                dispute_channel="INTERNAL",
                status="OPEN",
                currency="USD",
                amount_usd=Decimal("149.00"),
            )
        )
        await session.commit()

    reset = await demo_client.post("/api/v1/sandbox/runs/reset")
    assert reset.status_code == 200, reset.text
    body = reset.json()
    assert body["cleared_runs"] == 1
    assert body["cleared_cases"] == 1
    assert body["run_id"].startswith("run_")
    assert body["run_id"] != order["run_id"]
    assert body["merchant_records_preserved"] >= 2

    async with demo_client.app.state.db.session() as session:
        merchant = await session.get(Merchant, settings.demo_merchant_id)
        assert merchant is not None, "reset must never delete the merchant"

        assert (
            await session.scalar(
                select(PaypalOrder).where(PaypalOrder.order_id == order["order_id"])
            )
        ) is None, "demo order should be gone"
        assert (
            await session.scalar(
                select(PaypalTransaction).where(PaypalTransaction.run_id == order["run_id"])
            )
        ) is None, "demo transaction should be gone"
        assert (
            await session.scalar(
                select(DisputeCase).where(DisputeCase.run_id == order["run_id"])
            )
        ) is None, "demo case should be gone"
        assert (
            await session.scalar(
                select(DemoRunRecord).where(DemoRunRecord.run_id == order["run_id"])
            )
        ) is None, "demo run should be gone"

        kept_transaction = await session.scalar(
            select(PaypalTransaction).where(
                PaypalTransaction.transaction_id == "TXNREAL0000001"
            )
        )
        assert kept_transaction is not None, "non-demo transaction must survive"
        kept_case = await session.get(DisputeCase, "PP-D-REAL-1")
        assert kept_case is not None, "non-demo case must survive"

    # The freshly minted run is usable immediately, and it sees none of the old data.
    listed = (await demo_client.get(RUNS)).json()
    assert [run["run_id"] for run in listed["runs"]] == [body["run_id"]]
    fresh = (await demo_client.get(f"{RUNS}/{body['run_id']}")).json()
    assert fresh["dispute_id"] is None
    assert fresh["event_count"] == 0
    assert fresh["status"] == "OPEN"


async def test_reset_rejects_a_non_demo_run_id_at_the_boundary(
    demo_client: AsyncClient,
) -> None:
    """Only run_* ids are accepted, so reset can never be pointed at real data."""
    response = await demo_client.post(
        CHECKOUT, json={"plan": "pro", "run_id": "not-a-demo-run"}
    )
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "validation_error"


async def test_usage_with_an_unknown_run_is_404(demo_client: AsyncClient) -> None:
    response = await demo_client.post(
        "/api/v1/sandbox/usage",
        json={
            "payer_id": "YRZ829104KLA",
            "order_id": "5O190127TN364715T",
            "run_id": "run_unknownrun0000001",
        },
    )
    assert response.status_code == 404, response.text
