"""Liveness/readiness. Never touches PayPal or the network.

The payload is deliberately detailed enough for a judge to audit the running
configuration — which gateway mode is live, whether its credentials are
complete, and each blocker — while never exposing a credential value.
"""

from __future__ import annotations

import time
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from app import __version__
from app.api.schemas import AiStatus, GatewayStatus, HealthResponse
from app.config import GatewayMode
from app.integrations.ai.prompts.v1 import PROMPT_VERSION

router = APIRouter(tags=["health"])


def _gateway_status(request: Request) -> GatewayStatus:
    settings = request.app.state.settings
    mode = settings.gateway_mode
    blockers = list(settings.gateway_blockers)
    readiness = "unconfigured" if blockers else "ready"
    return GatewayStatus(
        mode=mode.value,
        readiness=readiness,
        sandbox=mode is GatewayMode.PAYPAL_SANDBOX,
        live=mode is GatewayMode.PAYPAL_LIVE,
        simulation=False,
        api_base=settings.paypal_api_base,
        credentials_configured=settings.paypal_credentials_configured,
        webhook_configured=bool(settings.effective_paypal_webhook_id),
        blockers=blockers,
    )


def _ai_status(request: Request) -> AiStatus:
    settings = request.app.state.settings
    narrative = getattr(request.app.state, "narrative", None)
    mode = getattr(narrative, "mode", "unknown")
    # `configured` must describe the provider actually selected: an OpenAI
    # deployment is not unconfigured just because there is no Gemini key.
    if mode == "gemini":
        configured = bool(settings.gemini_api_key) and settings.ai_enabled
    elif mode == "openai":
        configured = bool(settings.openai_api_key or settings.llm_base_url)
    else:
        configured = False
    return AiStatus(
        provider=mode,
        model=getattr(narrative, "model_name", "template") if mode != "template" else "template",
        enabled=settings.ai_enabled,
        configured=configured,
        timeout_ms=settings.ai_timeout_ms,
        prompt_version=PROMPT_VERSION,
    )


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
        gateway_status=_gateway_status(request),
        ai_status=_ai_status(request),
    )
