"""Idempotent startup tasks."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import DisputeCase, Merchant
from app.domain.enums import DisputeChannel, DisputeStage, DisputeStatus
from app.domain.protocols import PayPalDisputeRecord, PayPalGateway
from app.logging_setup import get_logger, log_context
from app.security import hash_api_key

logger = get_logger("verdictpay.bootstrap")


async def ensure_demo_merchant(session: AsyncSession, settings: Settings) -> Merchant:
    """Create (or return) the single merchant this deployment serves."""
    key_hash = hash_api_key(settings.verdictpay_api_key)
    existing = await session.scalar(
        select(Merchant).where(Merchant.id == settings.demo_merchant_id)
    )
    if existing is not None:
        if existing.api_key_hash != key_hash:
            existing.api_key_hash = key_hash
            await session.commit()
        return existing

    merchant = Merchant(
        id=settings.demo_merchant_id,
        name=settings.demo_merchant_name,
        api_key_hash=key_hash,
    )
    session.add(merchant)
    await session.commit()
    return merchant


def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def dispute_case_to_record(case: DisputeCase) -> PayPalDisputeRecord:
    """Rebuild the gateway view of a persisted case (used to rehydrate the simulator)."""
    return PayPalDisputeRecord(
        dispute_id=case.dispute_id,
        reason_code=case.reason_code,
        stage=DisputeStage(case.lifecycle_stage),
        channel=DisputeChannel(case.dispute_channel),
        status=DisputeStatus(case.status),
        amount=Decimal(str(case.amount_usd)),
        currency=case.currency,
        payer_id=case.paypal_payer_id,
        order_id=case.paypal_order_id,
        subscription_id=case.paypal_subscription_id,
        seller_response_due_date=_aware(case.seller_response_due_date),
        links=dict(case.paypal_links or {}),
        created_at=_aware(case.created_at) or datetime.now(UTC),
        raw={"source": "restored_from_db"},
    )


async def restore_gateway_state(session: AsyncSession, gateway: PayPalGateway) -> int:
    """Rehydrate the in-memory simulator from persisted cases after a restart.

    The simulator is intentionally stateless on disk; the database is the system
    of record. Without this step a restarted demo would list cases it cannot act on.
    """
    hydrate = getattr(gateway, "hydrate", None)
    if hydrate is None:
        return 0
    cases = list((await session.scalars(select(DisputeCase))).all())
    if not cases:
        return 0
    await hydrate([dispute_case_to_record(case) for case in cases])
    logger.info("gateway_hydrated", extra=log_context(cases=len(cases)))
    return len(cases)
