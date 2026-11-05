#!/usr/bin/env python
"""Seed a demo merchant with telemetry, CE 3.0 history and five dispute scenarios.

Runs entirely in-process against the real API (ASGI transport) and the simulator
gateway, so the seeded state is produced by exactly the same code path the judge
demo uses. Idempotent: a second run is a no-op unless --reset is passed.

    uv run python scripts/seed_demo.py [--reset]
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx
from sqlalchemy import func, select

from app.config import get_settings
from app.db.models import DisputeCase, PaypalTransaction
from app.integrations.paypal.simulator import synthetic_transactions
from app.main import create_app
from app.services.bootstrap import ensure_demo_merchant

logger = logging.getLogger("verdictpay.seed")

SCENARIOS: list[dict[str, Any]] = [
    {
        "label": "Friendly fraud - INR on a $99 Pro subscription",
        "plan": "pro",
        "payer_id": "YRZ829104KLA",
        "client_ip": "203.0.113.42",
        "device_fingerprint": "fp_89a7c6d5e4f3",
        "logins": 15,
        "tokens": 42_000,
        "export_name": "export_q3_financial_model.xlsx",
        "reason_code": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "stage": "INQUIRY",
        "channel": "INTERNAL",
        "amount_usd": "99.00",
    },
    {
        "label": "SNAD on a $25 metered seat",
        "plan": "pro",
        "payer_id": "YRZ552911PQA",
        "client_ip": "198.51.100.17",
        "device_fingerprint": "fp_2b7719ac4e11",
        "logins": 9,
        "tokens": 11_800,
        "export_name": "invoice_batch_2026_01.zip",
        "reason_code": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        "stage": "INQUIRY",
        "channel": "INTERNAL",
        "amount_usd": "25.00",
    },
    {
        "label": "Chargeback - SNAD after heavy token burn",
        "plan": "scale",
        "payer_id": "YRZ902117KTM",
        "client_ip": "192.0.2.88",
        "device_fingerprint": "fp_aa1930ce77d2",
        "logins": 31,
        "tokens": 184_500,
        "export_name": "dataset_snapshot_12gb.parquet",
        "reason_code": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        "stage": "CHARGEBACK",
        "channel": "INTERNAL",
        "amount_usd": "299.00",
    },
    {
        "label": "External chargeback - unauthorized claim on a $49 plan",
        "plan": "pro",
        "payer_id": "YRZ334455KLA",
        "client_ip": "203.0.113.99",
        "device_fingerprint": "fp_77c2e1a9b032",
        "logins": 4,
        "tokens": 2_100,
        "export_name": "onboarding_guide.pdf",
        "reason_code": "UNAUTHORIZED",
        "stage": "PRE_ARBITRATION",
        "channel": "EXTERNAL",
        "amount_usd": "49.00",
    },
    {
        "label": "Inquiry - INR on a $25 seat with strong telemetry",
        "plan": "pro",
        "payer_id": "YRZ778899PQA",
        "client_ip": "203.0.113.7",
        "device_fingerprint": "fp_1d4f9c8e2a77",
        "logins": 22,
        "tokens": 67_400,
        "export_name": "revenue_model_fy26.xlsx",
        "reason_code": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "stage": "INQUIRY",
        "channel": "INTERNAL",
        "amount_usd": "25.00",
    },
]

PLAN_AMOUNTS = {"pro": "99.00", "scale": "299.00"}


def money(value: Any) -> str:
    return "$" + f"{Decimal(str(value)):.2f}"


SALES_HISTORY = 200
SALES_POOL = ("25.00", "49.00", "99.00", "299.00")
SALES_IPS = ("203.0.113.42", "198.51.100.17", "192.0.2.88", "203.0.113.7")
SALES_DEVICES = ("fp_89a7c6d5e4f3", "fp_2b7719ac4e11", "fp_aa1930ce77d2", "fp_1d4f9c8e2a77")


def _sqlite_path(database_url: str) -> Path | None:
    if not database_url.startswith("sqlite"):
        return None
    return Path(database_url.split("///", 1)[-1])


def _reset_database(database_url: str) -> None:
    """Synchronous on purpose: filesystem work must not block the event loop."""
    path = _sqlite_path(database_url)
    if path is None:
        return
    for suffix in ("", "-wal", "-shm"):
        candidate = Path(str(path) + suffix)
        if candidate.exists():
            candidate.unlink()
    print(f"reset {path}")


async def _already_seeded(session: Any, merchant_id: str) -> bool:
    count = await session.scalar(
        select(func.count()).select_from(DisputeCase).where(DisputeCase.merchant_id == merchant_id)
    )
    return bool(count)


async def _seed_sales(session: Any, merchant_id: str) -> int:
    """Create a realistic 90-day sales history so the high-volume fee regime is real.

    200 completed sales put the merchant above PayPal's 100-sales threshold; the
    seeded dispute queue then pushes the rolling ratio over 1.5%, which is exactly
    the $30 high-volume regime the EV engine prices.
    """
    now = datetime.now(UTC)
    inserted = 0
    for index in range(SALES_HISTORY):
        transaction_id = f"SALE-{index:05d}"
        existing = await session.scalar(
            select(PaypalTransaction).where(PaypalTransaction.transaction_id == transaction_id)
        )
        if existing is not None:
            continue
        session.add(
            PaypalTransaction(
                merchant_id=merchant_id,
                transaction_id=transaction_id,
                payer_id=f"YRZ{index:09d}",
                amount_usd=Decimal(SALES_POOL[index % len(SALES_POOL)]),
                currency="USD",
                status="COMPLETED",
                client_ip=SALES_IPS[index % len(SALES_IPS)],
                device_fingerprint=SALES_DEVICES[index % len(SALES_DEVICES)],
                source="simulator",
                created_at=now - timedelta(days=index % 88, hours=index % 24),
            )
        )
        inserted += 1
    await session.commit()
    return inserted


async def _seed_history(session: Any, merchant_id: str, scenarios: list[dict[str, Any]]) -> int:
    """Persist the deterministic CE 3.0 transaction history used by reporting."""
    now = datetime.now(UTC)
    inserted = 0
    for scenario in scenarios:
        for record in synthetic_transactions(scenario["payer_id"], now=now):
            existing = await session.scalar(
                select(PaypalTransaction).where(
                    PaypalTransaction.transaction_id == record.transaction_id
                )
            )
            if existing is not None:
                continue
            session.add(
                PaypalTransaction(
                    merchant_id=merchant_id,
                    transaction_id=record.transaction_id,
                    payer_id=record.payer_id,
                    amount_usd=record.amount,
                    currency=record.currency,
                    status=record.status,
                    client_ip=record.client_ip,
                    device_fingerprint=record.device_fingerprint,
                    source="simulator",
                    created_at=record.created_at,
                )
            )
            inserted += 1
    await session.commit()
    return inserted


def _require_ok(response: httpx.Response, step: str) -> None:
    if response.status_code >= 400:
        raise SystemExit(f"{step} failed: {response.status_code} {response.text}")


async def _seed_scenarios(client: httpx.AsyncClient, scenarios: list[dict[str, Any]]) -> None:
    for index, scenario in enumerate(scenarios, start=1):
        checkout = await client.post(
            "/api/v1/sandbox/checkout",
            json={
                "plan": scenario["plan"],
                "payer_id": scenario["payer_id"],
                "email": f"buyer{index}@customer-startup.io",
                "tos_version": "v2.4-2026-01",
            },
        )
        _require_ok(checkout, f"checkout #{index}")
        order = checkout.json()
        assert order["amount_usd"] == PLAN_AMOUNTS[scenario["plan"]]

        usage = await client.post(
            "/api/v1/sandbox/usage",
            json={
                "payer_id": order["payer_id"],
                "order_id": order["order_id"],
                "subscription_id": order["subscription_id"],
                "logins": scenario["logins"],
                "tokens": scenario["tokens"],
                "export_name": scenario["export_name"],
                "client_ip": scenario["client_ip"],
                "device_fingerprint": scenario["device_fingerprint"],
            },
        )
        _require_ok(usage, f"usage #{index}")
        body = usage.json()
        assert body["chain"]["valid"] is True
        assert body["totals"]["tokens"] == scenario["tokens"]

        dispute = await client.post(
            "/api/v1/sandbox/dispute",
            json={
                "payer_id": order["payer_id"],
                "order_id": order["order_id"],
                "reason_code": scenario["reason_code"],
                "stage": scenario["stage"],
                "channel": scenario["channel"],
                "amount_usd": scenario["amount_usd"],
            },
        )
        _require_ok(dispute, f"dispute #{index}")
        payload = dispute.json()["dispute"]
        print(
            "  seeded {id:<16} {stage:<16} {amount:>9}  {action:<17} p(win)={p:.2f}".format(
                id=payload["dispute_id"],
                stage=payload["stage"],
                amount=money(payload["amount_usd"]),
                action=payload["recommended_action"],
                p=payload["p_win"],
            )
        )


async def seed(reset: bool) -> int:
    settings = get_settings()

    if reset:
        _reset_database(settings.database_url)

    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with app.state.db.session() as session:
            merchant = await ensure_demo_merchant(session, settings)
            if not reset and await _already_seeded(session, merchant.id):
                print("already seeded - pass --reset to rebuild")
                return 0
            sales = await _seed_sales(session, merchant.id)
            inserted = await _seed_history(session, merchant.id, SCENARIOS)
            print(
                f"history: {inserted + sales} paypal transactions cached "
                f"({sales} sales + {inserted} CE 3.0 lookback rows)"
            )

        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://seed") as client:
            client.headers["X-API-Key"] = settings.verdictpay_api_key
            print(f"merchant: {merchant.id} ({merchant.name})")
            await _seed_scenarios(client, SCENARIOS)

        print("\nseed complete. open http://localhost:3000 for the judge demo.")
        return 0


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reset", action="store_true", help="delete the local database first")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING)
    raise SystemExit(asyncio.run(seed(args.reset)))


if __name__ == "__main__":
    main()
