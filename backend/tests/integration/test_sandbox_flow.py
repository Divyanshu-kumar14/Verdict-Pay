"""End-to-end judge flow: checkout -> usage -> dispute on the real services.

This is the demo contract: three buttons, one hash-chained system of record, one
triage decision, one suspended subscription. No PayPal mocks anywhere.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from itertools import pairwise

from app.db.models import PaypalTransaction
from app.oracle.cliff_engine import full_calendar_months_window


async def _checkout(client, plan: str = "pro") -> dict:
    response = await client.post("/api/v1/sandbox/checkout", json={"plan": plan})
    assert response.status_code == 200
    return response.json()


async def test_checkout_usage_dispute_flow(client) -> None:
    settings = client.settings

    # --- button 1: checkout -------------------------------------------------
    checkout = await _checkout(client)
    assert checkout["amount_usd"] == "99.00"
    assert checkout["currency"] == "USD"
    # Creating an order is NOT a payment. The order starts CREATED and only a
    # verified capture may report CAPTURED — treating creation as completion was
    # the bug that let a judge see a "paid" order nobody had paid for.
    assert checkout["status"] == "CREATED"
    assert checkout["lifecycle_stage"] == "CREATED"
    assert checkout["gateway_mode"] == "PAYPAL_SANDBOX"
    assert checkout["sandbox"] is True
    assert checkout["provenance"] == "paypal_sandbox"
    assert checkout["payer_id"] == settings.demo_payer_id
    assert checkout["order_id"].startswith("5O1")
    assert checkout["subscription_id"].startswith("I-BW")
    assert checkout["approval_url"] == (
        f"https://sandbox.paypal.com/checkoutnow?token={checkout['order_id']}"
    )

    # --- button 2: usage ----------------------------------------------------
    usage_response = await client.post(
        "/api/v1/sandbox/usage",
        json={
            "payer_id": checkout["payer_id"],
            "order_id": checkout["order_id"],
            "subscription_id": checkout["subscription_id"],
        },
    )
    assert usage_response.status_code == 200
    usage = usage_response.json()

    events = usage["events"]
    assert [event["event_type"] for event in events] == [
        "TOS_ACCEPTED",
        "SESSION_AUTH",
        "ASSET_DELIVERED",
        "USAGE_METERED",
    ]
    assert [event["sequence"] for event in events] == [0, 1, 2, 3]
    assert usage["chain"] == {
        "payer_id": checkout["payer_id"],
        "valid": True,
        "event_count": 4,
        "head_hash": events[-1]["chain_hash"],
        "broken_at_sequence": None,
        "breaks": [],
        "verified_at": usage["chain"]["verified_at"],
    }
    for previous, current in pairwise(events):
        assert current["prev_hash"] == previous["chain_hash"]
    assert usage["totals"] == {"logins": 15, "tokens": 42000, "assets": 1}
    assert events[2]["resource_id"] == "q3_financial_model.xlsx"
    assert events[3]["units_consumed"] == 42000

    # the same four events are visible through the customer timeline surface
    timeline = (await client.get(f"/api/v1/customers/{checkout['payer_id']}/timeline")).json()
    assert len(timeline["events"]) == 4
    assert timeline["summary"]["login_count"] == 1
    assert timeline["summary"]["total_units"] == 42000
    assert timeline["summary"]["assets_delivered"] == 1
    assert timeline["summary"]["distinct_ips"] == 1
    assert timeline["summary"]["tos_versions"] == ["v2.4-2026-01"]
    assert timeline["chain"]["valid"] is True

    # --- button 3: dispute --------------------------------------------------
    dispute_response = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": checkout["payer_id"], "order_id": checkout["order_id"]},
    )
    assert dispute_response.status_code == 200
    simulation = dispute_response.json()
    dispute = simulation["dispute"]

    assert dispute["stage"] == "INQUIRY"
    assert dispute["channel"] == "INTERNAL"
    assert dispute["status"] == "OPEN"
    assert dispute["status"] != "UNDER_REVIEW"
    assert dispute["reason_code"] == "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    assert dispute["amount_usd"] == "99.00"
    assert dispute["subscription_id"] == checkout["subscription_id"]
    assert dispute["subscription_suspended"] is True
    assert dispute["recommended_action"] == "DEFLECT_INQUIRY"
    assert dispute["p_win"] == 0.8  # wallet INR: CE 3.0 is card-only (10.4), so 5 of 6 signals
    assert dispute["dossier_available"] is False

    assert simulation["webhook_event_id"] == f"WH-{dispute['dispute_id']}"
    assert simulation["triage_triggered"] is True

    # containment: exact asdict(ContainmentResult) keys, under the 500ms budget
    containment = simulation["containment"]
    assert set(containment) == {
        "attempted",
        "suspended",
        "latency_ms",
        "subscription_id",
        "error",
    }
    assert containment["attempted"] is True
    assert containment["suspended"] is True
    assert containment["subscription_id"] == checkout["subscription_id"]
    assert containment["error"] is None
    assert 0 <= containment["latency_ms"] < 500

    # --- the case room sees the four chained events -------------------------
    detail = (await client.get(f"/api/v1/disputes/{dispute['dispute_id']}")).json()
    assert detail["facts"]["event_count"] == 4
    assert detail["facts"]["chain_valid"] is True
    assert detail["facts"]["completeness"] == 0.8333
    assert detail["facts"]["payer_id"] == checkout["payer_id"]
    assert detail["facts"]["tos_version"] == "v2.4-2026-01"
    assert detail["facts"]["usage_units"] == 42000
    assert detail["facts"]["usage_events"] == 1
    assert detail["facts"]["signals"] == {
        "tos_accepted": True,
        "ip_match": True,
        "asset_delivered": True,
        "usage_metered": True,
        "chain_verified": True,
        # PayPal Wallet INR: Visa CE 3.0 applies to unbranded-card 10.4 only.
        "ce3_historical_match": False,
    }

    assert detail["telemetry_completeness"] == 0.8333
    assert detail["breakdown"]["amount_usd"] == "99.00"
    assert detail["breakdown"]["high_volume"] is False
    assert detail["breakdown"]["high_volume_fee_usd"] == "0.00"
    assert detail["breakdown"]["standard_fee_usd"] == "15.00"
    assert detail["breakdown"]["penalty_ratio_usd"] == "0.00"
    assert detail["breakdown"]["ratio_before"] == 0.0
    assert detail["breakdown"]["ratio_after"] == 0.0  # no net sales, no ratio
    assert detail["breakdown"]["crosses_cliff"] is False
    assert detail["breakdown"]["formula_notes"][0].startswith("hvd_ratio_before=0.000000 (0 ppm)")
    # Standard tier: 0.8 x 0 + 0.2 x -(99 + 15) = -22.80
    assert detail["breakdown"]["ev_fight_usd"] == "-22.80"
    assert detail["breakdown"]["ev_settle_usd"] == "-99.00"
    assert detail["breakdown"]["ev_offer_usd"] == "-29.70"
    assert detail["breakdown"]["best_action"] == "PROVIDE_EVIDENCE"
    assert len(detail["breakdown"]["formula_notes"]) == 8
    assert (
        detail["win_probability"]["score"] == 0.8
    )  # wallet INR: CE 3.0 is card-only (10.4), so 5 of 6 signals
    assert detail["win_probability"]["base"] == 0.10
    assert detail["win_probability"]["signal_sum"] == 0.7
    assert detail["win_probability"]["reason_multiplier"] == 1.0
    assert len(detail["win_probability"]["signals"]) == 6
    assert detail["rationale"][-1]["detail"].startswith("rule=inquiry_deflection")
    assert detail["actions"] == []

    # every datetime leaving the API is UTC-aware (SQLite drops the offset)
    for field in ("created_at", "updated_at", "seller_response_due_date"):
        assert detail[field].endswith(("Z", "+00:00")), field
    assert detail["facts"]["response_due_date"].endswith(("Z", "+00:00"))

    # the ledger survived a round trip through SQLite unchanged
    chain = (await client.get(f"/api/v1/telemetry/chain/{checkout['payer_id']}/verify")).json()
    assert chain["valid"] is True
    assert chain["event_count"] == 4


async def test_checkout_scale_plan_amount(client) -> None:
    checkout = await _checkout(client, plan="scale")
    assert checkout["amount_usd"] == "299.00"
    assert Decimal(checkout["amount_usd"]) == Decimal("299.00")


async def _seed_completed_sales(client, count: int, *, disputed: int = 0) -> None:
    """Insert settled wallet sales inside the HVD window (last full month).

    The first ``disputed`` sales are flagged as countable wallet INR claims.
    """
    settings = client.settings
    _, window_end = full_calendar_months_window(datetime.now(UTC), 3)
    created_at = window_end - timedelta(days=15)
    async with client.app.state.db.session() as session:
        for index in range(count):
            session.add(
                PaypalTransaction(
                    merchant_id=settings.demo_merchant_id,
                    transaction_id=f"TXNSEED{index:06d}",
                    payer_id=settings.demo_payer_id,
                    order_id=None,
                    amount_usd=Decimal("99.00"),
                    currency="USD",
                    status="COMPLETED",
                    client_ip="203.0.113.42",
                    device_fingerprint="fp_89a7c6d5e4f3",
                    source="seed",
                    created_at=created_at,
                    disputed_claim=index < disputed,
                )
            )
        await session.commit()


async def _open_dispute(client) -> dict:
    response = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T"},
    )
    assert response.status_code == 200
    return response.json()["dispute"]


async def test_high_volume_merchant_pays_the_30_usd_fee(client) -> None:
    """HVD is dollar-weighted over 3 full calendar months; $30 replaces $15."""
    # 200 wallet sales of $99 ($19,800) last month; 2 became INR claims ($198, 1.0%).
    await _seed_completed_sales(client, 200, disputed=2)
    inquiry = await _open_dispute(client)
    detail = (await client.get(f"/api/v1/disputes/{inquiry['dispute_id']}")).json()
    breakdown = detail["breakdown"]
    assert breakdown["high_volume"] is False
    assert breakdown["ratio_before_ppm"] == 10_000
    # Escalating this $99 inquiry would add $99: 297 / 19,800 = 1.5% exactly.
    assert breakdown["ratio_after_ppm"] == 15_000
    assert breakdown["crosses_cliff"] is True
    assert breakdown["penalty_ratio_usd"] == "45.00"
    assert breakdown["fee_tier_usd"] == "15.00"
    assert breakdown["accept_fee_usd"] == "0.00"
    assert breakdown["formula_notes"][0].startswith(
        "hvd_ratio_before=0.010000 (10000 ppm) = disputed_3m(198.00) / net_sales_3m(19800.00)"
    )


async def test_hvd_tier_fee_replaces_standard_fee(client) -> None:
    # 3 claims of $99 over $19,800 = 1.5%: the merchant is in the HVD tier.
    await _seed_completed_sales(client, 200, disputed=3)
    case = await _open_dispute(client)
    detail = (await client.get(f"/api/v1/disputes/{case['dispute_id']}")).json()
    breakdown = detail["breakdown"]
    assert breakdown["high_volume"] is True
    assert breakdown["fee_tier_usd"] == "30.00"
    assert breakdown["fee_reimbursable_on_win"] is False
    assert breakdown["sla_response_days"] == 3
    assert breakdown["crosses_cliff"] is False
    assert breakdown["penalty_ratio_usd"] == "0.00"
    summary = (await client.get("/api/v1/reporting/summary")).json()
    assert summary["high_volume"]["flag"] is True
    assert summary["high_volume"]["ratio_ppm"] == 15_000
    assert summary["high_volume"]["active_fee_tier_usd_cents"] == 3000
