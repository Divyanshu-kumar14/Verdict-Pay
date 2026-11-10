"""Seller-protection evidence dossier endpoints."""

from __future__ import annotations

import io
from typing import Annotated

from fastapi import APIRouter, Depends, Path
from fastapi.responses import StreamingResponse

from app.api import schemas
from app.api.deps import GatewayDep, MerchantDep, NarrativeDep, SessionDep, SettingsDep
from app.services.evidence_service import (
    DOSSIER_MANIFEST_URL_TEMPLATE,
    DOSSIER_VERIFY_URL_TEMPLATE,
    EvidenceService,
    dossier_filename,
    sha256_hex,
)

router = APIRouter(tags=["evidence"])

DisputeId = Annotated[
    str,
    Path(
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9-]+$",
        description="PayPal dispute id (letters, digits and '-'; no path segments).",
    ),
]


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
    """Render (or serve the frozen) deterministic PDF dossier for a dispute."""
    pdf_bytes, _facts = await service.build_dossier(dispute_id)
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="{dossier_filename(dispute_id)}"',
            "Content-Length": str(len(pdf_bytes)),
            # Same digest the manifest publishes, so a judge can hash the body and
            # compare without a second request.
            "X-Dossier-SHA256": sha256_hex(pdf_bytes),
        },
    )


@router.get("/disputes/{dispute_id}/dossier/manifest", response_model=schemas.DossierManifest)
async def dossier_manifest(dispute_id: DisputeId, service: ServiceDep) -> schemas.DossierManifest:
    """Dossier identity: full SHA-256, size, snapshot hash and chain state."""
    return await service.build_manifest(dispute_id)


@router.get("/disputes/{dispute_id}/dossier/verify", response_model=schemas.DossierVerification)
async def dossier_verify(dispute_id: DisputeId, service: ServiceDep) -> schemas.DossierVerification:
    """Re-render from the frozen snapshot and report whether the bytes match."""
    return await service.verify(dispute_id)


__all__ = [
    "DOSSIER_MANIFEST_URL_TEMPLATE",
    "DOSSIER_VERIFY_URL_TEMPLATE",
    "router",
]
