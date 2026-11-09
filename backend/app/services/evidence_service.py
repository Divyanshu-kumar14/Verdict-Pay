"""Seller-protection evidence: deterministic dossier build, cache and upload.

The dossier is air-gapped from prose generation: facts are locked first, the
narrative may only restate them, and the PDF renderer is a pure function of both.
Replays are idempotent on the PayPal request key so a double click can never
upload the same dossier twice.
"""

from __future__ import annotations

import hashlib
import json
import time
from collections.abc import Mapping
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

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
    INTERNAL_TEST_SKIP_REASON,
    as_decimal,
    assemble_case_facts,
    claim_action,
    is_internal_test_case,
    load_case,
    quantize_money,
)

logger = get_logger("verdictpay.evidence")

NOTES_MAX_CHARS = 2000
DOSSIER_URL_TEMPLATE = "/api/v1/disputes/{dispute_id}/dossier.pdf"
DOSSIER_MANIFEST_URL_TEMPLATE = "/api/v1/disputes/{dispute_id}/dossier/manifest"
DOSSIER_VERIFY_URL_TEMPLATE = "/api/v1/disputes/{dispute_id}/dossier/verify"
EVIDENCE_KEY_PREFIX = "verdictpay-ev"
EVIDENCE_DOCUMENT_PREFIX = "VerdictPay_Dossier_"

# Frozen dossier record, stored inside DisputeCase.facts_snapshot. Every render
# input lives here, so a re-render is byte-identical even after the case state
# moves on (a later stage must not be able to change an already-signed dossier).
DOSSIER_SNAPSHOT_KEY = "_dossier"
DOSSIER_RECORD_VERSION = 1

# The manifest/verify disclaimer: bytes prove determinism, not legal certainty.
INTEGRITY_DISCLAIMER = (
    "This check proves the dossier is byte-identical to a deterministic re-render "
    "of the frozen case snapshot; it is not a legal attestation or a signature."
)

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


def sha256_hex(payload: bytes) -> str:
    """Full 64-character SHA-256 digest of exactly these bytes."""
    return hashlib.sha256(payload).hexdigest()


def canonical_snapshot_bytes(snapshot: Mapping[str, Any]) -> bytes:
    """Canonical JSON of a facts snapshot: sorted keys, no whitespace.

    Decimal and datetime are already JSON-native by the time a snapshot is
    persisted (``model_dump(mode="json")``), so the encoding is stable across
    processes and Python versions.
    """
    return json.dumps(
        dict(snapshot), sort_keys=True, separators=(",", ":"), ensure_ascii=True
    ).encode("utf-8")


def snapshot_hash(snapshot: Mapping[str, Any]) -> str:
    """SHA-256 of the canonical facts snapshot, over the frozen case facts."""
    return sha256_hex(canonical_snapshot_bytes(snapshot))


@dataclass(frozen=True, slots=True)
class DossierRecord:
    """The frozen render inputs plus the digest of the bytes they produced.

    Every render input is captured here — including the stage, reason code and
    amount the PDF was built from — so re-rendering never depends on mutable case
    state. That is what makes "the bytes differ from the deterministic re-render"
    a meaningful tamper signal instead of a timestamp artefact.
    """

    facts: dict[str, Any]
    narrative: str
    narrative_source: str
    reason_code: str
    stage: str
    amount_usd: str
    currency: str
    merchant_name: str
    sha256: str
    size_bytes: int
    generated_at: datetime

    def as_snapshot(self) -> dict[str, Any]:
        """Serialise for storage inside ``DisputeCase.facts_snapshot``."""
        return {
            "version": DOSSIER_RECORD_VERSION,
            "facts": self.facts,
            "narrative": self.narrative,
            "narrative_source": self.narrative_source,
            "reason_code": self.reason_code,
            "stage": self.stage,
            "amount_usd": self.amount_usd,
            "currency": self.currency,
            "merchant_name": self.merchant_name,
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "generated_at": self.generated_at.isoformat(),
        }

    @classmethod
    def from_snapshot(cls, payload: Mapping[str, Any]) -> DossierRecord | None:
        """Rebuild a record from stored JSON, or None when it is unusable."""
        if not isinstance(payload, Mapping):
            return None
        try:
            generated_at = datetime.fromisoformat(str(payload["generated_at"]))
            amount_usd = str(Decimal(str(payload["amount_usd"])))
        except (KeyError, TypeError, ValueError, ArithmeticError):
            return None
        if generated_at.tzinfo is None:
            generated_at = generated_at.replace(tzinfo=UTC)
        facts = payload.get("facts")
        sha = payload.get("sha256")
        size = payload.get("size_bytes")
        reason_code = payload.get("reason_code")
        stage = payload.get("stage")
        if not isinstance(facts, Mapping) or not isinstance(sha, str):
            return None
        if not isinstance(size, int) or not reason_code or not stage:
            return None
        return cls(
            facts=dict(facts),
            narrative=str(payload.get("narrative", "")),
            narrative_source=str(payload.get("narrative_source", "template")),
            reason_code=str(reason_code),
            stage=str(stage),
            amount_usd=amount_usd,
            currency=str(payload.get("currency", "USD")),
            merchant_name=str(payload.get("merchant_name", "")),
            sha256=sha,
            size_bytes=size,
            generated_at=generated_at,
        )


def dossier_artifact_path(settings: Settings, dispute_id: str) -> Path:
    """Where the served dossier PDF lives on disk."""
    return Path(settings.artifacts_dir) / f"{dispute_id}.pdf"


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
        pdf_bytes, facts, _narrative, _record = await self._render(case)
        return pdf_bytes, facts

    async def build_manifest(self, dispute_id: str) -> schemas.DossierManifest:
        """Publish the dossier's identity: name, full SHA-256, size and snapshot.

        Freezes the dossier on first call (roughly what downloading it does) and
        then always describes the same bytes. ``snapshot_hash`` digests the frozen
        fact pack, so a judge can compare it between runs.
        """
        case = await self._case(dispute_id)
        pdf_bytes, _facts, _narrative, record = await self._render(case)
        frozen = self._frozen_record(case) or record
        return schemas.DossierManifest(
            dispute_id=case.dispute_id,
            run_id=case.run_id,
            filename=dossier_filename(case.dispute_id),
            sha256=sha256_hex(pdf_bytes),
            size_bytes=len(pdf_bytes),
            generated_at=frozen.generated_at,
            chain_head=str(frozen.facts.get("chain_head") or "") or None,
            chain_valid=bool(frozen.facts.get("chain_valid", False)),
            event_count=int(frozen.facts.get("event_count", 0) or 0),
            narrative_source=frozen.narrative_source,
            snapshot_hash=snapshot_hash(frozen.facts),
            download_url=DOSSIER_URL_TEMPLATE.format(dispute_id=case.dispute_id),
        )

    async def verify(self, dispute_id: str) -> schemas.DossierVerification:
        """Re-render from the frozen snapshot and diff against the stored bytes.

        The comparison is bytes-to-bytes: the stored PDF on disk is hashed and
        compared with the digest of a deterministic re-render of the same frozen
        facts. That proves reproducibility and detects an edited file — it is not
        a signature, and this method never claims legal tamper-proofing.
        """
        case = await self._case(dispute_id)
        artifact = dossier_artifact_path(self.settings, case.dispute_id)
        frozen = self._frozen_record(case)
        freshly_frozen = frozen is None
        if frozen is None:
            _pdf, _facts, _narrative, frozen = await self._render(case)

        rerendered = self._render_record(case.dispute_id, frozen)
        rerendered_sha = sha256_hex(rerendered)
        expected = frozen.sha256
        stored = artifact.read_bytes() if artifact.exists() else None
        actual = sha256_hex(stored) if stored is not None else None

        chain_valid = bool(frozen.facts.get("chain_valid", False))
        snapshot_present = bool(frozen.facts) and bool(frozen.facts.get("payer_id"))
        # The frozen record must itself reproduce, and the stored file must match
        # the digest published in the manifest.
        hash_matches = actual is not None and actual == expected and rerendered_sha == expected
        size_matches = stored is not None and len(stored) == frozen.size_bytes
        verified = hash_matches and chain_valid

        checks = {
            "chain_valid": chain_valid,
            "snapshot_present": snapshot_present,
            "hash_matches": hash_matches,
            "size_matches": size_matches,
        }
        return schemas.DossierVerification(
            dispute_id=case.dispute_id,
            verified=verified,
            expected_sha256=expected or None,
            actual_sha256=actual,
            verified_at=datetime.now(UTC),
            detail=self._verification_detail(
                checks=checks,
                expected=expected,
                actual=actual,
                rerendered_sha=rerendered_sha,
                freshly_frozen=freshly_frozen,
                event_count=int(frozen.facts.get("event_count", 0) or 0),
            ),
            checks=checks,
        )

    @staticmethod
    def _verification_detail(
        *,
        checks: Mapping[str, bool],
        expected: str,
        actual: str | None,
        rerendered_sha: str,
        freshly_frozen: bool,
        event_count: int,
    ) -> str:
        """State plainly what passed and, on mismatch, what differed."""
        if checks["hash_matches"] and checks["chain_valid"] and checks["size_matches"]:
            frozen_note = (
                " The dossier was frozen by this check because none existed yet."
                if freshly_frozen
                else ""
            )
            return (
                "Verified: the stored dossier is byte-identical to a deterministic "
                f"re-render of the frozen case snapshot (sha256 {expected}, "
                f"{event_count} chained events, chain valid).{frozen_note} "
                f"{INTEGRITY_DISCLAIMER}"
            )

        parts: list[str] = []
        if actual is None:
            parts.append("No stored dossier bytes were found, so there is nothing to compare.")
        elif not checks["hash_matches"]:
            parts.append(
                "Tampering detected: the stored dossier bytes differ from the "
                f"deterministic re-render of the frozen snapshot (stored sha256 "
                f"{actual}, re-render sha256 {rerendered_sha}, expected {expected})."
            )
        if not checks["size_matches"]:
            parts.append("The stored file's size does not match the size recorded in the manifest.")
        if not checks["chain_valid"]:
            parts.append(
                "The telemetry chain for this customer does not verify, so the "
                "underlying facts are not independently reproducible."
            )
        if not checks["snapshot_present"]:
            parts.append("The frozen fact snapshot is missing or incomplete.")
        parts.append(INTEGRITY_DISCLAIMER)
        return " ".join(parts)

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

        pdf_bytes, _facts, narrative, record = await self._render(case)
        key = idempotency_key or self._default_key(dispute_id, pdf_bytes)
        evidence_type = evidence_type_for(case.reason_code)
        document_name = dossier_filename(dispute_id)
        record_row, replay = await claim_action(
            self.session,
            case=case,
            action=DisputeAction.PROVIDE_EVIDENCE,
            idempotency_key=key,
            request_payload={
                "evidence_type": evidence_type,
                "document": document_name,
                "document_bytes": len(pdf_bytes),
                "document_sha256": record.sha256,
                "notes_chars": len(narrative),
            },
        )
        if replay is not None:
            await self.session.refresh(case)
            return self._replayed(replay, dispute_id), case

        if is_internal_test_case(case):
            # The dossier is real and downloadable, but PayPal has no such
            # dispute to attach it to, so the upload is recorded as skipped.
            record_row.status = ActionStatus.SKIPPED.value
            record_row.error = INTERNAL_TEST_SKIP_REASON
            record_row.latency_ms = 0
            record_row.response_payload = {"skipped": True, "reason": INTERNAL_TEST_SKIP_REASON}
            case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=dispute_id)
            await self.session.commit()
            return record_row, case
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
            record_row.status = ActionStatus.FAILED.value
            record_row.error = f"{type(exc).__name__}: {exc}"
            record_row.latency_ms = _elapsed_ms(started)
            await self.session.commit()
            logger.error(
                "evidence_upload_failed",
                extra=log_context(dispute_id=dispute_id, error=record_row.error),
            )
            raise

        record_row.status = ActionStatus.EXECUTED.value
        record_row.latency_ms = _elapsed_ms(started)
        record_row.response_payload = dict(response.body)
        case.status = DisputeStatus.UNDER_REVIEW.value
        case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=dispute_id)
        await self.session.commit()
        return record_row, case

    # ------------------------------------------------------------------ internals
    def _ensure_legal(self, case: DisputeCase) -> None:
        ensure_allowed(
            DisputeAction.PROVIDE_EVIDENCE,
            stage=DisputeStage(case.lifecycle_stage),
            channel=DisputeChannel(case.dispute_channel),
            links=dict(case.paypal_links or {}),
        )

    async def _case(self, dispute_id: str) -> DisputeCase:
        return await load_case(self.session, merchant_id=self.merchant_id, dispute_id=dispute_id)

    async def _render(
        self, case: DisputeCase
    ) -> tuple[bytes, schemas.CaseFacts, str, DossierRecord]:
        """Return the dossier bytes, never re-rendering an already-frozen dossier.

        First call: assemble facts, constrain the narrative, render, freeze the
        inputs in the snapshot and cache the PDF. Later calls: replay the frozen
        inputs, so the bytes stay identical and every digest stays meaningful.
        """
        frozen = self._frozen_record(case)
        if frozen is not None:
            pdf_bytes = self._render_record(case.dispute_id, frozen)
            facts = schemas.CaseFacts.model_validate(frozen.facts)
            self._write_artifact(case.dispute_id, pdf_bytes)
            case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=case.dispute_id)
            await self.session.commit()
            return pdf_bytes, facts, frozen.narrative, frozen

        facts = await assemble_case_facts(
            self.session,
            merchant_id=self.merchant_id,
            settings=self.settings,
            gateway=self.gateway,
            case=case,
        )
        narrative, narrative_source = await self._compose(case, facts)
        record = DossierRecord(
            facts=facts.model_dump(mode="json"),
            narrative=narrative,
            narrative_source=narrative_source,
            reason_code=case.reason_code,
            stage=case.lifecycle_stage,
            amount_usd=str(quantize_money(as_decimal(case.amount_usd))),
            currency=case.currency,
            merchant_name=self.settings.demo_merchant_name,
            sha256="",  # filled in below, after the first render
            size_bytes=0,
            generated_at=datetime.now(UTC),
        )
        pdf_bytes = self._render_record(case.dispute_id, record)
        record = replace(
            record,
            sha256=sha256_hex(pdf_bytes),
            size_bytes=len(pdf_bytes),
        )
        self._write_artifact(case.dispute_id, pdf_bytes)
        self._freeze_record(case, record)
        case.dossier_pdf_url = DOSSIER_URL_TEMPLATE.format(dispute_id=case.dispute_id)
        await self.session.commit()
        return pdf_bytes, facts, narrative, record

    def _render_record(self, dispute_id: str, record: DossierRecord) -> bytes:
        """Render the PDF from frozen inputs only — the determinism contract."""
        pdf_bytes = render_dossier(
            DossierInput(
                dispute_id=dispute_id,
                facts=schemas.CaseFacts.model_validate(record.facts),
                narrative=record.narrative,
                narrative_source=record.narrative_source,
                reason_code=record.reason_code,
                stage=record.stage,
                amount_usd=Decimal(record.amount_usd),
                currency=record.currency,
                merchant_name=record.merchant_name,
                generated_at=record.generated_at,
            )
        )
        if self.settings.verdictpay_api_key.encode("utf-8") in pdf_bytes:
            raise RuntimeError("Dossier rendering leaked a configured secret.")
        return pdf_bytes

    def _write_artifact(self, dispute_id: str, pdf_bytes: bytes) -> None:
        artifact = dossier_artifact_path(self.settings, dispute_id)
        artifact.parent.mkdir(parents=True, exist_ok=True)
        artifact.write_bytes(pdf_bytes)

    def _frozen_record(self, case: DisputeCase) -> DossierRecord | None:
        """The stored dossier record, or None when this case was never rendered."""
        payload = (case.facts_snapshot or {}).get(DOSSIER_SNAPSHOT_KEY)
        if not isinstance(payload, Mapping):
            return None
        return DossierRecord.from_snapshot(payload)

    def _freeze_record(self, case: DisputeCase, record: DossierRecord) -> None:
        case.facts_snapshot = {
            **(case.facts_snapshot or {}),
            DOSSIER_SNAPSHOT_KEY: record.as_snapshot(),
        }

    async def _compose(self, case: DisputeCase, facts: schemas.CaseFacts) -> tuple[str, str]:
        """Return prose plus an honest source label ("template" or "ai:<model>")."""
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
        template_text = build_template_narrative(
            facts=facts,
            reason_code=case.reason_code,
            stage=case.lifecycle_stage,
            amount_usd=amount,
            merchant_name=self.settings.demo_merchant_name,
        )
        try:
            text = await self.narrative.compose(request)
        except Exception as exc:
            # The dossier endpoint is judge-facing: a broken/absent model must
            # degrade to the deterministic template, never to a 500.
            logger.warning(
                "narrative_provider_failed",
                extra=log_context(dispute_id=case.dispute_id, error=type(exc).__name__),
            )
            text = template_text
        ok, reason = validate_narrative(text, facts)
        if not ok:
            logger.warning(
                "narrative_rejected",
                extra=log_context(dispute_id=case.dispute_id, reason=reason),
            )
            text = template_text

        source = "template"
        provider_mode = getattr(self.narrative, "mode", "template")
        if provider_mode != "template" and text.strip() != template_text.strip():
            model = getattr(self.narrative, "model_name", "model")
            source = f"ai:{model}"
        return text[:NOTES_MAX_CHARS], source

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
            raise ConflictError("This action is already being executed.", code="action_in_progress")
        return record
