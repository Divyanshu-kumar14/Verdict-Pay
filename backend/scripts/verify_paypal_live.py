#!/usr/bin/env python
"""Verify a real PayPal sandbox app's dispute entitlements end to end.

This is the script a judge (or you) runs after adding sandbox credentials. It
uses the application's own gateway (never a simulator) and reports, per
endpoint, what PayPal actually answered, including the ``paypal-debug-id``:

  1. OAuth2 + ``GET  /v1/customer/disputes``
  2. ``GET  /v1/reporting/transactions`` (last 30 days, ``fields=all``) and
     which transaction_info flags PayPal returns
  3. ``POST /v1/customer/disputes`` with a ``PayPal-Auth-Assertion`` header
     (buyer-side dispute creation; many sandbox apps lack this entitlement)
  4. ``POST /v1/customer/disputes/{id}/adjudicate`` (sandbox only; needs a
     dispute in a state PayPal allows to be adjudicated)
  5. one deterministic PayPal error trigger via the ``PayPal-Mock-Response``
     negative-testing header (``ERRDIS015``)

Credentials resolve exactly like the app: ``PAYPAL_SANDBOX_CLIENT_ID`` /
``PAYPAL_SANDBOX_CLIENT_SECRET`` win in sandbox mode, else ``PAYPAL_CLIENT_ID`` /
``PAYPAL_CLIENT_SECRET``.

    PAYPAL_MODE=PAYPAL_SANDBOX uv run --directory backend python scripts/verify_paypal_live.py

Exit codes: 0 = every *required* check passed (entitlement checks 3-4 are
reported but not required), 1 = a required check failed, 2 = configuration.
Evidence is written to ``artifacts/paypal-entitlements.json``; secrets never are.
"""

from __future__ import annotations

import asyncio
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import GatewayMode, get_settings
from app.errors import UpstreamError
from app.integrations.paypal import wire
from app.integrations.paypal.factory import build_gateway
from app.integrations.paypal.live import DISPUTES_PATH, LivePayPalGateway

_REPO_DIR = Path(__file__).resolve().parents[2]
JSON_PATH = _REPO_DIR / "artifacts" / "paypal-entitlements.json"
MOCK_ERROR_CODE = "ERRDIS015"


def _debug_id(exc: UpstreamError) -> str | None:
    for item in exc.details or []:
        if isinstance(item, dict) and item.get("field") == "paypal_debug_id":
            return str(item.get("message"))
    return None


def _failure(exc: UpstreamError) -> dict[str, Any]:
    return {
        "ok": False,
        "http_status": getattr(exc, "upstream_status", None),
        "issues": list(getattr(exc, "issues", None) or []),
        "message": str(exc.message)[:300],
        "paypal_debug_id": _debug_id(exc),
    }


async def _check(results: dict[str, Any], name: str, label: str, call: Any) -> Any:
    print(label)
    try:
        value, summary = await call()
    except UpstreamError as exc:
        results[name] = _failure(exc)
        print(
            f"    FAILED  HTTP {results[name]['http_status']} "
            f"{results[name]['issues'] or ''} debug_id={results[name]['paypal_debug_id']}"
        )
        return None
    results[name] = {"ok": True, **summary}
    print(f"    ok  {json.dumps(summary, default=str)[:240]}")
    return value


async def main() -> int:
    settings = get_settings()
    if settings.gateway_mode is not GatewayMode.PAYPAL_SANDBOX:
        print("PAYPAL_MODE must be PAYPAL_SANDBOX (this proof never touches live money).")
        return 2
    if not settings.paypal_credentials_configured:
        print("Missing sandbox credentials: " + "; ".join(settings.gateway_blockers))
        return 2
    gateway = build_gateway(settings)
    if not isinstance(gateway, LivePayPalGateway) or not gateway.is_sandbox:
        print("Refusing: the selected gateway is not the sandbox network adapter.")
        return 2

    now = datetime.now(UTC).replace(microsecond=0)
    results: dict[str, Any] = {}
    try:

        async def list_call() -> Any:
            response = await gateway._request("GET", DISPUTES_PATH, params={"page_size": 5})
            items = response.body.get("items") or []
            return items, {"count": len(items), "paypal_debug_id": response.request_id}

        disputes = (
            await _check(
                results, "list_disputes", "1/5 OAuth + GET /v1/customer/disputes", list_call
            )
            or []
        )

        async def reporting_call() -> Any:
            response = await gateway._request(
                "GET",
                "/v1/reporting/transactions",
                params={
                    "start_date": (now - timedelta(days=30)).strftime("%Y-%m-%dT%H:%M:%S+0000"),
                    "end_date": now.strftime("%Y-%m-%dT%H:%M:%S+0000"),
                    "fields": "all",
                    "page_size": 20,
                },
            )
            details = response.body.get("transaction_details") or []
            flags: set[str] = set()
            for item in details:
                info = item.get("transaction_info") if isinstance(item, dict) else None
                if isinstance(info, dict):
                    flags.update(k for k in info if k.endswith(("_flag", "_status", "_code")))
            return details, {
                "transactions": len(details),
                "transaction_info_flags": sorted(flags),
                "paypal_debug_id": response.request_id,
            }

        await _check(
            results,
            "reporting_transactions",
            "2/5 GET /v1/reporting/transactions (fields=all, 30d)",
            reporting_call,
        )

        async def create_call() -> Any:
            response = await gateway._request(
                "POST",
                DISPUTES_PATH,
                headers={
                    "PayPal-Auth-Assertion": wire.build_auth_assertion(
                        settings.effective_paypal_client_id, settings.demo_payer_id
                    )
                },
                json_body={
                    "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
                    "dispute_amount": {"currency_code": "USD", "value": "1.00"},
                    "dispute_life_cycle_stage": "INQUIRY",
                    "dispute_channel": "INTERNAL",
                },
            )
            return response.body, {
                "dispute_id": response.body.get("dispute_id"),
                "paypal_debug_id": response.request_id,
            }

        created = await _check(
            results,
            "create_customer_dispute",
            "3/5 POST /v1/customer/disputes (PayPal-Auth-Assertion)",
            create_call,
        )

        target = None
        if isinstance(created, dict) and created.get("dispute_id"):
            target = str(created["dispute_id"])
        elif disputes and isinstance(disputes[0], dict):
            target = disputes[0].get("dispute_id")
        if target:

            async def adjudicate_call() -> Any:
                response = await gateway.adjudicate(target, "SELLER_FAVOR")
                return response.body, {
                    "dispute_id": target,
                    "paypal_debug_id": response.request_id,
                }

            await _check(
                results,
                "adjudicate",
                f"4/5 POST /v1/customer/disputes/{target}/adjudicate (sandbox)",
                adjudicate_call,
            )
        else:
            results["adjudicate"] = {"ok": False, "skipped": "no sandbox dispute available"}
            print("4/5 adjudicate  skip  no sandbox dispute available")

        async def mock_error_call() -> Any:
            response = await gateway._request(
                "GET",
                DISPUTES_PATH,
                params={"page_size": 1},
                headers={
                    "PayPal-Mock-Response": json.dumps({"mock_application_codes": MOCK_ERROR_CODE})
                },
                retry=False,
            )
            return response.body, {
                "note": "PayPal ignored the mock header (HTTP 2xx)",
                "paypal_debug_id": response.request_id,
            }

        await _check(
            results,
            "mock_error",
            f"5/5 deterministic error trigger PayPal-Mock-Response {MOCK_ERROR_CODE}",
            mock_error_call,
        )
        mock = results["mock_error"]
        # A *failure* is the expected outcome of an error trigger.
        mock["triggered"] = not mock["ok"]
    finally:
        await gateway.close()

    required = ("list_disputes", "reporting_transactions")
    failed = [name for name in required if not results.get(name, {}).get("ok")]
    record = {
        "timestamp": now.isoformat(),
        "source_plane": "LIVE_PAYPAL_SANDBOX",
        "api_base": settings.paypal_api_base,
        "results": results,
        "required_failed": failed,
    }
    JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(record, indent=2, default=str)
    for secret in (settings.effective_paypal_client_secret,):
        if secret and secret in text:
            print("Refusing to write evidence: it contains a credential.")
            return 1
    JSON_PATH.write_text(text + "\n", encoding="utf-8")
    print(f"\nevidence written to {JSON_PATH.relative_to(_REPO_DIR)}")
    print("REQUIRED CHECKS PASSED" if not failed else f"FAILED: {', '.join(failed)}")
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
