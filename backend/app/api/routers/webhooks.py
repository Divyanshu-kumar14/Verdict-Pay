"""Inbound PayPal webhooks.

No API key here: authenticity is established by the gateway's signature check
(PayPal verify-webhook-signature).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

from app.api.deps import GatewayDep, NarrativeDep, SearchDep, SessionDep, SettingsDep
from app.services.dispute_service import DisputeService

router = APIRouter(tags=["webhooks"])


@router.post("/webhooks/paypal")
async def paypal_webhook(
    request: Request,
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    narrative: NarrativeDep,
    search: SearchDep,
) -> dict[str, Any]:
    """Verify, de-duplicate and process one PayPal dispute event."""
    raw_body = await request.body()
    service = DisputeService(
        session,
        settings=settings,
        gateway=gateway,
        narrative=narrative,
        search=search,
    )
    record, case = await service.ingest_webhook(headers=dict(request.headers), raw_body=raw_body)
    duplicate = bool(getattr(record, "is_duplicate", False))
    body: dict[str, Any] = {
        "received": True,
        "event_id": record.event_id,
        "duplicate": duplicate,
    }
    if case is not None:
        body["dispute_id"] = case.dispute_id
    return body
