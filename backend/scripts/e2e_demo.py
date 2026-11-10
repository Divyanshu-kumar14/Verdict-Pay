#!/usr/bin/env python
"""End-to-end assertion of the 60-second judge flow, straight over HTTP.

This is the demo contract: if this script is green, a judge can click the three
buttons and every number on screen is real.
"""

from __future__ import annotations

import os
import sys
import time
from decimal import Decimal
from typing import Any

import httpx

BASE_URL = os.environ.get("VERDICTPAY_BASE_URL", "http://127.0.0.1:8000")
API_KEY = os.environ.get("VERDICTPAY_API_KEY", "vp_demo_sk_local")
TIMEOUT = float(os.environ.get("VERDICTPAY_E2E_TIMEOUT", "30"))

CHECKS = 0


def money(value: Any) -> str:
    return "$" + f"{Decimal(str(value)):.2f}"


def check(condition: bool, message: str) -> None:
    global CHECKS
    CHECKS += 1
    if not condition:
        raise AssertionError(message)


def step(number: int, title: str) -> None:
    print(f"\n[{number}] {title}")


def call(client: httpx.Client, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
    response = client.request(method, path, **kwargs)
    if response.status_code >= 400:
        raise AssertionError(f"{method} {path} -> {response.status_code}: {response.text[:600]}")
    if response.headers.get("content-type", "").startswith("application/json"):
        return response.json()
    return {"raw": response.content}


def wait_for_api(client: httpx.Client, attempts: int = 60) -> None:
    last: Exception | None = None
    for _ in range(attempts):
        try:
            if client.get("/api/v1/health").status_code == 200:
                return
        except Exception as exc:
            last = exc
        time.sleep(0.5)
    raise SystemExit(f"API never became healthy at {BASE_URL}: {last}")


def run(client: httpx.Client) -> int:
    step(0, "Health + gateway mode")
    health = call(client, "GET", "/api/v1/health")
    check(health["status"] == "ok", "health is not ok")
    gateway_status = health["gateway_status"]
    check(
        gateway_status["mode"] == "PAYPAL_SANDBOX",
        f"expected PAYPAL_SANDBOX, got {gateway_status['mode']}",
    )
    check(
        gateway_status["readiness"] == "ready",
        f"PayPal Sandbox is not configured: {gateway_status['blockers']}",
    )
    print(
        f"    ok  v{health['version']} - gateway={health['gateway']} "
        f"- demo_mode={health['demo_mode']}"
    )

    step(1, "Buyer checks out the Pro plan")
    checkout = call(
        client,
        "POST",
        "/api/v1/sandbox/checkout",
        json={"plan": "pro", "email": "alex@customer-startup.io", "tos_version": "v2.4-2026-01"},
    )
    check(Decimal(checkout["amount_usd"]) == Decimal("99.00"), "checkout amount is not 99.00")
    check(bool(checkout["order_id"]), "missing order id")
    check(
        str(checkout["approval_url"]).startswith("https://www.sandbox.paypal.com/"),
        "approval_url is not a PayPal Sandbox link",
    )
    payer_id = checkout["payer_id"]
    order_id = checkout["order_id"]
    subscription_id = checkout["subscription_id"]
    print(f"    ok  order={order_id} sub={subscription_id} payer={payer_id}")

    step(2, "Buyer burns 42k tokens, 15 logins and a ZIP export")
    usage = call(
        client,
        "POST",
        "/api/v1/sandbox/usage",
        json={
            "payer_id": payer_id,
            "order_id": order_id,
            "subscription_id": subscription_id,
            "logins": 15,
            "tokens": 42_000,
            "export_name": "q3_financial_model.xlsx",
        },
    )
    check(len(usage["events"]) == 4, f"expected 4 telemetry events, got {len(usage['events'])}")
    check(usage["chain"]["valid"] is True, "hash chain failed verification")
    check(usage["totals"]["tokens"] == 42_000, "token total mismatch")
    check(usage["totals"]["logins"] == 15, "login total mismatch")
    print(
        f"    ok  4 events - chain {usage['chain']['head_hash'][:12]}... - "
        f"{usage['totals']['tokens']} tokens"
    )

    step(3, "Buyer files a friendly-fraud INR dispute")
    started = time.perf_counter()
    dispute = call(
        client,
        "POST",
        "/api/v1/sandbox/dispute",
        json={
            "payer_id": payer_id,
            "order_id": order_id,
            "reason_code": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            "stage": "INQUIRY",
            "channel": "INTERNAL",
            "amount_usd": "99.00",
        },
    )
    detection_ms = (time.perf_counter() - started) * 1000
    case = dispute["dispute"]
    dispute_id = case["dispute_id"]
    check(case["stage"] == "INQUIRY", "dispute did not open as an INQUIRY")
    origin = dispute.get("origin")
    check(origin in {"paypal_sandbox", "internal_test_event"}, f"unexpected origin {origin}")
    check(
        case["recommended_action"] in {"DEFLECT_INQUIRY", "MAKE_OFFER", "ACCEPT_CLAIM"},
        f"unexpected recommendation {case['recommended_action']}",
    )
    # Includes a PayPal Disputes API round trip, so allow for sandbox latency.
    check(detection_ms < 20_000, f"ingest took {detection_ms:.0f}ms")
    print(
        f"    ok  {dispute_id} - {case['recommended_action']} - origin={origin} - "
        f"ingest {detection_ms:.0f}ms"
    )

    step(4, "Merchant command center loads the case room")
    detail = call(client, "GET", f"/api/v1/disputes/{dispute_id}")
    check(detail["facts"]["chain_valid"] is True, "case facts report an invalid chain")
    check(len(detail["win_probability"]["signals"]) == 6, "expected six win-probability signals")
    present = sum(1 for signal in detail["win_probability"]["signals"] if signal["present"])
    check(present >= 5, f"only {present}/6 telemetry signals present")
    check(len(detail["allowed_actions"]) == 6, "expected six HATEOAS action capabilities")
    check(
        Decimal(detail["breakdown"]["ev_fight_usd"]) < Decimal("0"),
        "EV_fight should be negative for a 99.00 claim",
    )
    print(
        f"    ok  p(win)={detail['p_win']:.2f} - EV_fight={money(detail['ev_fight_usd'])} - "
        f"EV_offer={money(detail['ev_offer_usd'])} - {present}/6 signals"
    )

    step(5, "Merchant takes the recommended zero-fee action")
    recommended = detail["recommended_action"]
    action_path = {
        "DEFLECT_INQUIRY": "SEND_MESSAGE",
        "MAKE_OFFER": "MAKE_OFFER",
        "ACCEPT_CLAIM": "ACCEPT_CLAIM",
        "PROVIDE_EVIDENCE": "PROVIDE_EVIDENCE",
        "MONITOR": "SEND_MESSAGE",
    }[recommended]
    executed = call(
        client,
        "POST",
        f"/api/v1/disputes/{dispute_id}/actions/{action_path}",
        json={"note": "Responding with your own verified delivery telemetry."},
    )
    # An internal test dispute is unknown to PayPal, so its actions are SKIPPED.
    expected_status = "SKIPPED" if origin == "internal_test_event" else "EXECUTED"
    check(
        executed["status"] == expected_status,
        f"action status {executed['status']}, expected {expected_status}",
    )
    print(f"    ok  {action_path} {executed['status'].lower()} in {executed['latency_ms']}ms")

    step(6, "Claim escalation - air-gapped PDF dossier - PayPal evidence upload")
    escalated = call(
        client,
        "POST",
        "/api/v1/sandbox/dispute",
        json={
            "payer_id": payer_id,
            "order_id": order_id,
            "reason_code": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
            "stage": "CHARGEBACK",
            "channel": "INTERNAL",
            "amount_usd": "99.00",
        },
    )
    claim_id = escalated["dispute"]["dispute_id"]
    submission = call(
        client,
        "POST",
        f"/api/v1/disputes/{claim_id}/actions/PROVIDE_EVIDENCE",
        json={"idempotency_key": f"e2e-{claim_id}"},
    )
    check(submission["status"] in {"EXECUTED", "SKIPPED"}, "evidence submission did not execute")
    pdf = client.get(f"/api/v1/disputes/{claim_id}/dossier.pdf")
    check(pdf.status_code == 200, f"dossier download failed: {pdf.status_code}")
    check(pdf.content.startswith(b"%PDF"), "dossier is not a PDF")
    check(len(pdf.content) > 3_000, "dossier is suspiciously small")
    size_kb = len(pdf.content) // 1024
    upload = (
        "uploaded via multipart/related"
        if submission["status"] == "EXECUTED"
        else "upload skipped (internal test dispute, unknown to PayPal)"
    )
    print(f"    ok  {size_kb}KB dossier - %PDF verified - {upload}")

    step(7, "Reporting reflects the saved fees")
    summary = call(client, "GET", "/api/v1/reporting/summary")
    check(summary["total_cases"] >= 2, "reporting does not see the cases")
    check(0 <= summary["avg_p_win"] <= 1, "invalid average win probability")
    print(
        f"    ok  {summary['total_cases']} cases - "
        f"{money(summary['total_exposure_usd'])} exposure - "
        f"{money(summary['fees_avoided_usd'])} fees avoided"
    )

    print(f"\nALL {CHECKS} ASSERTIONS PASSED - the 60-second demo is real.")
    return 0


def main() -> None:
    headers = {"X-API-Key": API_KEY}
    with httpx.Client(base_url=BASE_URL, headers=headers, timeout=TIMEOUT) as client:
        wait_for_api(client)
        try:
            raise SystemExit(run(client))
        except AssertionError as exc:
            print(f"\nFAILED: {exc}", file=sys.stderr)
            raise SystemExit(1) from exc


if __name__ == "__main__":
    main()
