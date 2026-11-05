"""Seller-protection evidence dossier endpoints."""

from __future__ import annotations

import io
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from fastapi.responses import StreamingResponse

from app.api.deps import GatewayDep, MerchantDep, NarrativeDep, SessionDep, SettingsDep
from app.services.evidence_service import EvidenceService

router = APIRouter(tags=["evidence"])

DisputeId = Annotated[str, Path(min_length=3, max_length=64, description="PayPal dispute id.")]


def get_evidence_service(
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    narrative: NarrativeDep,
    merchant: MerchantDep,
) -> EvidenceService:
    """Request-scoped evidence service bound to the authenticated merchant."""
    return EvidenceService(
        session,
        settings=settings,
        gateway=gateway,
        narrative=narrative,
        merchant_id=merchant.id,
    )


ServiceDep = Annotated[EvidenceService, Depends(get_evidence_service)]


@router.get("/disputes/{dispute_id}/dossier.pdf")
async def download_dossier(dispute_id: DisputeId, service: ServiceDep) -> StreamingResponse:
    """Render (or serve the cached) deterministic PDF dossier for a dispute."""
    pdf_bytes, _facts = await service.build_dossier(dispute_id)
    filename = f"VerdictPay_Dossier_{dispute_id}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Length": str(len(pdf_bytes)),
        },
    )
