"""Grounded AI analysis endpoints.

"AI explains and drafts; rules decide." POST /disputes/{id}/ai/analyze
classifies the buyer claim text with Gemini and drafts a grounded evidence
narrative, but win probability and expected value always come from the
deterministic engine via build_detail — never from the model. GET
/disputes/{id}/ai returns the cached last result without re-billing.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Body

from app.api.routers.disputes import DisputeId, ServiceDep
from app.domain.telemetry.service import TelemetryService
from app.integrations.ai import claim_classifier, explain, fallback
from app.integrations.ai.client import GeminiClient, safe_error_reason
from app.integrations.ai.evidence_drafter import draft_evidence
from app.integrations.ai.prompts.v1 import (
    CLASSIFY_SYSTEM,
    CLASSIFY_USER_TEMPLATE,
    PROMPT_VERSION,
    sanitize_untrusted,
)
from app.integrations.ai.provenance import record_provenance
from app.integrations.ai.schemas import (
    AnalyzeRequest,
    AnalyzeResponse,
    ClaimCategory,
    ClaimClassification,
    ProvenanceRecord,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ai"])

CLASSIFY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "category": {"type": "string"},
        "confidence": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["category", "confidence", "rationale"],
}

# Idempotency cache: repeat calls neither re-bill Gemini nor re-append chain
# events. Keyed by (dispute_id, prompt_version, sha256(claim_text + chain head))
# so a new claim text or new telemetry produces a fresh analysis.
_CACHE: dict[tuple[str, str, str], AnalyzeResponse] = {}


def _cache_key(dispute_id: str, claim_text: str | None, chain_head: str) -> tuple[str, str, str]:
    digest = hashlib.sha256(f"{claim_text or ''}\x00{chain_head}".encode()).hexdigest()
    return dispute_id, PROMPT_VERSION, digest


def _classify_deterministic(claim_text: str | None) -> ClaimClassification:
    """Keyword classification mapped through the frozen rules table."""
    category, confidence, rationale = fallback.classify_claim(claim_text)
    guarded = claim_classifier.guarded_category(category, confidence)
    reason = claim_classifier.reason_for_category(guarded)
    return ClaimClassification(
        category=guarded,
        confidence=max(0.0, min(1.0, float(confidence))),
        rationale=rationale,
        reason_code=reason.value,
        reason_multiplier=claim_classifier.multiplier_for_reason(reason.value),
    )


def _parse_model_classification(payload: dict[str, Any]) -> ClaimClassification:
    """Validate raw model JSON; out-of-contract values raise ValueError."""
    category = ClaimCategory(str(payload.get("category", "") or ""))
    try:
        confidence = float(payload.get("confidence", 0.0))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"bad confidence: {payload.get('confidence')!r}") from exc
    rationale = str(payload.get("rationale", "") or "")[:500]
    guarded = claim_classifier.guarded_category(category, confidence)
    reason = claim_classifier.reason_for_category(guarded)
    return ClaimClassification(
        category=guarded,
        confidence=max(0.0, min(1.0, confidence)),
        rationale=rationale,
        reason_code=reason.value,
        reason_multiplier=claim_classifier.multiplier_for_reason(reason.value),
    )


async def _analyze(
    dispute_id: str, service: ServiceDep, claim_override: str | None
) -> AnalyzeResponse:
    # Deterministic money inputs first: 404s propagate, model never involved.
    case = await service.get_case(dispute_id)
    persisted_claim = (case.facts_snapshot or {}).get("buyer_claim_text")
    claim_text = (claim_override or "") or (persisted_claim or "") or None
    snapshot_head = str((case.facts_snapshot or {}).get("chain_head") or "")
    key = _cache_key(dispute_id, claim_text, snapshot_head)
    cached = _CACHE.get(key)
    if cached is not None:
        return cached
    detail = await service.build_detail(dispute_id)
    injection_marker = fallback.detect_injection(claim_text)
    veto_codes = [fallback.VETO_PROMPT_INJECTION_BLOCKED] if injection_marker else []
    if injection_marker:
        await service.record_ai_veto(
            dispute_id=dispute_id,
            veto_code=fallback.VETO_PROMPT_INJECTION_BLOCKED,
            detail=f"marker={injection_marker}",
        )
    settings = service.settings
    merchant_name = settings.demo_merchant_name
    stage = detail.stage.value
    # Pass the comparison so the plain-English summary can distinguish the
    # policy pick from the cheapest modelled loss instead of implying they are
    # the same decision.
    explanation = explain.explain(
        detail.breakdown, detail.win_probability, detail.decision_comparison
    )

    def _finish(
        classification: ClaimClassification,
        narrative: Any,
        provenance: ProvenanceRecord,
        degraded: bool,
        degraded_reason: str | None,
    ) -> AnalyzeResponse:
        response = AnalyzeResponse(
            dispute_id=dispute_id,
            prompt_version=PROMPT_VERSION,
            generated_at=datetime.now(UTC),
            classification=classification,
            win_probability=detail.win_probability,
            expected_value=detail.breakdown,
            narrative=narrative,
            explanation=explanation,
            provenance=provenance,
            degraded=degraded,
            degraded_reason=degraded_reason,
            veto_codes=veto_codes,
        )
        _CACHE[key] = response
        return response

    if not settings.ai_enabled or not settings.gemini_api_key:
        classification = _classify_deterministic(claim_text)
        narrative = fallback.draft_narrative(
            facts=detail.facts,
            reason_code=classification.reason_code,
            stage=stage,
            amount_usd=detail.amount_usd,
            merchant_name=merchant_name,
        )
        return _finish(
            classification,
            narrative,
            ProvenanceRecord(recorded=False, note="ai_disabled"),
            True,
            "ai_disabled",
        )
    try:
        client: GeminiClient | None = GeminiClient(settings)
        payload = await client.generate_json(
            system=CLASSIFY_SYSTEM,
            user=CLASSIFY_USER_TEMPLATE.format(claim_text=sanitize_untrusted(claim_text)),
            schema=CLASSIFY_SCHEMA,
        )
        if payload is None:  # pragma: no cover - guarded above
            raise RuntimeError("gemini client unavailable")
        classification = _parse_model_classification(payload)
        if injection_marker:
            # The model may have been steered; the deterministic guard wins.
            classification = _classify_deterministic(claim_text)
        narrative = await draft_evidence(
            client=client,
            facts=detail.facts,
            reason_code=classification.reason_code,
            stage=stage,
            amount_usd=detail.amount_usd,
            merchant_name=merchant_name,
            model=settings.gemini_model,
            max_retries=settings.ai_max_retries,
        )
        degraded = narrative.model == "template"
        if degraded:
            # No AI_GENERATION chain event for prose the model did not write.
            provenance = ProvenanceRecord(recorded=False, note="template_fallback")
            return _finish(
                classification, narrative, provenance, True, "model draft fell back to template"
            )
        telemetry = TelemetryService(service.session, service.merchant_id)
        provenance = await record_provenance(
            telemetry=telemetry,
            payer_id=detail.payer_id,
            dispute_id=dispute_id,
            model=settings.gemini_model,
            prompt_version=PROMPT_VERSION,
            category=classification.category.value,
        )
        return _finish(classification, narrative, provenance, False, None)
    except Exception as exc:
        # Log the class + HTTP code/status only: provider messages can echo
        # request content or a key, so the message body is never used.
        reason = safe_error_reason(exc)
        logger.warning("ai analyze degraded for %s: %s", dispute_id, reason)
        classification = _classify_deterministic(claim_text)
        narrative = fallback.draft_narrative(
            facts=detail.facts,
            reason_code=classification.reason_code,
            stage=stage,
            amount_usd=detail.amount_usd,
            merchant_name=merchant_name,
        )
        return _finish(
            classification,
            narrative,
            ProvenanceRecord(recorded=False, note="model_error"),
            True,
            f"model_error:{reason}",
        )


@router.post("/disputes/{dispute_id}/ai/analyze", response_model=AnalyzeResponse)
async def analyze_dispute(
    dispute_id: DisputeId,
    service: ServiceDep,
    body: AnalyzeRequest = Body(default_factory=AnalyzeRequest),
) -> AnalyzeResponse:
    """Classify the claim and draft a grounded narrative (rules still decide)."""
    return await _analyze(dispute_id, service, body.claim_text)


@router.get("/disputes/{dispute_id}/ai", response_model=AnalyzeResponse)
async def get_analysis(dispute_id: DisputeId, service: ServiceDep) -> AnalyzeResponse:
    """Return the cached last result, computing it once if never analyzed."""
    return await _analyze(dispute_id, service, None)
