"""Trusted bridge between the API and the isolated Sentinel.

``authorize`` turns a dispute case + requested action into a TriageProposal,
runs it through the subprocess Sentinel, records the verdict (ALLOW or VETO)
in ``sentinel_audit_log`` *and* on the SHA-256 ``SENTINEL-AUDIT`` telemetry
chain, and on ALLOW issues an HMAC ApprovalToken. A VETO raises
``SentinelVetoError`` (HTTP 422) with the veto codes.
"""

from __future__ import annotations

import uuid
from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.config import Settings
from app.db.models import SentinelAuditRecord
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.service import TelemetryService
from app.errors import SentinelVetoError
from app.logging_setup import get_logger, log_context
from app.sentinel import sandbox_runner, token

logger = get_logger("verdictpay.sentinel")
AUDIT_PAYER_ID = "SENTINEL-AUDIT"


def build_proposal(
    *,
    dispute_id: str,
    action: str,
    stage: str,
    channel: str,
    reason_code: str,
    payment_rail: str,
    external_reason_code: str | None,
    amount_minor: int,
    currency: str,
    hateoas_rels: list[str],
    portfolio: Mapping[str, Any] | None = None,
    untrusted_text: str | None = None,
    offer_amount_minor: int | None = None,
    offer_note: str | None = None,
    candidate_mode: str = "HARDENED",
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    reason = (
        "UNAUTHORISED" if reason_code.upper() in {"UNAUTHORIZED", "UNAUTHORISED"} else (reason_code)
    )
    proposal: dict[str, Any] = {
        "proposal_id": str(uuid.uuid4()),
        "dispute_id": dispute_id,
        "payment_rail": payment_rail,
        "dispute_channel": channel,
        "dispute_life_cycle_stage": stage,
        "reason": reason,
        "external_reason_code": external_reason_code,
        "proposed_action": action,
        "dispute_amount_minor": amount_minor,
        "currency": currency,
        "hateoas_rels": sorted(hateoas_rels),
        "portfolio": dict(portfolio) if portfolio else None,
        "untrusted_text": (untrusted_text or "")[:8000] or None,
        "offer_payload": (
            {"offer_amount_minor": offer_amount_minor, "note": offer_note or ""}
            if offer_amount_minor is not None
            else None
        ),
        "candidate_mode": candidate_mode,
    }
    if extra:
        proposal.update(dict(extra))
    return proposal


async def record_verdict(
    session: AsyncSession,
    *,
    merchant_id: str,
    verdict: Mapping[str, Any],
    paypal_debug_id: str | None = None,
) -> SentinelAuditRecord:
    """Persist the verdict and append it to the SENTINEL-AUDIT hash chain."""
    telemetry = TelemetryService(session, merchant_id)
    result = await telemetry.record(
        schemas.TelemetryEventIn(
            event_type=TelemetryEventType.SENTINEL_VERDICT,
            paypal_payer_id=AUDIT_PAYER_ID,
            client_ip="sentinel",
            device_fingerprint="sentinel",
            metadata={
                "proposal_id": verdict.get("proposal_id"),
                "dispute_id": verdict.get("dispute_id"),
                "action": verdict.get("proposed_action"),
                "verdict": verdict.get("verdict"),
                "exit_code": verdict.get("exit_code"),
                "veto_codes": list(verdict.get("veto_codes") or []),
                "manifest_sha256": verdict.get("manifest_sha256"),
                "candidate_mode": verdict.get("candidate_mode", "HARDENED"),
            },
            event_id=uuid.uuid4().hex,
        )
    )
    record = SentinelAuditRecord(
        merchant_id=merchant_id,
        proposal_id=str(verdict.get("proposal_id") or uuid.uuid4()),
        dispute_id=str(verdict.get("dispute_id") or "")[:64] or "unknown",
        candidate_mode=str(verdict.get("candidate_mode") or "HARDENED")[:16],
        proposed_action=str(verdict.get("proposed_action") or "")[:32],
        verdict=str(verdict.get("verdict") or "VETO")[:8],
        exit_code=int(verdict.get("exit_code") or 2),
        veto_codes=list(verdict.get("veto_codes") or []),
        manifest_sha256=str(verdict.get("manifest_sha256") or "0" * 64),
        chain_hash=result.row.chain_hash,
        paypal_debug_id=paypal_debug_id,
    )
    session.add(record)
    await session.flush()
    return record


async def evaluate(proposal: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
    """Run the isolated Sentinel; the verdict carries the proposal's mode."""
    exit_code, verdict = await sandbox_runner.run(dict(proposal))
    verdict.setdefault("candidate_mode", proposal.get("candidate_mode", "HARDENED"))
    verdict.setdefault("proposed_action", proposal.get("proposed_action"))
    if not verdict.get("dispute_id"):
        verdict["dispute_id"] = str(proposal.get("dispute_id") or "")[:64]
    if not verdict.get("proposal_id"):
        verdict["proposal_id"] = str(proposal.get("proposal_id") or "")
    return exit_code, verdict


async def authorize(
    session: AsyncSession,
    *,
    settings: Settings,
    merchant_id: str,
    proposal: Mapping[str, Any],
) -> dict[str, Any]:
    """Gate one PayPal write. Returns the verdict with a signed token, or raises."""
    exit_code, verdict = await evaluate(proposal)
    audit = await record_verdict(session, merchant_id=merchant_id, verdict=verdict)
    if exit_code != 0:
        await session.commit()
        logger.warning(
            "sentinel_veto",
            extra=log_context(
                dispute_id=verdict.get("dispute_id"), veto_codes=verdict.get("veto_codes")
            ),
        )
        raise SentinelVetoError(
            details=[
                {
                    "exit_code": 2,
                    "veto_code": code,
                    "reason": reason,
                    "audit_id": audit.id,
                    "chain_hash": audit.chain_hash,
                }
                for code, reason in zip(
                    verdict.get("veto_codes") or ["VETO"],
                    (verdict.get("reasons") or []) + [""] * 16,
                    strict=False,
                )
            ]
        )
    verdict["hmac_approval_token"] = token.issue(
        secret=settings.verdictpay_signing_secret,
        proposal_id=str(proposal.get("proposal_id")),
        action=str(proposal.get("proposed_action")),
        dispute_id=str(proposal.get("dispute_id")),
        manifest_sha256=str(verdict.get("manifest_sha256")),
    )
    verdict["audit_id"] = audit.id
    return verdict
