"""Reporting aggregates and transaction cache contract."""

from __future__ import annotations


async def _run_sandbox_flow(client) -> dict:
    checkout = (
        await client.post("/api/v1/sandbox/checkout", json={"plan": "pro"})
    ).json()
    usage = await client.post(
        "/api/v1/sandbox/usage",
        json={
            "payer_id": checkout["payer_id"],
            "order_id": checkout["order_id"],
            "subscription_id": checkout["subscription_id"],
        },
    )
    assert usage.status_code == 200
    dispute = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": checkout["payer_id"], "order_id": checkout["order_id"]},
    )
    assert dispute.status_code == 200
    return dispute.json()["dispute"]


async def test_summary_after_flow_exposes_exact_decision(client) -> None:
    dispute = await _run_sandbox_flow(client)
    assert dispute["recommended_action"] == "DEFLECT_INQUIRY"


async def test_summary_totals_match_the_sandbox_flow(client) -> None:
    await _run_sandbox_flow(client)
    response = await client.get("/api/v1/reporting/summary")
    assert response.status_code == 200
    summary = response.json()

    assert summary["total_cases"] == 1
    assert summary["open_cases"] == 1
    assert summary["in_inquiry"] == 1
    assert summary["in_claim"] == 0
    assert summary["total_exposure_usd"] == "99.00"
    assert summary["protected_usd"] == "99.00"
    assert summary["fees_avoided_usd"] == "15.00"
    assert summary["avg_p_win"] == 0.95
    assert summary["win_rate_estimate"] == 0.95
    assert summary["subscription_suspensions"] == 1
    assert summary["chain_verified_customers"] == 1
    assert summary["high_volume"] == {
        "flag": False,
        "ratio": 1.0,
        "threshold": 0.015,
        "sales_3mo": 0,
        "disputes_3mo": 1,
    }


async def test_summary_is_zero_safe_with_no_cases(client) -> None:
    summary = (await client.get("/api/v1/reporting/summary")).json()
    assert summary["total_cases"] == 0
    assert summary["open_cases"] == 0
    assert summary["in_inquiry"] == 0
    assert summary["in_claim"] == 0
    assert summary["total_exposure_usd"] == "0.00"
    assert summary["protected_usd"] == "0.00"
    assert summary["fees_avoided_usd"] == "0.00"
    assert summary["avg_p_win"] == 0.0
    assert summary["win_rate_estimate"] == 0.0
    assert summary["subscription_suspensions"] == 0
    assert summary["chain_verified_customers"] == 0
    assert summary["high_volume"] == {
        "flag": False,
        "ratio": 0.0,
        "threshold": 0.015,
        "sales_3mo": 0,
        "disputes_3mo": 0,
    }


async def test_transactions_are_cached_newest_first(client) -> None:
    await _run_sandbox_flow(client)
    response = await client.get("/api/v1/reporting/transactions")
    assert response.status_code == 200
    rows = response.json()

    assert len(rows) == 3
    assert [row["amount_usd"] for row in rows] == ["99.00", "99.00", "49.00"]
    assert {row["status"] for row in rows} == {"COMPLETED"}
    assert {row["payer_id"] for row in rows} == {"YRZ829104KLA"}
    assert {row["currency"] for row in rows} == {"USD"}
    assert {row["client_ip"] for row in rows} == {"203.0.113.42"}
    assert {row["device_fingerprint"] for row in rows} == {"fp_89a7c6d5e4f3"}
    assert {row["source"] for row in rows} == {"paypal_sandbox"}
    assert all(row["order_id"] is None for row in rows)
    assert len({row["transaction_id"] for row in rows}) == 3
    assert all(row["created_at"].endswith(("Z", "+00:00")) for row in rows)


async def test_transactions_filter_and_limit(client) -> None:
    await _run_sandbox_flow(client)

    filtered = (
        await client.get("/api/v1/reporting/transactions?payer_id=YRZ829104KLA")
    ).json()
    assert len(filtered) == 3

    missing = (
        await client.get("/api/v1/reporting/transactions?payer_id=NOBODY-HERE")
    ).json()
    assert missing == []

    limited = (await client.get("/api/v1/reporting/transactions?limit=2")).json()
    assert [row["amount_usd"] for row in limited] == ["99.00", "99.00"]

    invalid = await client.get("/api/v1/reporting/transactions?limit=0")
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "validation_error"
