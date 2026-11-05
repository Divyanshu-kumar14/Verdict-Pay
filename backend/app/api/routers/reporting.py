"""Merchant-facing exposure, win-rate and transaction reporting."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api import schemas
from app.api.routers.disputes import ServiceDep
from app.services.dispute_service import to_transaction_out

router = APIRouter(tags=["reporting"])


@router.get("/reporting/summary", response_model=schemas.ReportingSummary)
async def reporting_summary(service: ServiceDep) -> schemas.ReportingSummary:
    """Exact aggregates over the merchant's case book."""
    return await service.reporting_summary()


@router.get("/reporting/transactions", response_model=list[schemas.TransactionOut])
async def list_transactions(
    service: ServiceDep,
    payer_id: Annotated[
        str | None,
        Query(min_length=3, max_length=64, description="Optional PayPal payer id filter."),
    ] = None,
    limit: Annotated[int, Query(ge=1, le=200, description="Max rows returned.")] = 50,
) -> list[schemas.TransactionOut]:
    """Cached PayPal transactions used for Visa CE 3.0 lookbacks, newest first."""
    transactions = await service.list_transactions(payer_id=payer_id, limit=limit)
    return [to_transaction_out(transaction) for transaction in transactions]
