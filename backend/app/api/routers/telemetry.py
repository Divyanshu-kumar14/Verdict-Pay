"""Telemetry ingest, chain verification and the customer timeline.

Paths are declared relative to the /api/v1 prefix that main.py adds. Every route
requires X-API-Key (or a bearer token) and is scoped to that merchant: a caller
can never see another merchant's ledger rows.

POST /telemetry/events is authenticated twice: the API key identifies the
merchant, and the SDK signature proves the exact body came from that merchant's
client. The raw bytes must carry X-VerdictPay-Timestamp and
X-VerdictPay-Signature, where the signature is HMAC-SHA256 over
"<timestamp>.<raw body>" (see app.security.compute_signature). The signature is
checked against the raw bytes before they are parsed and is never recomputed
from re-serialised JSON, so whitespace or key ordering cannot be smuggled in.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Header, Path, Request
from fastapi.exceptions import RequestValidationError
from pydantic import TypeAdapter, ValidationError

from app.api.deps import MerchantDep, SessionDep, SettingsDep
from app.api.schemas import (
    ChainVerification,
    CustomerTimeline,
    TelemetryBatchIn,
    TelemetryEventIn,
    TelemetryIngestResponse,
)
from app.config import Settings
from app.domain.telemetry.service import TelemetryService, to_event_out
from app.errors import UnauthorizedError
from app.security import verify_signature

router = APIRouter(tags=["telemetry"])

PayerIdPath = Annotated[str, Path(min_length=3, max_length=64)]
TelemetryIngestBody = TelemetryEventIn | TelemetryBatchIn
_INGEST_BODY_ADAPTER: TypeAdapter[TelemetryIngestBody] = TypeAdapter(TelemetryIngestBody)


def _parse_ingest_body(raw_body: bytes) -> TelemetryIngestBody:
    """Parse raw ingest bytes, rendering field errors through the 422 envelope."""
    try:
        return _INGEST_BODY_ADAPTER.validate_json(raw_body)
    except ValidationError as exc:
        errors: list[dict[str, object]] = []
        for error in exc.errors():
            enriched: dict[str, object] = dict(error)
            enriched["loc"] = ("body", *tuple(error.get("loc", ())))
            errors.append(enriched)
        raise RequestValidationError(errors) from exc


def _require_signature(
    *,
    settings: Settings,
    raw_body: bytes,
    timestamp: str | None,
    signature: str | None,
) -> None:
    """Reject unsigned or badly signed ingest bodies before they are parsed."""
    if not timestamp or not signature:
        if settings.require_signed_telemetry:
            raise UnauthorizedError(
                "Signed telemetry is required.",
                code="signature_required",
            )
        return
    verified, reason = verify_signature(
        secret=settings.verdictpay_signing_secret,
        timestamp=timestamp,
        body=raw_body,
        signature=signature,
        tolerance_seconds=settings.webhook_tolerance_seconds,
    )
    if not verified:
        failure = reason or "signature_mismatch"
        raise UnauthorizedError(
            "Signature could not be verified.",
            code="signature_invalid",
            details=[{"field": "X-VerdictPay-Signature", "message": failure}],
        )


@router.post("/telemetry/events", response_model=TelemetryIngestResponse)
async def ingest_events(
    request: Request,
    session: SessionDep,
    merchant: MerchantDep,
    settings: SettingsDep,
    timestamp: Annotated[str | None, Header(alias="X-VerdictPay-Timestamp")] = None,
    signature: Annotated[str | None, Header(alias="X-VerdictPay-Signature")] = None,
) -> TelemetryIngestResponse:
    """Append one event or a batch to the merchant's hash-chained ledger.

    A batch may contain at most 500 events (enforced by the request model; an
    oversized batch is a 422). Replayed event ids are reported as duplicates and
    are not appended a second time.
    """
    raw_body = await request.body()
    _require_signature(
        settings=settings,
        raw_body=raw_body,
        timestamp=timestamp,
        signature=signature,
    )
    body = _parse_ingest_body(raw_body)
    events = [body] if isinstance(body, TelemetryEventIn) else list(body.events)
    service = TelemetryService(session, merchant.id)
    results = await service.record_many(events)
    accepted = sum(1 for result in results if result.created)
    # A batch normally covers one payer; a mixed batch reports the first payer's
    # proof so the response stays a single, honest ChainVerification.
    chain = await service.verify(events[0].paypal_payer_id)
    return TelemetryIngestResponse(
        accepted=accepted,
        duplicates=len(results) - accepted,
        events=[to_event_out(result.row) for result in results],
        chain=chain,
    )


@router.get("/telemetry/chain/{payer_id}/verify", response_model=ChainVerification)
async def verify_chain(
    payer_id: PayerIdPath,
    session: SessionDep,
    merchant: MerchantDep,
) -> ChainVerification:
    """Recompute the customer's chain and report the first broken link, if any."""
    return await TelemetryService(session, merchant.id).verify(payer_id)


@router.get("/customers/{payer_id}/timeline", response_model=CustomerTimeline)
async def customer_timeline(
    payer_id: PayerIdPath,
    session: SessionDep,
    merchant: MerchantDep,
) -> CustomerTimeline:
    """Return the customer's ordered events, aggregate summary and chain proof."""
    return await TelemetryService(session, merchant.id).timeline(payer_id)
