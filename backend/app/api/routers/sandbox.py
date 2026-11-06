"""Judge-facing sandbox: the three-button demo, backed by the real services.

Nothing here short-circuits the production path: checkout uses the PayPal gateway,
usage writes four hash-chained telemetry events through TelemetryService, and the
dispute button signs a webhook body and feeds it through the exact same
DisputeService.ingest_webhook path PayPal traffic uses.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from typing import Any

from fastapi import APIRouter

from app.api import schemas
from app.api.deps import (
    GatewayDep,
    MerchantDep,
    NarrativeDep,
    SearchDep,
    SessionDep,
    SettingsDep,
)
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.service import TelemetryService, to_event_out
from app.errors import ValidationFailedError
from app.logging_setup import get_logger, log_context
from app.services.dispute_service import (
    TRIAGE_SNAPSHOT_KEY,
    DisputeService,
    containment_snapshot,
    quantize_money,
    to_dispute_summary,
)

router = APIRouter(tags=["sandbox"])
logger = get_logger("verdictpay.sandbox")

TOS_VERSION = "v2.4-2026-01"
TOS_TEXT = (
    "VerdictPay demo SaaS Terms of Service v2.4 (effective 2026-01-26). "
    "Subscriptions renew monthly until cancelled. Digital deliverables and metered "
    "AI usage are non-refundable once consumed. Chargebacks are governed by the "
    "merchant's published refund policy."
)
DEMO_ASSET_PAYLOAD = b"VerdictPay demo export payload::q3_financial_model"
DEMO_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
DEFAULT_CLIENT_IP = "203.0.113.42"
DEFAULT_DEVICE_FINGERPRINT = "fp_89a7c6d5e4f3"
PLAN_AMOUNTS: dict[str, Decimal] = {
    "pro": Decimal("99.00"),
    "scale": Decimal("299.00"),
}
PLAN_DESCRIPTIONS: dict[str, str] = {
    "pro": "VerdictPay demo Pro plan",
    "scale": "VerdictPay demo Scale plan",
}
DEFAULT_DISPUTE_AMOUNT = Decimal("99.00")


def _sha256_hex(payload: str | bytes) -> str:
    data = payload.encode("utf-8") if isinstance(payload, str) else payload
    return hashlib.sha256(data).hexdigest()


def _validated_payer_id(value: str | None, *, field: str = "payer_id") -> str | None:
    """Trim and length-check a payer id before it can reach the ledger."""
    if value is None:
        return None
    cleaned = value.strip()
    if not 3 <= len(cleaned) <= 64:
        raise ValidationFailedError(
            "payer_id must be between 3 and 64 characters.",
            details=[
                {"field": field, "message": "Invalid payer id length.", "code": "invalid_length"}
            ],
        )
    return cleaned


def _validated_order_id(value: str | None, *, default: str) -> str:
    cleaned = (value or default).strip()
    if not 3 <= len(cleaned) <= 64:
        raise ValidationFailedError(
            "order_id must be between 3 and 64 characters.",
            details=[
                {
                    "field": "order_id",
                    "message": "Invalid order id length.",
                    "code": "invalid_length",
                }
            ],
        )
    return cleaned


def _usage_events(
    payload: schemas.UsageRequest,
    *,
    client_ip: str,
    device_fingerprint: str,
) -> list[schemas.TelemetryEventIn]:
    """The four canonical demo events, in lifecycle order."""
    common: dict[str, Any] = {
        "paypal_payer_id": payload.payer_id,
        "paypal_order_id": payload.order_id,
        "paypal_subscription_id": payload.subscription_id,
        "client_ip": client_ip,
        "device_fingerprint": device_fingerprint,
    }
    return [
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.TOS_ACCEPTED,
            tos_version=TOS_VERSION,
            tos_content_sha256=_sha256_hex(TOS_TEXT),
            metadata={"plan": "pro"},
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.SESSION_AUTH,
            metadata={
                "logins": payload.logins,
                "asn": "AS15169",
                "user_agent": DEMO_USER_AGENT,
            },
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.ASSET_DELIVERED,
            resource_id=payload.export_name,
            resource_sha256=_sha256_hex(DEMO_ASSET_PAYLOAD),
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.USAGE_METERED,
            units_consumed=payload.tokens,
            metadata={"logins": payload.logins},
        ),
    ]


@router.post("/sandbox/checkout", response_model=schemas.CheckoutResponse)
async def sandbox_checkout(
    payload: schemas.CheckoutRequest,
    merchant: MerchantDep,
    gateway: GatewayDep,
    settings: SettingsDep,
) -> schemas.CheckoutResponse:
    """Create the demo order through the PayPal gateway (simulator by default)."""
    payer_id = _validated_payer_id(payload.payer_id) or settings.demo_payer_id
    order = await gateway.create_order(
        payer_id=payer_id,
        amount=PLAN_AMOUNTS[payload.plan],
        currency="USD",
        description=PLAN_DESCRIPTIONS[payload.plan],
    )
    logger.info(
        "sandbox_checkout",
        extra=log_context(
            merchant_id=merchant.id,
            order_id=order.order_id,
            plan=payload.plan,
            tos_version=payload.tos_version,
        ),
    )
    return schemas.CheckoutResponse(
        order_id=order.order_id,
        subscription_id=order.subscription_id,
        payer_id=order.payer_id,
        status=order.status,
        amount_usd=quantize_money(order.amount),
        currency=order.currency,
        approval_url=order.approval_url,
        created_at=order.created_at,
    )


@router.post("/sandbox/usage", response_model=schemas.UsageResponse)
async def simulate_usage(
    payload: schemas.UsageRequest,
    merchant: MerchantDep,
    session: SessionDep,
) -> schemas.UsageResponse:
    """Record the four signed lifecycle events that form the system of record."""
    payer_id = _validated_payer_id(payload.payer_id)
    if payer_id is None:
        raise ValidationFailedError("payer_id is required.")
    client_ip = (payload.client_ip or DEFAULT_CLIENT_IP).strip()
    device_fingerprint = (payload.device_fingerprint or DEFAULT_DEVICE_FINGERPRINT).strip()
    events = _usage_events(
        payload.model_copy(update={"payer_id": payer_id}),
        client_ip=client_ip,
        device_fingerprint=device_fingerprint,
    )
    service = TelemetryService(session, merchant.id)
    results = await service.record_many(events)
    chain = await service.verify(payer_id)
    return schemas.UsageResponse(
        chain=chain,
        events=[to_event_out(result.row) for result in results],
        totals={"logins": payload.logins, "tokens": payload.tokens, "assets": 1},
    )


@router.post("/sandbox/dispute", response_model=schemas.DisputeSimulationResponse)
async def simulate_dispute(
    payload: schemas.DisputeSimulationRequest,
    merchant: MerchantDep,
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    narrative: NarrativeDep,
    search: SearchDep,
) -> schemas.DisputeSimulationResponse:
    """Open a sandbox dispute and drive it through the real webhook ingest path."""
    payer_id = _validated_payer_id(payload.payer_id) or settings.demo_payer_id
    order_id = _validated_order_id(payload.order_id, default=settings.demo_order_id)
    amount = (
        quantize_money(payload.amount_usd)
        if payload.amount_usd is not None
        else DEFAULT_DISPUTE_AMOUNT
    )
    service = DisputeService(
        session,
        settings=settings,
        gateway=gateway,
        narrative=narrative,
        search=search,
        merchant_id=merchant.id,
    )
    record, case = await service.open_simulated_dispute_with_event(
        payer_id=payer_id,
        order_id=order_id,
        reason_code=payload.reason_code.value,
        stage=payload.stage,
        channel=payload.channel,
        amount=amount,
        buyer_claim_text=payload.claim_text,
    )
    return schemas.DisputeSimulationResponse(
        dispute=to_dispute_summary(case),
        webhook_event_id=record.event_id,
        triage_triggered=bool(case.facts_snapshot.get(TRIAGE_SNAPSHOT_KEY)),
        containment=containment_snapshot(case),
    )
