"""Dispute orchestration: webhook intake, deterministic triage, PayPal actions.

Every method is async and scoped to one merchant. The service owns no mutable
state: containment proof is persisted on the case row and the webhook record is
returned to the caller, so nothing has to be read back off the instance.

Money is Decimal throughout; probabilities are float; nothing here calls
random() or reads the wall clock inside a pure calculation.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping, Sequence
from dataclasses import asdict
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.config import Settings
from app.db.models import (
    DisputeActionRecord,
    DisputeCase,
    PaypalTransaction,
    TelemetryLedger,
    WebhookEventRecord,
)
from app.domain.disputes.decision import compare, policy_reason_from
from app.domain.disputes.ev import EvInputs, compute_ev, ratio_relation, to_breakdown
from app.domain.disputes.state_machine import ensure_allowed, to_allowed_actions
from app.domain.disputes.triage import TriageDecision, TriageInput, decide
from app.domain.disputes.win_probability import SignalSet, completeness, score_win_probability
from app.domain.enums import (
    ActionStatus,
    DisputeAction,
    DisputeChannel,
    DisputeReason,
    DisputeStage,
    DisputeStatus,
    RecommendedAction,
    WebhookEventType,
)
from app.domain.evidence.facts import CaseInput, TelemetryEventView, assemble_facts
from app.domain.protocols import (
    GatewayResponse,
    NarrativeProvider,
    PayPalDisputeRecord,
    PayPalGateway,
    PayPalTransactionRecord,
    SearchIndex,
    WebhookEvent,
)
from app.domain.subscriptions.containment import ContainmentResult, contain_subscription
from app.domain.telemetry.service import TelemetryService
from app.errors import ConflictError, NotFoundError, ValidationFailedError, WebhookVerificationError
from app.logging_setup import get_logger, log_context
from app.security import compute_signature

logger = get_logger("verdictpay.disputes")

CENT = Decimal("0.01")
# Transient claim status stored in dispute_actions.status. It is deliberately not
# part of the frozen ActionStatus API enum: the column is a plain string and an
# in-flight claim must never be presented as a finished result.
ACTION_STATUS_IN_PROGRESS = "IN_PROGRESS"
TRIAGE_SNAPSHOT_KEY = "_triage"
CONTAINMENT_SNAPSHOT_KEY = "_containment"
CE3_WINDOW_START_DAYS = 365
CE3_WINDOW_END_DAYS = 120
VOLUME_WINDOW_DAYS = 90
MESSAGE_MAX_CHARS = 2000
OPEN_STAGES = frozenset(
    {DisputeStage.INQUIRY, DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION}
)
CLAIM_STAGES = frozenset({DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION})
PROTECTED_ACTIONS = frozenset(
    {RecommendedAction.DEFLECT_INQUIRY, RecommendedAction.PROVIDE_EVIDENCE}
)


def quantize_money(value: Decimal | int | float | str) -> Decimal:
    """Round any money-ish value to cents, half-up (deterministic)."""
    raw = value if isinstance(value, Decimal) else Decimal(str(value))
    return raw.quantize(CENT, rounding=ROUND_HALF_UP)


def as_decimal(value: Decimal | int | float | str | None) -> Decimal:
    if value is None:
        return Decimal("0.00")
    return value if isinstance(value, Decimal) else Decimal(str(value))


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def _reason_code(value: str) -> DisputeReason:
    try:
        return DisputeReason(value)
    except ValueError:
        return DisputeReason.OTHER


def utc_aware(value: datetime | None) -> datetime | None:
    """Return a UTC-aware datetime.

    SQLite drops tzinfo on round-trip; without this the browser parses the
    serialised value as local time and shows the wrong deadline.
    """
    if value is None:
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


def _format_ts(value: datetime | None) -> str:
    if value is None:
        return "unknown"
    aware = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return aware.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _mean(values: Sequence[float]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 4)


# --------------------------------------------------------------------------- mappers
def to_dispute_summary(case: DisputeCase) -> schemas.DisputeSummary:
    """Project a case row onto the frozen list/detail summary contract."""
    return schemas.DisputeSummary(
        dispute_id=case.dispute_id,
        run_id=getattr(case, "run_id", None),
        payer_id=case.paypal_payer_id,
        order_id=case.paypal_order_id,
        subscription_id=case.paypal_subscription_id,
        reason_code=_reason_code(case.reason_code),
        stage=DisputeStage(case.lifecycle_stage),
        channel=DisputeChannel(case.dispute_channel),
        status=DisputeStatus(case.status),
        currency=case.currency,
        amount_usd=quantize_money(as_decimal(case.amount_usd)),
        p_win=float(case.p_win),
        ev_fight_usd=quantize_money(as_decimal(case.ev_fight_usd)),
        ev_settle_usd=quantize_money(as_decimal(case.ev_settle_usd)),
        ev_offer_usd=quantize_money(as_decimal(case.ev_offer_usd)),
        telemetry_completeness=float(case.telemetry_completeness),
        recommended_action=RecommendedAction(case.recommended_action),
        subscription_suspended=bool(case.subscription_suspended),
        dossier_available=bool(case.dossier_pdf_url),
        seller_response_due_date=utc_aware(case.seller_response_due_date),
        created_at=utc_aware(case.created_at),
        updated_at=utc_aware(case.updated_at),
    )


def to_transaction_out(transaction: PaypalTransaction) -> schemas.TransactionOut:
    """Project a cached transaction row onto the frozen reporting contract."""
    return schemas.TransactionOut(
        transaction_id=transaction.transaction_id,
        payer_id=transaction.payer_id,
        order_id=transaction.order_id,
        amount_usd=quantize_money(as_decimal(transaction.amount_usd)),
        currency=transaction.currency,
        status=transaction.status,
        client_ip=transaction.client_ip,
        device_fingerprint=transaction.device_fingerprint,
        source=transaction.source,
        created_at=utc_aware(transaction.created_at),
    )


async def claim_action(
    session: AsyncSession,
    *,
    case: DisputeCase,
    action: DisputeAction,
    idempotency_key: str | None,
    request_payload: Mapping[str, Any],
) -> tuple[DisputeActionRecord, DisputeActionRecord | None]:
    """Atomically claim one idempotency key before any PayPal call.

    The unique constraint on dispute_actions.idempotency_key is the lock: the
    winner inserts an IN_PROGRESS row and only then dispatches. Returns
    (claim_row, replay_row); a non-None replay_row means another request already
    owns the key and its terminal audit row must be returned instead of calling
    PayPal again. Raises ConflictError while the owner is still in flight.
    """
    # Read the id before any rollback: a rollback expires the case instance and
    # touching an expired attribute outside the greenlet would raise.
    dispute_id = case.dispute_id
    record = DisputeActionRecord(
        dispute_id=dispute_id,
        action=action.value,
        status=ACTION_STATUS_IN_PROGRESS,
        idempotency_key=idempotency_key,
        request_payload=dict(request_payload),
    )
    session.add(record)
    try:
        await session.commit()
        return record, None
    except IntegrityError:
        await session.rollback()
        if idempotency_key is None:
            raise
        existing = await session.scalar(
            select(DisputeActionRecord).where(
                DisputeActionRecord.idempotency_key == idempotency_key
            )
        )
        if existing is None:
            raise
        if existing.dispute_id != dispute_id:
            raise ConflictError(
                "That idempotency key belongs to another dispute."
            ) from None
        if existing.status == ACTION_STATUS_IN_PROGRESS:
            raise ConflictError(
                "This action is already being executed.", code="action_in_progress"
            ) from None
        return record, existing


def containment_snapshot(case: DisputeCase) -> dict[str, Any]:
    """Return the persisted containment proof for a case (empty when unattempted)."""
    snapshot = (case.facts_snapshot or {}).get(CONTAINMENT_SNAPSHOT_KEY)
    return dict(snapshot) if isinstance(snapshot, Mapping) else {}


def to_action_record(record: DisputeActionRecord) -> schemas.ActionRecord:
    """Project one audit row onto the frozen action record contract."""
    try:
        status = ActionStatus(record.status)
    except ValueError:
        # A transient IN_PROGRESS claim is not part of the frozen enum.
        status = ActionStatus.SKIPPED
    return schemas.ActionRecord(
        action_id=record.id,
        action=DisputeAction(record.action),
        status=status,
        latency_ms=record.latency_ms,
        created_at=utc_aware(record.created_at),
        error=record.error,
    )


def build_deflection_message(case: DisputeCase, facts: schemas.CaseFacts) -> str:
    """Deterministic buyer-facing message built only from locked facts."""
    delivery_line = "No digital delivery event was recorded."
    if facts.deliveries:
        newest = facts.deliveries[0]
        sha = str(newest.get("sha256", ""))
        delivery_line = (
            f"The file {newest.get('resource_id')} "
            f"(SHA-256 {sha[:16]}...) was delivered on {newest.get('delivered_at')}."
        )
    primary_ip = facts.ips[0] if facts.ips else "not recorded"
    primary_device = facts.devices[0] if facts.devices else "not recorded"
    ledger_state = "intact" if facts.chain_valid else "failed"
    lines = [
        f"Hello, this message responds to dispute {case.dispute_id} "
        f"for order {case.paypal_order_id}.",
        f"Our system of record shows the following activity for payer {facts.payer_id}:",
        f"- Terms of service {facts.tos_version or 'version not recorded'} accepted on "
        f"{_format_ts(facts.tos_accepted_at)}.",
        f"- {facts.event_count} hash-chained lifecycle events between "
        f"{_format_ts(facts.first_seen)} and {_format_ts(facts.last_seen)}.",
        f"- Account access from IP {primary_ip} on device {primary_device}.",
        f"- {delivery_line}",
        f"- {facts.usage_units} metered units consumed across {facts.usage_events} usage events.",
        f"Ledger verification: {ledger_state}; chain head {facts.chain_head[:16]}...",
        "We are happy to review any concern; respond to this message and we will resolve it "
        "directly.",
    ]
    return "\n".join(lines)[:MESSAGE_MAX_CHARS]


# --------------------------------------------------------------------------- shared helpers
async def load_case(session: AsyncSession, *, merchant_id: str, dispute_id: str) -> DisputeCase:
    """Load a case inside the merchant boundary or raise NotFoundError."""
    case = await session.scalar(
        select(DisputeCase).where(
            DisputeCase.dispute_id == dispute_id,
            DisputeCase.merchant_id == merchant_id,
        )
    )
    if case is None:
        raise NotFoundError(f"Dispute {dispute_id} was not found.")
    return case


def event_view(event: TelemetryLedger) -> TelemetryEventView:
    """Project a ledger row onto the immutable fact-pack view."""
    return TelemetryEventView(
        event_type=event.event_type,
        sequence=event.sequence,
        client_ip=event.client_ip,
        device_fingerprint=event.device_fingerprint,
        resource_id=event.resource_id,
        resource_hash=event.resource_hash,
        units_consumed=event.units_consumed,
        chain_hash=event.chain_hash,
        created_at=event.created_at,
        payload=dict(event.payload or {}),
    )


async def cache_transactions(
    session: AsyncSession,
    *,
    merchant_id: str,
    paypal_mode: str,
    records: Sequence[PayPalTransactionRecord],
) -> None:
    """Upsert gateway transactions once, in a single round-trip, for reporting."""
    if not records:
        return
    transaction_ids = [record.transaction_id for record in records]
    known = set(
        (
            await session.scalars(
                select(PaypalTransaction.transaction_id).where(
                    PaypalTransaction.transaction_id.in_(transaction_ids)
                )
            )
        ).all()
    )
    for record in records:
        if record.transaction_id in known:
            continue
        session.add(
            PaypalTransaction(
                merchant_id=merchant_id,
                transaction_id=record.transaction_id,
                payer_id=record.payer_id,
                order_id=None,
                amount_usd=quantize_money(record.amount),
                currency=record.currency,
                status=record.status,
                client_ip=record.client_ip,
                device_fingerprint=record.device_fingerprint,
                source=paypal_mode,
                created_at=record.created_at,
            )
        )
    await session.flush()


async def assemble_case_facts(
    session: AsyncSession,
    *,
    merchant_id: str,
    settings: Settings,
    gateway: PayPalGateway,
    case: DisputeCase,
    now: datetime | None = None,
) -> schemas.CaseFacts:
    """Build the immutable fact pack for a case (same assembly for triage + dossier)."""
    reference = now or datetime.now(UTC)
    events = list(
        (
            await session.scalars(
                select(TelemetryLedger)
                .where(
                    TelemetryLedger.merchant_id == merchant_id,
                    TelemetryLedger.payer_id == case.paypal_payer_id,
                )
                .order_by(TelemetryLedger.sequence)
            )
        ).all()
    )
    transactions = await gateway.search_transactions(
        payer_id=case.paypal_payer_id,
        start=reference - timedelta(days=CE3_WINDOW_START_DAYS),
        end=reference - timedelta(days=CE3_WINDOW_END_DAYS),
    )
    await cache_transactions(
        session,
        merchant_id=merchant_id,
        # ``provenance`` is the stable machine label ("local_simulator",
        # "paypal_sandbox", "paypal_live"), not the mutable config spelling.
        paypal_mode=settings.provenance,
        records=transactions,
    )
    verification = await TelemetryService(session, merchant_id=merchant_id).verify(
        case.paypal_payer_id
    )
    return assemble_facts(
        CaseInput(
            payer_id=case.paypal_payer_id,
            amount_usd=quantize_money(as_decimal(case.amount_usd)),
            currency=case.currency,
            reason_code=case.reason_code,
            stage=case.lifecycle_stage,
            merchant_name=settings.demo_merchant_name,
            events=[event_view(event) for event in events],
            transactions=transactions,
            chain_valid=verification.valid,
            now=reference,
            response_due_date=case.seller_response_due_date,
        )
    )


class DisputeService:
    """Merchant-scoped orchestration from webhook to executed PayPal action."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        settings: Settings,
        gateway: PayPalGateway,
        narrative: NarrativeProvider,
        search: SearchIndex,
        merchant_id: str | None = None,
    ) -> None:
        self.session = session
        self.settings = settings
        self.gateway = gateway
        self.narrative = narrative
        self.search = search
        self.merchant_id = merchant_id or settings.demo_merchant_id

    # ------------------------------------------------------------------ intake
    async def ingest_webhook(
        self, *, headers: Mapping[str, str], raw_body: bytes
    ) -> tuple[WebhookEventRecord, DisputeCase | None]:
        """Verify, de-duplicate and process one PayPal webhook event."""
        verification = await self.gateway.verify_webhook(headers, raw_body)
        if not verification.verified or verification.event is None:
            logger.warning("webhook_rejected", extra=log_context(reason=verification.reason))
            raise WebhookVerificationError(verification.reason or None)
        event = verification.event

        existing = await self._find_event(event.event_id)
        if existing is not None:
            return await self._replay(existing)

        record = WebhookEventRecord(
            event_id=event.event_id,
            event_type=event.event_type,
            verified=True,
            processed=False,
            payload=self._webhook_payload(event),
        )
        self.session.add(record)
        try:
            await self.session.flush()
        except IntegrityError:
            # A concurrent delivery won the unique event_id race: this is a replay.
            await self.session.rollback()
            existing = await self._find_event(event.event_id)
            if existing is None:
                raise
            return await self._replay(existing)

        case = await self._apply_event(record, event)
        return record, case

    async def open_simulated_dispute(
        self,
        *,
        payer_id: str,
        order_id: str,
        reason_code: str,
        stage: DisputeStage,
        channel: DisputeChannel,
        amount: Decimal,
        buyer_claim_text: str | None = None,
    ) -> DisputeCase:
        """Open a simulator dispute, then drive it through the real webhook path."""
        _record, case = await self.open_simulated_dispute_with_event(
            payer_id=payer_id,
            order_id=order_id,
            reason_code=reason_code,
            stage=stage,
            channel=channel,
            amount=amount,
            buyer_claim_text=buyer_claim_text,
        )
        return case

    async def open_simulated_dispute_with_event(
        self,
        *,
        payer_id: str,
        order_id: str,
        reason_code: str,
        stage: DisputeStage,
        channel: DisputeChannel,
        amount: Decimal,
        buyer_claim_text: str | None = None,
    ) -> tuple[WebhookEventRecord, DisputeCase]:
        """Same simulated flow as open_simulated_dispute, plus the webhook record."""
        dispute = await self.gateway.create_sandbox_dispute(
            payer_id=payer_id,
            order_id=order_id,
            reason_code=reason_code,
            amount=quantize_money(amount),
            currency="USD",
            stage=stage,
            channel=channel,
        )
        raw_body, headers = self._signed_webhook(dispute)
        record, case = await self.ingest_webhook(headers=headers, raw_body=raw_body)
        if case is None:
            raise ValidationFailedError("Sandbox dispute did not produce a case.")
        claim = (buyer_claim_text or "").strip()[:4000]
        if claim:
            # Persisted alongside the deterministic snapshot (top level, like
            # _containment); _apply_triage preserves it and _facts_from_snapshot
            # restores it onto CaseFacts.buyer_claim_text.
            case.facts_snapshot = {**(case.facts_snapshot or {}), "buyer_claim_text": claim}
            await self.session.commit()
        return record, case

    # ------------------------------------------------------------------ reads
    async def get_case(self, dispute_id: str) -> DisputeCase:
        """Return the stored case inside the merchant boundary."""
        return await load_case(self.session, merchant_id=self.merchant_id, dispute_id=dispute_id)

    async def refresh_case(self, dispute_id: str) -> DisputeCase:
        """Re-sync stage/status/links from PayPal, then return the stored case."""
        case = await self.get_case(dispute_id)
        await self._refresh_from_gateway(case)
        await self.session.commit()
        return case

    async def list_cases(
        self,
        *,
        page: int,
        per_page: int,
        stage: DisputeStage | None = None,
        status: DisputeStatus | None = None,
        recommended_action: RecommendedAction | None = None,
    ) -> tuple[list[DisputeCase], int]:
        """Paginated triage queue, newest first."""
        filters = [DisputeCase.merchant_id == self.merchant_id]
        if stage is not None:
            filters.append(DisputeCase.lifecycle_stage == stage.value)
        if status is not None:
            filters.append(DisputeCase.status == status.value)
        if recommended_action is not None:
            filters.append(DisputeCase.recommended_action == recommended_action.value)

        total = int(
            (
                await self.session.scalar(
                    select(func.count()).select_from(DisputeCase).where(*filters)
                )
            )
            or 0
        )
        rows = (
            await self.session.scalars(
                select(DisputeCase)
                .where(*filters)
                .order_by(DisputeCase.created_at.desc(), DisputeCase.dispute_id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).all()
        return list(rows), total

    async def list_transactions(
        self, *, payer_id: str | None = None, limit: int = 50
    ) -> list[PaypalTransaction]:
        """Cached transactions for CE 3.0 lookbacks, newest first."""
        filters = [PaypalTransaction.merchant_id == self.merchant_id]
        if payer_id is not None:
            filters.append(PaypalTransaction.payer_id == payer_id)
        rows = (
            await self.session.scalars(
                select(PaypalTransaction)
                .where(*filters)
                .order_by(PaypalTransaction.created_at.desc(), PaypalTransaction.transaction_id)
                .limit(limit)
            )
        ).all()
        return list(rows)

    # ------------------------------------------------------------------ triage
    async def triage_case(self, dispute_id: str) -> TriageDecision:
        """Recompute and persist win probability, EV and the recommended action."""
        case = await self.get_case(dispute_id)
        await self._refresh_from_gateway(case)
        decision = await self._apply_triage(case)
        await self.session.commit()
        return decision

    async def build_detail(self, dispute_id: str) -> schemas.DisputeDetail:
        """Full case-room payload, served from the persisted triage snapshot."""
        case = await self.get_case(dispute_id)
        snapshot = dict(case.facts_snapshot or {})
        persisted = snapshot.get(TRIAGE_SNAPSHOT_KEY)
        if not persisted:
            await self._apply_triage(case)
            await self.session.commit()
            snapshot = dict(case.facts_snapshot or {})
            persisted = snapshot.get(TRIAGE_SNAPSHOT_KEY, {})

        facts = self._facts_from_snapshot(snapshot, case)
        breakdown = schemas.EvBreakdown.model_validate(persisted["breakdown"])
        win_probability = schemas.WinProbability.model_validate(persisted["win_probability"])
        stage = DisputeStage(case.lifecycle_stage)
        channel = DisputeChannel(case.dispute_channel)
        links = dict(case.paypal_links or {})
        action_rows = (
            await self.session.scalars(
                select(DisputeActionRecord)
                .where(DisputeActionRecord.dispute_id == case.dispute_id)
                .order_by(DisputeActionRecord.created_at.desc(), DisputeActionRecord.id)
            )
        ).all()
        allowed_actions = to_allowed_actions(stage=stage, channel=channel, links=links)
        return schemas.DisputeDetail(
            **to_dispute_summary(case).model_dump(),
            breakdown=breakdown,
            win_probability=win_probability,
            allowed_actions=allowed_actions,
            rationale=[
                schemas.RationaleItem.model_validate(item) for item in (case.action_rationale or [])
            ],
            facts=facts,
            actions=[to_action_record(row) for row in action_rows],
            # Policy recommendation and cheapest modelled loss are two different
            # questions. Answering both here — from the same persisted breakdown —
            # is what stops a reader from believing "recommended" means "cheapest".
            decision_comparison=compare(
                breakdown=breakdown,
                policy_action=RecommendedAction(case.recommended_action),
                allowed_actions=allowed_actions,
                policy_reason=policy_reason_from(case.action_rationale or []),
            ),
        )

    # ------------------------------------------------------------------ actions
    async def execute_action(
        self,
        dispute_id: str,
        action: DisputeAction,
        request: schemas.ActionRequest,
    ) -> tuple[DisputeActionRecord, DisputeCase]:
        """Execute one HATEOAS-guarded action and always persist an audit row.

        The idempotency key is claimed atomically (INSERT of an IN_PROGRESS row)
        before the PayPal call, so a concurrent duplicate can never dispatch a
        second buyer-facing message.
        """
        case = await self.get_case(dispute_id)

        if request.idempotency_key:
            existing = await self._find_action_by_key(request.idempotency_key)
            if existing is not None:
                return self._replay_action(existing, case)

        if action is DisputeAction.PROVIDE_EVIDENCE:
            from app.services.evidence_service import EvidenceService

            evidence = EvidenceService(
                self.session,
                settings=self.settings,
                gateway=self.gateway,
                narrative=self.narrative,
                merchant_id=self.merchant_id,
            )
            return await evidence.submit(
                dispute_id, idempotency_key=request.idempotency_key or ""
            )

        stage = DisputeStage(case.lifecycle_stage)
        channel = DisputeChannel(case.dispute_channel)
        links = dict(case.paypal_links or {})
        ensure_allowed(action, stage=stage, channel=channel, links=links)

        record, replay = await claim_action(
            self.session,
            case=case,
            action=action,
            idempotency_key=request.idempotency_key,
            request_payload={
                "action": action.value,
                "note": request.note,
                "offer_ratio": None if request.offer_ratio is None else str(request.offer_ratio),
                "idempotency_key": request.idempotency_key,
            },
        )
        if replay is not None:
            await self.session.refresh(case)
            return self._replay_action(replay, case)

        started = time.perf_counter()
        try:
            upstream = await self._dispatch(action, case, request)
        except Exception as exc:
            record.status = ActionStatus.FAILED.value
            record.error = f"{type(exc).__name__}: {exc}"
            record.latency_ms = _elapsed_ms(started)
            await self.session.commit()
            logger.error(
                "action_failed",
                extra=log_context(
                    dispute_id=dispute_id, action=action.value, error=record.error
                ),
            )
            raise

        record.status = ActionStatus.EXECUTED.value
        record.latency_ms = _elapsed_ms(started)
        record.response_payload = dict(upstream.body)
        await self._refresh_from_gateway(case)
        if action is DisputeAction.ACCEPT_CLAIM:
            case.status = DisputeStatus.RESOLVED.value
            case.lifecycle_stage = DisputeStage.CLOSED.value
        await self.session.commit()
        return record, case

    def _replay_action(
        self, existing: DisputeActionRecord, case: DisputeCase
    ) -> tuple[DisputeActionRecord, DisputeCase]:
        """Return a finished audit row as the idempotent answer to a retry."""
        if existing.dispute_id != case.dispute_id:
            raise ConflictError("That idempotency key belongs to another dispute.")
        if existing.status == ACTION_STATUS_IN_PROGRESS:
            raise ConflictError(
                "This action is already being executed.", code="action_in_progress"
            )
        return existing, case

    # ------------------------------------------------------------------ reporting
    async def reporting_summary(self) -> schemas.ReportingSummary:
        """Exact aggregates over the merchant's case book."""
        cases = list(
            (
                await self.session.scalars(
                    select(DisputeCase).where(DisputeCase.merchant_id == self.merchant_id)
                )
            ).all()
        )
        stages = {case.dispute_id: DisputeStage(case.lifecycle_stage) for case in cases}
        open_cases = [case for case in cases if stages[case.dispute_id] in OPEN_STAGES]
        in_inquiry = [case for case in cases if stages[case.dispute_id] is DisputeStage.INQUIRY]
        in_claim = [case for case in cases if stages[case.dispute_id] in CLAIM_STAGES]

        total_exposure = sum((as_decimal(case.amount_usd) for case in open_cases), Decimal("0.00"))
        protected = sum(
            (
                as_decimal(case.amount_usd)
                for case in cases
                if RecommendedAction(case.recommended_action) in PROTECTED_ACTIONS
            ),
            Decimal("0.00"),
        )
        fees_avoided = self.settings.standard_fee_usd * len(in_inquiry)
        p_wins = [float(case.p_win) for case in cases]
        confident = [
            float(case.p_win) for case in cases if float(case.telemetry_completeness) >= 0.6
        ]
        sales_3mo, disputes_3mo = await self._volume_counts()
        ratio = disputes_3mo / max(sales_3mo, 1)
        # Same helper the case detail uses, so the dashboard and the case room can
        # never disagree about which side of the 1.5% line a merchant is on.
        high_volume = (
            sales_3mo >= self.settings.high_volume_min_sales
            and ratio_relation(ratio, self.settings.ratio_threshold) == "at_or_above"
        )
        payers = sorted({case.paypal_payer_id for case in cases})
        chain_verified = 0
        if payers:
            telemetry = TelemetryService(self.session, self.merchant_id)
            for payer in payers:
                verification = await telemetry.verify(payer)
                if verification.valid:
                    chain_verified += 1

        return schemas.ReportingSummary(
            total_cases=len(cases),
            open_cases=len(open_cases),
            in_inquiry=len(in_inquiry),
            in_claim=len(in_claim),
            total_exposure_usd=quantize_money(total_exposure),
            protected_usd=quantize_money(protected),
            fees_avoided_usd=quantize_money(fees_avoided),
            avg_p_win=_mean(p_wins),
            win_rate_estimate=_mean(confident),
            subscription_suspensions=sum(
                1 for case in cases if bool(case.subscription_suspended)
            ),
            chain_verified_customers=chain_verified,
            high_volume=schemas.HighVolumeStatus(
                flag=high_volume,
                ratio=ratio,
                threshold=float(self.settings.ratio_threshold),
                sales_3mo=sales_3mo,
                disputes_3mo=disputes_3mo,
            ),
            generated_at=datetime.now(UTC),
        )

    # ------------------------------------------------------------------ internals
    async def _apply_event(
        self, record: WebhookEventRecord, event: WebhookEvent
    ) -> DisputeCase | None:
        dispute = event.dispute
        if dispute is None:
            record.processed = True
            await self.session.commit()
            return None
        case = await self._upsert_case(dispute)
        await self.session.flush()
        containment = await self._contain(case)
        case.subscription_suspended = containment.suspended
        case.facts_snapshot = {
            **(case.facts_snapshot or {}),
            CONTAINMENT_SNAPSHOT_KEY: asdict(containment),
        }
        await self._apply_triage(case)
        record.processed = True
        await self.session.commit()
        return case

    async def _upsert_case(self, dispute: PayPalDisputeRecord) -> DisputeCase:
        case = await self.session.scalar(
            select(DisputeCase).where(DisputeCase.dispute_id == dispute.dispute_id)
        )
        if case is not None and case.merchant_id != self.merchant_id:
            raise NotFoundError(f"Dispute {dispute.dispute_id} was not found.")
        # Keyless demo: if PayPal did not link the order to a subscription (the
        # judge clicked "file dispute" without checkout), fall back to the demo
        # subscription so the containment breaker is still exercised end to end.
        subscription_id = dispute.subscription_id
        if (
            subscription_id is None
            and self.settings.demo_mode
            and dispute.payer_id == self.settings.demo_payer_id
        ):
            subscription_id = self.settings.demo_subscription_id
        if case is None:
            case = DisputeCase(
                dispute_id=dispute.dispute_id,
                merchant_id=self.merchant_id,
                paypal_order_id=dispute.order_id,
                paypal_subscription_id=subscription_id,
                paypal_payer_id=dispute.payer_id,
                reason_code=dispute.reason_code,
                lifecycle_stage=dispute.stage.value,
                dispute_channel=dispute.channel.value,
                status=dispute.status.value,
                currency=dispute.currency,
                amount_usd=quantize_money(dispute.amount),
                p_win=Decimal("0.0000"),
                ev_fight_usd=Decimal("0.00"),
                ev_settle_usd=Decimal("0.00"),
                ev_offer_usd=Decimal("0.00"),
                telemetry_completeness=Decimal("0.0000"),
                recommended_action=RecommendedAction.MONITOR.value,
                action_rationale=[],
                facts_snapshot={},
                subscription_suspended=False,
                seller_response_due_date=dispute.seller_response_due_date,
                paypal_links=dict(dispute.links),
            )
            self.session.add(case)
            return case

        case.paypal_order_id = dispute.order_id
        case.paypal_subscription_id = subscription_id or case.paypal_subscription_id
        case.paypal_payer_id = dispute.payer_id
        case.reason_code = dispute.reason_code
        case.lifecycle_stage = dispute.stage.value
        case.dispute_channel = dispute.channel.value
        case.status = dispute.status.value
        case.currency = dispute.currency
        case.amount_usd = quantize_money(dispute.amount)
        case.seller_response_due_date = dispute.seller_response_due_date
        case.paypal_links = dict(dispute.links)
        return case

    async def _contain(self, case: DisputeCase) -> ContainmentResult:
        """Suspend recurring billing; containment must never fail the request."""
        try:
            result = await contain_subscription(
                self.gateway,
                subscription_id=case.paypal_subscription_id,
                reason=f"dispute_opened:{case.dispute_id}",
                timeout_seconds=self.settings.action_latency_budget_ms / 1000,
            )
        except Exception as exc:  # defensive: the circuit breaker never blocks intake
            logger.error(
                "containment_error",
                extra=log_context(dispute_id=case.dispute_id, error=str(exc)),
            )
            return ContainmentResult(
                attempted=False,
                suspended=False,
                latency_ms=0,
                error=str(exc),
                subscription_id=case.paypal_subscription_id,
            )
        if result.error:
            logger.warning(
                "containment_failed",
                extra=log_context(
                    dispute_id=case.dispute_id,
                    subscription_id=result.subscription_id,
                    error=result.error,
                ),
            )
        return result

    async def _apply_triage(self, case: DisputeCase) -> TriageDecision:
        facts = await assemble_case_facts(
            self.session,
            merchant_id=self.merchant_id,
            settings=self.settings,
            gateway=self.gateway,
            case=case,
        )
        signals = SignalSet(**facts.signals)
        win = score_win_probability(signals, case.reason_code)
        signal_completeness = completeness(signals)
        sales_3mo, disputes_3mo = await self._volume_counts(
            exclude_dispute_id=case.dispute_id
        )
        ratio_after = (disputes_3mo + 1) / max(sales_3mo, 1)
        high_volume = (
            sales_3mo >= self.settings.high_volume_min_sales
            and ratio_relation(ratio_after, self.settings.ratio_threshold) == "at_or_above"
        )
        stage = DisputeStage(case.lifecycle_stage)
        channel = DisputeChannel(case.dispute_channel)
        links = dict(case.paypal_links or {})
        amount = quantize_money(as_decimal(case.amount_usd))
        prior_claim = (case.facts_snapshot or {}).get("buyer_claim_text")
        if prior_claim and not facts.buyer_claim_text:
            facts = facts.model_copy(update={"buyer_claim_text": prior_claim})
        inputs = EvInputs(
            amount_usd=amount,
            p_win=win.score,
            sales_3mo=sales_3mo,
            disputes_3mo=disputes_3mo,
            high_volume=high_volume,
            claim_fee_attached=stage in CLAIM_STAGES,
            offer_ratio=self.settings.offer_ratio,
            standard_fee_usd=self.settings.standard_fee_usd,
            high_volume_fee_usd=self.settings.high_volume_fee_usd,
            ratio_threshold=self.settings.ratio_threshold,
        )
        outcome = compute_ev(inputs)
        breakdown = to_breakdown(inputs, outcome)
        decision = decide(
            TriageInput(
                stage=stage,
                channel=channel,
                reason_code=case.reason_code,
                win=win,
                completeness=signal_completeness,
                ev=outcome,
                links=links,
                amount_usd=amount,
            )
        )

        case.p_win = Decimal(str(round(win.score, 4)))
        case.ev_fight_usd = quantize_money(outcome.ev_fight)
        case.ev_settle_usd = quantize_money(outcome.ev_settle)
        case.ev_offer_usd = quantize_money(outcome.ev_offer)
        case.telemetry_completeness = Decimal(str(round(signal_completeness, 4)))
        case.recommended_action = decision.action.value
        case.action_rationale = [item.model_dump(mode="json") for item in decision.rationale]
        snapshot = {
            **facts.model_dump(mode="json"),
            TRIAGE_SNAPSHOT_KEY: {
                "breakdown": breakdown.model_dump(mode="json"),
                "win_probability": win.model_dump(mode="json"),
            },
        }
        containment = (case.facts_snapshot or {}).get(CONTAINMENT_SNAPSHOT_KEY)
        if containment is not None:
            snapshot[CONTAINMENT_SNAPSHOT_KEY] = containment
        case.facts_snapshot = snapshot
        return decision

    async def _dispatch(
        self, action: DisputeAction, case: DisputeCase, request: schemas.ActionRequest
    ) -> GatewayResponse:
        if action is DisputeAction.SEND_MESSAGE:
            facts = await assemble_case_facts(
                self.session,
                merchant_id=self.merchant_id,
                settings=self.settings,
                gateway=self.gateway,
                case=case,
            )
            message = build_deflection_message(case, facts)
            if request.note:
                message = (message + "\n\n" + request.note.strip())[:MESSAGE_MAX_CHARS]
            return await self.gateway.send_message(case.dispute_id, message)

        if action is DisputeAction.MAKE_OFFER:
            ratio = (
                request.offer_ratio
                if request.offer_ratio is not None
                else self.settings.offer_ratio
            )
            amount = quantize_money(as_decimal(case.amount_usd) * as_decimal(ratio))
            note = f"Goodwill offer of {amount} USD to resolve dispute {case.dispute_id}."
            return await self.gateway.make_offer(
                case.dispute_id, amount, note, currency=case.currency
            )

        if action is DisputeAction.ACCEPT_CLAIM:
            note = f"Merchant accepts claim {case.dispute_id}."
            return await self.gateway.accept_claim(case.dispute_id, note)

        raise ValidationFailedError(f"Unsupported dispute action: {action}.")

    async def _refresh_from_gateway(self, case: DisputeCase) -> None:
        """Best-effort resync of stage/status/links; never fails the caller."""
        try:
            dispute = await self.gateway.get_dispute(case.dispute_id)
        except Exception as exc:
            logger.warning(
                "case_refresh_failed",
                extra=log_context(dispute_id=case.dispute_id, error=str(exc)),
            )
            return
        case.lifecycle_stage = dispute.stage.value
        case.dispute_channel = dispute.channel.value
        case.status = dispute.status.value
        case.seller_response_due_date = dispute.seller_response_due_date
        case.paypal_links = dict(dispute.links)

    async def _volume_counts(self, *, exclude_dispute_id: str | None = None) -> tuple[int, int]:
        """Completed sales and disputes in the trailing 90-day window.

        Triage passes the case being decided so disputes_3mo counts *prior*
        disputes only: the EV engine then applies its own (disputes_3mo + 1)
        increment once, never twice.
        """
        cutoff = datetime.now(UTC) - timedelta(days=VOLUME_WINDOW_DAYS)
        sales = (
            await self.session.scalar(
                select(func.count())
                .select_from(PaypalTransaction)
                .where(
                    PaypalTransaction.merchant_id == self.merchant_id,
                    PaypalTransaction.status == "COMPLETED",
                    PaypalTransaction.created_at >= cutoff,
                )
            )
            or 0
        )
        dispute_filters = [
            DisputeCase.merchant_id == self.merchant_id,
            DisputeCase.created_at >= cutoff,
        ]
        if exclude_dispute_id is not None:
            dispute_filters.append(DisputeCase.dispute_id != exclude_dispute_id)
        disputes = (
            await self.session.scalar(
                select(func.count())
                .select_from(DisputeCase)
                .where(*dispute_filters)
            )
            or 0
        )
        return int(sales), int(disputes)

    async def _find_event(self, event_id: str) -> WebhookEventRecord | None:
        return await self.session.scalar(
            select(WebhookEventRecord).where(WebhookEventRecord.event_id == event_id)
        )

    async def _find_action_by_key(self, key: str) -> DisputeActionRecord | None:
        return await self.session.scalar(
            select(DisputeActionRecord).where(DisputeActionRecord.idempotency_key == key)
        )

    async def _replay(
        self, record: WebhookEventRecord
    ) -> tuple[WebhookEventRecord, DisputeCase | None]:
        """Mark a replayed event and return the case its first delivery created."""
        record.is_duplicate = True  # type: ignore[attr-defined]
        dispute_id = (record.payload or {}).get("dispute_id")
        case = None
        if dispute_id:
            case = await self.session.scalar(
                select(DisputeCase).where(
                    DisputeCase.dispute_id == dispute_id,
                    DisputeCase.merchant_id == self.merchant_id,
                )
            )
        return record, case

    def _webhook_payload(self, event: WebhookEvent) -> dict[str, Any]:
        dispute = event.dispute
        return {
            "event_id": event.event_id,
            "event_type": event.event_type,
            "resource_type": event.resource_type,
            "summary": event.summary,
            "dispute_id": None if dispute is None else dispute.dispute_id,
            "raw": json.loads(json.dumps(dict(event.raw), default=str)),
        }

    def _facts_from_snapshot(
        self, snapshot: Mapping[str, Any], case: DisputeCase
    ) -> schemas.CaseFacts:
        payload = {
            key: value
            for key, value in snapshot.items()
            if key not in (TRIAGE_SNAPSHOT_KEY, CONTAINMENT_SNAPSHOT_KEY)
        }
        if payload:
            return schemas.CaseFacts.model_validate(payload)
        return schemas.CaseFacts(
            payer_id=case.paypal_payer_id,
            chain_valid=False,
            chain_head="",
            event_count=0,
            completeness=0.0,
        )

    def _signed_webhook(
        self, dispute: PayPalDisputeRecord
    ) -> tuple[bytes, dict[str, str]]:
        """Sign a CUSTOMER.DISPUTE.CREATED envelope exactly like PayPal traffic."""
        payload = self._webhook_envelope(dispute)
        raw_body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        timestamp = str(int(datetime.now(UTC).timestamp()))
        signature = compute_signature(
            self.settings.verdictpay_webhook_secret, timestamp, raw_body
        )
        return raw_body, {
            "X-VerdictPay-Timestamp": timestamp,
            "X-VerdictPay-Signature": signature,
        }

    def _webhook_envelope(self, dispute: PayPalDisputeRecord) -> dict[str, Any]:
        """Render a PayPal-shaped CUSTOMER.DISPUTE.CREATED body for the sandbox."""
        return {
            "id": f"WH-{dispute.dispute_id}",
            "event_type": WebhookEventType.CUSTOMER_DISPUTE_CREATED.value,
            "resource_type": "dispute",
            "summary": f"{dispute.reason_code} dispute {dispute.dispute_id} created",
            "resource": {
                "dispute_id": dispute.dispute_id,
                "reason": dispute.reason_code,
                "dispute_life_cycle_stage": dispute.stage.value,
                "dispute_channel": dispute.channel.value,
                "status": dispute.status.value,
                "dispute_amount": {
                    "currency_code": dispute.currency,
                    "value": f"{quantize_money(dispute.amount)}",
                },
                "payer": {"payer_id": dispute.payer_id},
                "seller_transaction_id": dispute.order_id,
                "order_id": dispute.order_id,
                "subscription_id": dispute.subscription_id,
                "seller_response_due_date": (
                    None
                    if dispute.seller_response_due_date is None
                    else dispute.seller_response_due_date.isoformat()
                ),
                "links": [{"rel": rel, "href": href} for rel, href in dispute.links.items()],
                "create_time": dispute.created_at.isoformat(),
            },
        }
