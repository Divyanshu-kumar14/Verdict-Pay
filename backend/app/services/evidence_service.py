"""Seller-protection evidence: deterministic dossier build, cache and upload.

The dossier is air-gapped from prose generation: facts are locked first, the
narrative may only restate them, and the PDF renderer is a pure function of both.
Replays are idempotent on the PayPal request key so a double click can never
upload the same dossier twice.
"""

from __future__ import annotations

import hashlib
import time
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.config import Settings
from app.db.models import DisputeActionRecord, DisputeCase
from app.domain.disputes.state_machine import ensure_allowed
from app.domain.enums import (
    ActionStatus,
    DisputeAction,
    DisputeChannel,
    DisputeReason,
    DisputeStage,
    DisputeStatus,
)
from app.domain.evidence.narrative import build_template_narrative, validate_narrative
from app.domain.evidence.pdf import DossierInput, render_dossier
from app.domain.protocols import (
    EvidenceDocument,
    EvidenceSubmission,
    NarrativeProvider,
    NarrativeRequest,
    PayPalGateway,
)
from app.errors import ConflictError
from app.logging_setup import get_logger, log_context
from app.services.dispute_service import (
    ACTION_STATUS_IN_PROGRESS,
    as_decimal,
    assemble_case_facts,
    claim_action,
    load_case,
    quantize_money,
)

logger = get_logger("verdictpay.evidence")

NOTES_MAX_CHARS = 2000
DOSSIER_URL_TEMPLATE = "/api/v1/disputes/{dispute_id}/dossier.pdf"
EVIDENCE_KEY_PREFIX = "verdictpay-ev"
EVIDENCE_DOCUMENT_PREFIX = "VerdictPay_Dossier_"

# PayPal evidence_type by dispute reason (plan Phase 3.5).
EVIDENCE_TYPE_BY_REASON: dict[DisputeReason, str] = {
    DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED: "PROOF_OF_FULFILLMENT",
    DisputeReason.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: "OTHER",
    DisputeReason.UNAUTHORIZED: "PROOF_OF_FULFILLMENT",
    DisputeReason.OTHER: "OTHER",
}


def evidence_type_for(reason_code: str) -> str:
    """Map a PayPal reason code onto the evidence type PayPal expects."""
    try:
        reason = DisputeReason(reason_code)
    except ValueError:
        return "OTHER"
    return EVIDENCE_TYPE_BY_REASON.get(reason, "OTHER")


def dossier_filename(dispute_id: str) -> str:
    """Canonical dossier document name sent to PayPal and to the browser."""
    return f"{EVIDENCE_DOCUMENT_PREFIX}{dispute_id}.pdf"


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


class EvidenceService:
    """Merchant-scoped dossier generation and evidence submission."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        settings: Settings,
        gateway: PayPalGateway,
        narrative: NarrativeProvider,
        merchant_id: str | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.gateway = gateway
        self.narrative = narrative
        self.merchant_id = merchant_id or settings.demo_merchant_id

    # ------------------------------------------------------------------ dossier
    async def build_dossier(self, dispute_id: str) -> tuple[bytes, schemas.CaseFacts]:
        """Render, cache and register the PDF dossier for a dispute."""
        case = await self._case(dispute_id)
        pdf_bytes, facts, _narrative = await self._render(case)
        return pdf_bytes, facts

    # ------------------------------------------------------------------ submit
    async def submit(
        self, dispute_id: str, *, idempotency_key: str
    ) -> tuple[DisputeActionRecord, DisputeCase]:
        """Upload the dossier to PayPal, recording exactly one audit row.

        The PayPal request key is claimed atomically before the upload, so a
        concurrent duplicate click can never submit two dossiers.
        """
        case = await self._case(dispute_id)
        self._ensure_legal(case)

        if idempotency_key:
            existing = await self._find_action(idempotency_key)
            if existing is not None:
                return self._replayed(existing, dispute_id), case

        pdf_bytes, _facts, narrative = await self._render(case)
        key = idempotency_key or self._default_key(dispute_id, pdf_bytes)
        evidence_type = evidence_type_for(case.reason_code)
        document_name = dossier_filename(dispute_id)
        record, replay = await claim_action(
            self.session,
            case=case,
            action=DisputeAction.PROVIDE_EVIDENCE,
            idempotency_key=key,
            request_payload={
                "evidence_type": evidence_type,
                "document": document_name,
                "document_bytes": len(pdf_bytes),
                "notes_chars": len(narrative),
            },
        )
        if replay is not None:
            await self.session.refresh(case)
            return self._replayed(replay, dispute_id), case

        submission = EvidenceSubmission(
            dispute_id=dispute_id,
            evidence_type=evidence_type,
            notes=narrative[:NOTES_MAX_CHARS],
            documents=(EvidenceDocument(name=document_name, content=pdf_bytes),),
            idempotency_key=key,
        )
        started = time.perf_counter()
        try:
            response = await self.gateway.provide_evidence(submission)
        except Exception as exc:
            record.status = ActionStatus.FAILED.value
            record.error = f"{type(exc).__name__}: {exc}"
            record.latency_ms = _elapsed_ms(started)
            await self.session.commit()
            logger.error(
                "evidence_upload_failed",
                extra=log_context(dispute_id=dispute_id, error=record.error),
            )
            raise

        record.status = ActionStatus.EXECUTED.value
        record.latency_ms = _elapsed_ms(started)
        record.response_payload = dict(response.body)
        case.status = DisputeStatus.UNDER_REVIEW.value
        case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=dispute_id)
        await self.session.commit()
        return record, case

    # ------------------------------------------------------------------ internals
    def _ensure_legal(self, case: DisputeCase) -> None:
        ensure_allowed(
            DisputeAction.PROVIDE_EVIDENCE,
            stage=DisputeStage(case.lifecycle_stage),
            channel=DisputeChannel(case.dispute_channel),
            links=dict(case.paypal_links or {}),
        )

    async def _case(self, dispute_id: str) -> DisputeCase:
        return await load_case(
            self.session, merchant_id=self.merchant_id, dispute_id=dispute_id
        )

    async def _render(
        self, case: DisputeCase
    ) -> tuple[bytes, schemas.CaseFacts, str]:
        """Assemble facts, constrain the narrative, render and cache the PDF."""
        facts = await assemble_case_facts(
            self.session,
            merchant_id=self.merchant_id,
            settings=self.settings,
            gateway=self.gateway,
            case=case,
        )
        narrative = await self._compose(case, facts)
        amount = quantize_money(as_decimal(case.amount_usd))
        pdf_bytes = render_dossier(
            DossierInput(
                dispute_id=case.dispute_id,
                facts=facts,
                narrative=narrative,
                reason_code=case.reason_code,
                stage=case.lifecycle_stage,
                amount_usd=amount,
                currency=case.currency,
                merchant_name=self.settings.demo_merchant_name,
                generated_at=datetime.now(UTC),
            )
        )
        if self.settings.verdictpay_api_key.encode("utf-8") in pdf_bytes:
            raise RuntimeError("Dossier rendering leaked a configured secret.")
        artifact = Path(self.settings.artifacts_dir) / f"{case.dispute_id}.pdf"
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(pdf_bytes)
        case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=case.dispute_id)
        await self.session.commit()
        return pdf_bytes, facts, narrative

    async def _compose(self, case: DisputeCase, facts: schemas.CaseFacts) -> str:
        """Ask the provider for prose, falling back to the deterministic template."""
        amount = quantize_money(as_decimal(case.amount_usd))
        request = NarrativeRequest(
            reason_code=case.reason_code,
            stage=case.lifecycle_stage,
            amount_usd=amount,
            payer_id=case.paypal_payer_id,
            merchant_name=self.settings.demo_merchant_name,
            facts=facts.model_dump(mode="json"),
            max_chars=NOTES_MAX_CHARS,
        )
        text = await self.narrative.compose(request)
        ok, reason = validate_narrative(text, facts)
        if not ok:
            logger.warning(
                "narrative_rejected",
                extra=log_context(dispute_id=case.dispute_id, reason=reason),
            )
            text = build_template_narrative(
                facts=facts,
                reason_code=case.reason_code,
                stage=case.lifecycle_stage,
                amount_usd=amount,
                merchant_name=self.settings.demo_merchant_name,
            )
        return text[:NOTES_MAX_CHARS]

    def _default_key(self, dispute_id: str, pdf_bytes: bytes) -> str:
        digest = hashlib.sha256(pdf_bytes).hexdigest()[:12]
        return f"{EVIDENCE_KEY_PREFIX}-{dispute_id}-{digest}"

    async def _find_action(self, key: str) -> DisputeActionRecord | None:
        return await self.session.scalar(
            select(DisputeActionRecord).where(DisputeActionRecord.idempotency_key == key)
        )

    def _replayed(self, record: DisputeActionRecord, dispute_id: str) -> DisputeActionRecord:
        if record.dispute_id != dispute_id:
            raise ConflictError("That idempotency key belongs to another dispute.")
        if record.status == ACTION_STATUS_IN_PROGRESS:
            raise ConflictError(
                "This action is already being executed.", code="action_in_progress"
            )
        return record
