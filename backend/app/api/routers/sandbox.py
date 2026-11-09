"""Judge-facing sandbox: real order lifecycle, isolated runs, three-button demo.

Nothing here short-circuits the production path. Checkout calls the PayPal
Sandbox gateway, usage writes four hash-chained telemetry events
through TelemetryService, and the dispute button signs a webhook body and feeds
it through the exact same DisputeService.ingest_webhook path PayPal traffic uses.

Order lifecycle honesty: creating an order is NOT a payment. ``status`` and
``lifecycle_stage`` are PayPal's literal answer (``CREATED`` until the buyer
approves, ``APPROVED`` after approval, ``CAPTURED`` only after a completed
capture). Nothing here promotes an order to CAPTURED on its own, and buyer
approval happens only in the real PayPal UI via the approval_url.

Run isolation: every artifact carries ``run_id``, so a fresh run never surfaces a
previous run's dispute, order or AI analysis. ``POST /runs/reset`` deletes only
``run_*``-scoped rows; see DemoRunService for the exact perimeter.
"""

from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated, Any

from fastapi import APIRouter, Body, Path
from sqlalchemy import select

from app.api import schemas
from app.api.deps import (
    GatewayDep,
    MerchantDep,
    SessionDep,
    SettingsDep,
)
from app.config import GatewayMode, Settings
from app.db.models import DemoRunRecord, PaypalOrder, PaypalTransaction
from app.domain.enums import TelemetryEventType
from app.domain.protocols import OrderCapture, SandboxOrder
from app.domain.telemetry.service import TelemetryService, to_event_out
from app.errors import ConflictError, NotFoundError, UpstreamError, ValidationFailedError
from app.logging_setup import get_logger, log_context
from app.services.demo_run_service import (
    STEP_APPROVAL,
    STEP_CAPTURE,
    STEP_CHECKOUT,
    STEP_DONE,
    STEP_EVIDENCE,
    STEP_FAILED,
    STEP_TELEMETRY,
    DemoRunService,
    validated_run_id,
)
from app.services.dispute_service import (
    quantize_money,
    to_transaction_out,
    utc_aware,
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
# Documented demo defaults: PayPal does not hand us the buyer's IP, so every
# sandbox-created record uses these reserved (TEST-NET-3) values unless the
# caller supplies its own.
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
CAPTURE_STATUS_COMPLETED = "COMPLETED"

ORDER_NOT_APPROVED_MESSAGE = (
    "PayPal reports this order is not approved yet, so there is nothing to capture. "
    "Open the approval_url, approve as the buyer in PayPal, then capture again."
)

OrderIdPath = Annotated[str, Path(min_length=3, max_length=64, description="PayPal order id.")]
RunIdPath = Annotated[str, Path(min_length=5, max_length=64, description="Demo run id.")]

_STAGE_VALUES = frozenset({"CREATED", "APPROVED", "CAPTURED", "FAILED"})


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


def _upstream_code(exc: UpstreamError) -> str:
    """The machine-readable reason a gateway call refused, if it named one.

    The live adapter raises a human message and carries PayPal's ``details[].issue``
    tokens on ``exc.issues``. Reading only the message would misclassify every real
    ``ORDER_NOT_APPROVED`` as an opaque 502.
    """
    message = (exc.message or "").strip()
    if len(message) <= 64 and " " not in message:
        return message.lower()
    return ""


def _has_issue(exc: UpstreamError, *tokens: str) -> bool:
    """True when PayPal named one of these issue tokens."""
    wanted = {token.upper() for token in tokens}
    for issue in getattr(exc, "issues", []) or []:
        if isinstance(issue, str) and issue.upper() in wanted:
            return True
    code = _upstream_code(exc).upper()
    return bool(code) and code in wanted


def _is_not_found(exc: UpstreamError) -> bool:
    return _upstream_code(exc) in {"order_not_found", "order_id_required"} or _has_issue(
        exc, "INVALID_RESOURCE_ID", "RESOURCE_NOT_FOUND"
    )


def _is_not_approved(exc: UpstreamError) -> bool:
    return _upstream_code(exc) == "order_not_approved" or _has_issue(
        exc, "ORDER_NOT_APPROVED"
    )


def _is_already_captured(exc: UpstreamError) -> bool:
    """PayPal says this order already has a capture we do not have a receipt for."""
    return _upstream_code(exc) == "order_already_captured" or _has_issue(
        exc, "ORDER_ALREADY_CAPTURED"
    )


def _usage_events(
    payload: schemas.UsageRequest,
    *,
    client_ip: str,
    device_fingerprint: str,
    run_id: str | None = None,
) -> list[schemas.TelemetryEventIn]:
    """The four canonical demo events, in lifecycle order.

    ``run_id`` rides inside each event's metadata: the ledger is append-only, so
    the run tag must live in the immutable payload rather than a mutable column.
    """
    run_meta: dict[str, Any] = {"run_id": run_id} if run_id else {}
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
            metadata={"plan": "pro", **run_meta},
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.SESSION_AUTH,
            metadata={
                "logins": payload.logins,
                "asn": "AS15169",
                "user_agent": DEMO_USER_AGENT,
                **run_meta,
            },
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.ASSET_DELIVERED,
            resource_id=payload.export_name,
            resource_sha256=_sha256_hex(DEMO_ASSET_PAYLOAD),
            metadata=dict(run_meta),
        ),
        schemas.TelemetryEventIn(
            **common,
            event_type=TelemetryEventType.USAGE_METERED,
            units_consumed=payload.tokens,
            metadata={"logins": payload.logins, **run_meta},
        ),
    ]


def _runs(session: SessionDep, settings: Settings, merchant: MerchantDep) -> DemoRunService:
    """Request-scoped run store bound to the authenticated merchant."""
    return DemoRunService(session, settings=settings, merchant_id=merchant.id)


def _stage(value: str | None) -> str:
    """Normalise to the frozen four-value lifecycle, defaulting to CREATED."""
    token = (value or "").strip().upper()
    return token if token in _STAGE_VALUES else "CREATED"


def _order_stage(order: SandboxOrder) -> str:
    """PayPal's literal lifecycle; only visible fields may name it."""
    stage = _stage(order.lifecycle_stage)
    if stage == "CREATED" and (order.status or "").upper() in _STAGE_VALUES - {"CREATED"}:
        return _stage(order.status)
    return stage


async def _persist_order(
    session: SessionDep,
    *,
    merchant_id: str,
    order: SandboxOrder,
    run_id: str | None,
    settings: Settings,
) -> PaypalOrder:
    """Insert or refresh the server-side order record from PayPal's answer."""
    existing = await session.scalar(
        select(PaypalOrder).where(
            PaypalOrder.merchant_id == merchant_id,
            PaypalOrder.order_id == order.order_id,
        )
    )
    stage = _order_stage(order)
    if existing is None:
        row = PaypalOrder(
            merchant_id=merchant_id,
            order_id=order.order_id,
            run_id=run_id,
            payer_id=order.payer_id or "",
            subscription_id=order.subscription_id,
            amount_usd=quantize_money(order.amount),
            currency=order.currency,
            status=order.status or stage,
            lifecycle_stage=stage,
            approval_url=order.approval_url,
            gateway_mode=settings.gateway_mode.value,
            provenance=settings.provenance,
            paypal_debug_id=order.paypal_debug_id,
            raw_response=dict(order.raw or {}),
        )
        session.add(row)
    else:
        row = existing
        if run_id is not None:
            row.run_id = run_id
        row.status = order.status or stage
        row.lifecycle_stage = stage
        row.approval_url = order.approval_url
        row.gateway_mode = settings.gateway_mode.value
        if order.payer_id:
            row.payer_id = order.payer_id
        if order.subscription_id:
            row.subscription_id = order.subscription_id
        if order.paypal_debug_id:
            row.paypal_debug_id = order.paypal_debug_id
        row.raw_response = dict(order.raw or {})
    await session.commit()
    return row


def _order_status(
    row: PaypalOrder,
    *,
    settings: Settings,
    detail: str | None = None,
) -> schemas.OrderStatusResponse:
    stage = _stage(row.lifecycle_stage)
    payer_action_required = bool(settings.uses_paypal_network and stage == "CREATED")
    if payer_action_required and detail is None:
        detail = "Buyer action required: open approval_url and approve in PayPal."
    return schemas.OrderStatusResponse(
        order_id=row.order_id,
        run_id=row.run_id,
        status=row.status,
        lifecycle_stage=stage,
        amount_usd=quantize_money(row.amount_usd),
        currency=row.currency,
        payer_id=row.payer_id,
        approval_url=row.approval_url,
        capture_id=row.capture_id,
        capture_status=row.capture_status,
        captured_at=utc_aware(row.captured_at),
        gateway_mode=row.gateway_mode,
        provenance=row.provenance,
        paypal_debug_id=row.paypal_debug_id,
        payer_action_required=payer_action_required,
        detail=detail,
    )


async def _run_record(
    session: SessionDep, *, merchant_id: str, run_id: str | None
) -> DemoRunRecord | None:
    """Load a run inside the merchant boundary, or None when it does not exist."""
    if not run_id:
        return None
    record = await session.get(DemoRunRecord, run_id)
    if record is None or record.merchant_id != merchant_id:
        return None
    return record


# --------------------------------------------------------------------------- checkout
@router.post("/sandbox/checkout", response_model=schemas.CheckoutResponse)
async def sandbox_checkout(
    payload: schemas.CheckoutRequest,
    session: SessionDep,
    merchant: MerchantDep,
    gateway: GatewayDep,
    settings: SettingsDep,
) -> schemas.CheckoutResponse:
    """Create one isolated demo run and its PayPal order (an order, not a payment)."""
    payer_id = _validated_payer_id(payload.payer_id) or settings.demo_payer_id
    runs = _runs(session, settings, merchant)
    run = await runs.ensure_run(payload.run_id)
    try:
        order = await gateway.create_order(
            payer_id=payer_id,
            amount=PLAN_AMOUNTS[payload.plan],
            currency="USD",
            description=PLAN_DESCRIPTIONS[payload.plan],
            return_url=settings.paypal_return_url or None,
            cancel_url=settings.paypal_cancel_url or None,
        )
    except UpstreamError:
        # A failed create leaves the run OPEN with checkout marked failed, so the
        # UI can retry honestly instead of showing a phantom order.
        await runs.touch(
            run, step=STEP_CHECKOUT, step_state=STEP_FAILED, payer_id=payer_id
        )
        raise

    stage = _order_stage(order)
    await _persist_order(
        session,
        merchant_id=merchant.id,
        order=order,
        run_id=run.run_id,
        settings=settings,
    )
    await runs.touch(
        run,
        step=STEP_CHECKOUT,
        payer_id=order.payer_id or payer_id,
        order_id=order.order_id,
        order_stage=stage,
        amount=order.amount,
        currency=order.currency,
    )
    logger.info(
        "sandbox_checkout",
        extra=log_context(
            merchant_id=merchant.id,
            run_id=run.run_id,
            order_id=order.order_id,
            plan=payload.plan,
            lifecycle_stage=stage,
            gateway_mode=settings.gateway_mode.value,
            tos_version=payload.tos_version,
        ),
    )
    return schemas.CheckoutResponse(
        order_id=order.order_id,
        run_id=run.run_id,
        subscription_id=order.subscription_id,
        payer_id=order.payer_id or payer_id,
        # Literal PayPal answer: a created order is CREATED, never COMPLETED.
        status=order.status or stage,
        amount_usd=quantize_money(order.amount),
        currency=order.currency,
        approval_url=order.approval_url,
        created_at=utc_aware(order.created_at) or datetime.now(UTC),
        gateway_mode=settings.gateway_mode.value,
        sandbox=settings.gateway_mode is GatewayMode.PAYPAL_SANDBOX,
        lifecycle_stage=stage,
        provenance=settings.provenance,
        paypal_debug_id=order.paypal_debug_id,
    )


# --------------------------------------------------------------------------- order status
@router.get("/sandbox/orders/{order_id}", response_model=schemas.OrderStatusResponse)
async def get_order(
    order_id: OrderIdPath,
    session: SessionDep,
    merchant: MerchantDep,
    gateway: GatewayDep,
    settings: SettingsDep,
) -> schemas.OrderStatusResponse:
    """Authoritative order state from PayPal, mirrored locally.

    Only orders this merchant created are visible: an order the gateway happens
    to know about but no run recorded is ``404``, never adopted across tenants.
    """
    runs = _runs(session, settings, merchant)
    row = await runs.get_order_row(order_id)
    if row is None:
        raise NotFoundError(f"Order {order_id} was not found.")
    try:
        order = await gateway.get_order(order_id)
    except UpstreamError as exc:
        if _is_not_found(exc):
            # PayPal no longer returns this order. Report the persisted
            # truth and say so, rather than inventing a payment or a spurious 502.
            return _order_status(
                row,
                settings=settings,
                detail=(
                    "The gateway no longer has this order; "
                    "the state below is the persisted record."
                ),
            )
        raise

    stage = _order_stage(order)
    row.status = order.status or stage
    row.lifecycle_stage = stage
    row.approval_url = order.approval_url
    if order.payer_id:
        row.payer_id = order.payer_id
    if order.paypal_debug_id:
        row.paypal_debug_id = order.paypal_debug_id
    row.raw_response = dict(order.raw or {})
    await session.commit()

    return _order_status(row, settings=settings)


# --------------------------------------------------------------------------- capture
async def _existing_capture(
    session: SessionDep,
    *,
    merchant_id: str,
    row: PaypalOrder,
    settings: Settings,
) -> schemas.CaptureResponse | None:
    """Idempotent replay: an already-captured order returns its stored receipt."""
    if _stage(row.lifecycle_stage) != "CAPTURED" or not row.capture_id:
        return None
    transaction = await session.scalar(
        select(PaypalTransaction).where(
            PaypalTransaction.merchant_id == merchant_id,
            PaypalTransaction.transaction_id == row.capture_id,
        )
    )
    return schemas.CaptureResponse(
        order_id=row.order_id,
        run_id=row.run_id,
        capture_id=row.capture_id,
        capture_status=row.capture_status or CAPTURE_STATUS_COMPLETED,
        lifecycle_stage="CAPTURED",
        amount_usd=quantize_money(row.amount_usd),
        currency=row.currency,
        payer_id=row.payer_id,
        captured_at=utc_aware(row.captured_at),
        transaction=None if transaction is None else to_transaction_out(transaction),
        gateway_mode=row.gateway_mode,
        provenance=row.provenance,
        paypal_debug_id=row.paypal_debug_id,
        detail="This order was already captured; the stored receipt is returned.",
    )


@router.post("/sandbox/orders/{order_id}/capture", response_model=schemas.CaptureResponse)
async def capture_order(
    order_id: OrderIdPath,
    session: SessionDep,
    merchant: MerchantDep,
    gateway: GatewayDep,
    settings: SettingsDep,
    payload: schemas.CaptureRequest = Body(default_factory=schemas.CaptureRequest),
) -> schemas.CaptureResponse:
    """Capture an approved order. The only path in this module that yields money."""
    runs = _runs(session, settings, merchant)
    row = await runs.get_order_row(order_id)
    if row is None:
        raise NotFoundError(f"Order {order_id} was not found.")

    replay = await _existing_capture(
        session, merchant_id=merchant.id, row=row, settings=settings
    )
    if replay is not None:
        return replay

    run_id = row.run_id or validated_run_id(payload.run_id)
    try:
        capture: OrderCapture = await gateway.capture_order(order_id)
    except UpstreamError as exc:
        if _is_not_found(exc):
            raise NotFoundError(f"Order {order_id} was not found.") from exc
        if _is_already_captured(exc):
            # Money already moved under a capture id we were never told. Report it
            # honestly and do not invent a receipt: GET the order to see the state.
            raise ConflictError(
                "PayPal reports this order already has a capture. Call GET "
                f"/sandbox/orders/{order_id} to read its state; no new capture was made.",
                code="order_already_captured",
            ) from exc
        if _is_not_approved(exc):
            row.lifecycle_stage = "CREATED"
            row.status = "CREATED"
            row.capture_status = "ORDER_NOT_APPROVED"
            await session.commit()
            run = await _run_record(session, merchant_id=merchant.id, run_id=run_id)
            if run is not None:
                await runs.touch(run, step=STEP_CAPTURE, step_state=STEP_FAILED)
            raise ConflictError(
                ORDER_NOT_APPROVED_MESSAGE,
                code="order_not_approved",
                details=[{"field": "order_id", "message": "order_not_approved"}],
            ) from exc
        raise

    captured_at = utc_aware(capture.captured_at) or datetime.now(UTC)
    capture_status = (capture.capture_status or "").upper() or "UNKNOWN"
    completed = capture.completed

    if completed and not capture.capture_id:
        # PayPal claimed completion without an id: refuse to record a payment.
        raise UpstreamError(
            "PayPal reported a completed capture without a capture id; "
            "refusing to record a payment that cannot be identified."
        )

    row.capture_status = capture_status
    row.raw_response = dict(capture.raw or {})
    if capture.paypal_debug_id:
        row.paypal_debug_id = capture.paypal_debug_id
    if capture.amount:
        row.amount_usd = quantize_money(capture.amount)
    if capture.currency:
        row.currency = capture.currency

    transaction: PaypalTransaction | None = None
    if completed and capture.capture_id:
        row.capture_id = capture.capture_id
        row.lifecycle_stage = "CAPTURED"
        row.status = capture_status
        row.captured_at = captured_at
        existing = await session.scalar(
            select(PaypalTransaction).where(
                PaypalTransaction.merchant_id == merchant.id,
                PaypalTransaction.transaction_id == capture.capture_id,
            )
        )
        if existing is None:
            transaction = PaypalTransaction(
                merchant_id=merchant.id,
                transaction_id=capture.capture_id,
                payer_id=capture.payer_id or row.payer_id,
                order_id=row.order_id,
                amount_usd=quantize_money(capture.amount or row.amount_usd),
                currency=capture.currency or row.currency,
                status="CAPTURED",
                # PayPal does not expose the buyer's IP; documented demo defaults.
                client_ip=DEFAULT_CLIENT_IP,
                device_fingerprint=DEFAULT_DEVICE_FINGERPRINT,
                source=settings.provenance,
                capture_id=capture.capture_id,
                run_id=run_id,
                created_at=captured_at,
            )
            session.add(transaction)
        else:
            transaction = existing
            if run_id and not existing.run_id:
                existing.run_id = run_id
    else:
        # Not completed: the order is not paid. Record it as such and never
        # fabricate a transaction row.
        row.lifecycle_stage = "FAILED"
        row.status = capture_status
    await session.commit()

    run = await _run_record(session, merchant_id=merchant.id, run_id=run_id)
    if run is not None:
        if completed:
            await runs.touch(
                run,
                step=STEP_CAPTURE,
                order_stage="CAPTURED",
                capture_id=row.capture_id,
                amount=row.amount_usd,
                currency=row.currency,
                payer_id=row.payer_id,
                status="COMPLETED",
                steps={STEP_APPROVAL: STEP_DONE},
            )
        else:
            await runs.touch(run, step=STEP_CAPTURE, step_state=STEP_FAILED)

    logger.info(
        "sandbox_capture",
        extra=log_context(
            order_id=row.order_id,
            run_id=run_id,
            capture_id=row.capture_id,
            capture_status=capture_status,
            lifecycle_stage=row.lifecycle_stage,
        ),
    )
    return schemas.CaptureResponse(
        order_id=row.order_id,
        run_id=run_id,
        capture_id=row.capture_id,
        capture_status=capture_status,
        lifecycle_stage="CAPTURED" if completed else "FAILED",
        amount_usd=quantize_money(row.amount_usd),
        currency=row.currency,
        payer_id=row.payer_id,
        captured_at=utc_aware(row.captured_at) if completed else None,
        transaction=None if transaction is None else to_transaction_out(transaction),
        gateway_mode=row.gateway_mode,
        provenance=row.provenance,
        paypal_debug_id=row.paypal_debug_id,
        detail=(
            "Capture completed by PayPal."
            if completed
            else f"PayPal reported capture status {capture_status}; no payment recorded."
        ),
    )


# --------------------------------------------------------------------------- usage
@router.post("/sandbox/usage", response_model=schemas.UsageResponse)
async def simulate_usage(
    payload: schemas.UsageRequest,
    merchant: MerchantDep,
    session: SessionDep,
    settings: SettingsDep,
) -> schemas.UsageResponse:
    """Record the four signed lifecycle events that form the system of record."""
    payer_id = _validated_payer_id(payload.payer_id)
    if payer_id is None:
        raise ValidationFailedError("payer_id is required.")
    run_id = validated_run_id(payload.run_id)
    runs = _runs(session, settings, merchant)
    run = await _run_record(session, merchant_id=merchant.id, run_id=run_id)
    if run_id is not None and run is None:
        raise NotFoundError(f"Demo run {run_id} was not found.")

    client_ip = (payload.client_ip or DEFAULT_CLIENT_IP).strip()
    device_fingerprint = (payload.device_fingerprint or DEFAULT_DEVICE_FINGERPRINT).strip()
    events = _usage_events(
        payload.model_copy(update={"payer_id": payer_id}),
        client_ip=client_ip,
        device_fingerprint=device_fingerprint,
        run_id=run_id,
    )
    service = TelemetryService(session, merchant.id)
    results = await service.record_many(events)
    chain = await service.verify(payer_id)
    if run is not None:
        await runs.touch(
            run,
            payer_id=payer_id,
            steps={STEP_TELEMETRY: STEP_DONE, STEP_EVIDENCE: STEP_DONE},
            telemetry_token=chain.head_hash,
        )
    return schemas.UsageResponse(
        chain=chain,
        events=[to_event_out(result.row) for result in results],
        totals={"logins": payload.logins, "tokens": payload.tokens, "assets": 1},
        run_id=run_id,
    )


# --------------------------------------------------------------------------- runs
@router.get("/sandbox/runs", response_model=schemas.DemoRunList)
async def list_runs(
    session: SessionDep, merchant: MerchantDep, settings: SettingsDep
) -> schemas.DemoRunList:
    """Every demo run for this merchant, newest first."""
    return await _runs(session, settings, merchant).list_demo_runs()


@router.get("/sandbox/runs/{run_id}", response_model=schemas.DemoRun)
async def get_run(
    run_id: RunIdPath,
    session: SessionDep,
    merchant: MerchantDep,
    settings: SettingsDep,
) -> schemas.DemoRun:
    """One run with its derived proof: chain, case, AI analysis and dossier."""
    runs = _runs(session, settings, merchant)
    record = await runs.get_run(run_id)
    return await runs.to_demo_run(record)


@router.post("/sandbox/runs/reset", response_model=schemas.DemoResetResponse)
async def reset_runs(
    session: SessionDep, merchant: MerchantDep, settings: SettingsDep
) -> schemas.DemoResetResponse:
    """Clear demo-scoped records and hand back a fresh run id.

    Deletes only rows tagged with a ``run_*`` run id (plus their dispute actions
    and deterministic webhook records). The merchant row, the append-only
    telemetry ledger and every non-demo record survive untouched — see
    DemoRunService.reset for the full perimeter.
    """
    return await _runs(session, settings, merchant).reset()
