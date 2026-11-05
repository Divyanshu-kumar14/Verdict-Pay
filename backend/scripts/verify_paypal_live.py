#!/usr/bin/env python
"""Verify a real PayPal sandbox connection end to end.

This is the script a judge (or you) runs after adding sandbox credentials. It
proves the live gateway — not the simulator — can authenticate, read disputes and
query the Reporting API. Nothing is written to the database.

    PAYPAL_MODE=live PAYPAL_CLIENT_ID=... PAYPAL_CLIENT_SECRET=... \
        uv run --directory backend python scripts/verify_paypal_live.py
"""

from __future__ import annotations

import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.errors import UpstreamError
from app.integrations.paypal.factory import build_gateway


async def main() -> int:
    settings = get_settings()
    if settings.paypal_mode != "live":
        print("PAYPAL_MODE is not 'live'. Set PAYPAL_MODE=live to test real PayPal.")
        return 2
    if not settings.paypal_client_id or not settings.paypal_client_secret:
        print("Missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET (sandbox app credentials).")
        return 2

    gateway = build_gateway(settings)
    now = datetime.now(UTC)
    failures = 0
    try:
        print(f"1/3 OAuth + dispute list against {settings.paypal_api_base}")
        try:
            disputes = await gateway.list_disputes(page_size=5)
            print(f"    ok  {len(disputes)} sandbox dispute(s) readable")
            if disputes:
                first = disputes[0]
                print(
                    f"    sample: {first.dispute_id} · {first.stage.value} · "
                    f"{first.currency} {first.amount}"
                )
        except UpstreamError as exc:
            failures += 1
            print(f"    FAILED  {exc.code}: {exc.message}")

        print("2/3 Reporting API transaction search")
        try:
            transactions = await gateway.search_transactions(
                payer_id=settings.demo_payer_id,
                start=now - timedelta(days=365),
                end=now - timedelta(days=90),
            )
            print(f"    ok  {len(transactions)} historical transaction(s) returned")
        except UpstreamError as exc:
            failures += 1
            print(f"    FAILED  {exc.code}: {exc.message}")

        print("3/3 Single dispute fetch (only if a sandbox dispute exists)")
        if disputes:
            try:
                record = await gateway.get_dispute(disputes[0].dispute_id)
                print(f"    ok  {record.dispute_id} links: {sorted(record.links)}")
            except UpstreamError as exc:
                failures += 1
                print(f"    FAILED  {exc.code}: {exc.message}")
        else:
            print("    skip  no sandbox disputes — create one in the PayPal dashboard")
    finally:
        await gateway.close()

    print("\nLIVE PAYPAL CHECK PASSED" if failures == 0 else f"\n{failures} CHECK(S) FAILED")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
