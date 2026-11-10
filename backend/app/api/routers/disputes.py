"""Dispute triage queue, case room and action-rail endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Response
from fastapi import status as http_status

from app.api import schemas
from app.api.deps import (
    GatewayDep,
    MerchantDep,
    NarrativeDep,
    SearchDep,
    SessionDep,
    SettingsDep,
)
from app.domain.enums import (
    ActionStatus,
    DisputeAction,
    DisputeStage,
    DisputeStatus,
    RecommendedAction,
)
from app.services.dispute_service import DisputeService, to_dispute_summary

router = APIRouter(tags=["disputes"])

DisputeId = Annotated[
    str,
    Path(
        min_length=3,
        max_length=64,
        pattern=r"^[A-Za-z0-9-]+$",
        description="PayPal dispute id (letters, digits and '-'; no path segments).",
    ),
]


def get_dispute_service(
    session: SessionDep,
    settings: SettingsDep,
    gateway: GatewayDep,
    narrative: NarrativeDep,
    search: SearchDep,
    merchant: MerchantDep,
) -> DisputeService:
    """Build a request-scoped, merchant-scoped orchestration service.

    The service is intentionally created per request: it holds no cross-request
    state, and the merchant comes from the authenticated API key — never from
    the request body.
    """
    return DisputeService(
        session,
        settings=settings,
        gateway=gateway,
        narrative=narrative,
        search=search,
        merchant_id=merchant.id,
    )


ServiceDep = Annotated[DisputeService, Depends(get_dispute_service)]


@router.get("/disputes", response_model=schemas.DisputePage)
async def list_disputes(
    service: ServiceDep,
    page: Annotated[int, Query(ge=1, description="1-based page number.")] = 1,
    per_page: Annotated[int, Query(ge=1, le=100, description="Rows per page.")] = 20,
    stage: Annotated[DisputeStage | None, Query(description="Filter by lifecycle stage.")] = None,
    status_filter: Annotated[
        DisputeStatus | None, Query(alias="status", description="Filter by case status.")
    ] = None,
    recommended_action: Annotated[
        RecommendedAction | None, Query(description="Filter by recommended action.")
    ] = None,
) -> schemas.DisputePage:
    """Paginated triage queue, newest case first."""
    cases, total = await service.list_cases(
        page=page,
        per_page=per_page,
        stage=stage,
        status=status_filter,
        recommended_action=recommended_action,
    )
    return schemas.DisputePage(
        data=[to_dispute_summary(case) for case in cases],
        meta=schemas.PageMeta(
            total=total,
            page=page,
            per_page=per_page,
            total_pages=(total + per_page - 1) // per_page,
        ),
    )


@router.get("/disputes/{dispute_id}", response_model=schemas.DisputeDetail)
async def get_dispute(dispute_id: DisputeId, service: ServiceDep) -> schemas.DisputeDetail:
    """Full case room payload: EV breakdown, signals, allowed actions, audit trail."""
    return await service.build_detail(dispute_id)


@router.post("/disputes/{dispute_id}/triage", response_model=schemas.TriageResponse)
async def triage_dispute(dispute_id: DisputeId, service: ServiceDep) -> schemas.TriageResponse:
    """Recompute win probability, EV and the recommended action from locked facts."""
    decision = await service.triage_case(dispute_id)
    detail = await service.build_detail(dispute_id)
    return schemas.TriageResponse(
        dispute_id=detail.dispute_id,
        recommended_action=decision.action,
        breakdown=detail.breakdown,
        win_probability=detail.win_probability,
        allowed_actions=detail.allowed_actions,
        rationale=detail.rationale,
    )


@router.post("/disputes/{dispute_id}/actions/{action}", response_model=schemas.ActionResponse)
async def execute_dispute_action(
    dispute_id: DisputeId,
    action: DisputeAction,
    request: schemas.ActionRequest,
    response: Response,
    service: ServiceDep,
) -> schemas.ActionResponse:
    """Execute one HATEOAS-guarded PayPal action; evidence uploads return 202."""
    record, case = await service.execute_action(dispute_id, action, request)
    if action is DisputeAction.PROVIDE_EVIDENCE:
        response.status_code = http_status.HTTP_202_ACCEPTED
    return schemas.ActionResponse(
        action_id=record.id,
        dispute_id=case.dispute_id,
        action=DisputeAction(record.action),
        status=ActionStatus(record.status),
        latency_ms=record.latency_ms,
        upstream=dict(record.response_payload or {}),
        case=to_dispute_summary(case),
    )
