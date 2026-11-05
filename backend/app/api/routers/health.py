"""Liveness/readiness. Never touches PayPal or the network."""

from __future__ import annotations

import time
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from app import __version__
from app.api.schemas import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    started = getattr(request.app.state, "started_at", time.monotonic())
    return HealthResponse(
        status="ok",
        mode=settings.paypal_mode,
        version=__version__,
        database=settings.database_url.split("://", 1)[0],
        gateway=getattr(request.app.state.gateway, "mode", "unknown"),
        llm=getattr(request.app.state.narrative, "mode", "unknown"),
        demo_mode=settings.demo_mode,
        uptime_seconds=round(time.monotonic() - started, 3),
        timestamp=datetime.now(UTC),
    )
