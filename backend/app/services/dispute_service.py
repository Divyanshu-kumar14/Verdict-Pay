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
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import asdict, replace
from datetime import UTC, datetime, timedelta
from decimal import ROUND_DOWN, Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.config import Settings
from app.db.models import (
    CardNetworkMonthlyFeed,
    DisputeActionRecord,
    DisputeCase,
    PaypalTransaction,
    TelemetryLedger,
    WebhookEventRecord,
)
from app.domain.constants import SETTLED_STATUSES
from app.domain.disputes.decision import compare, policy_reason_from
from app.domain.disputes.ev import EvInputs, compute_ev, to_breakdown
from app.domain.disputes.state_machine import (
    ensure_allowed,
    expected_rels,
    to_allowed_actions,
)
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
from app.errors import (
    ConflictError,
    NotFoundError,
    UpstreamError,
    ValidationFailedError,
    WebhookVerificationError,
)
from app.integrations.paypal import wire
from app.logging_setup import get_logger, log_context
from app.oracle.cliff_engine import (
    HvdInputs,
    ecp_state,
    full_calendar_months_window,
    hvd_state,
    vamp_state,
)
from app.oracle.manifest import get_manifest
from app.oracle.money import PPM, from_minor, to_minor
from app.sentinel import bridge as sentinel_bridge
from app.sentinel import token as sentinel_token

logger = get_logger("verdictpay.disputes")

CENT = Decimal("0.01")
# Transient claim status stored in dispute_actions.status. It is deliberately not
# part of the frozen ActionStatus API enum: the column is a plain string and an
# in-flight claim must never be presented as a finished result.
ACTION_STATUS_IN_PROGRESS = "IN_PROGRESS"
TRIAGE_SNAPSHOT_KEY = "_triage"
CONTAINMENT_SNAPSHOT_KEY = "_containment"
# "paypal_sandbox" when PayPal created the dispute, "internal_test_event" when
# the demo built it locally. Absent for cases that arrived by webhook.
DISPUTE_ORIGIN_KEY = "_origin"
# PayPal messages[] (buyer/seller thread), kept for the AI analyst.
MESSAGES_SNAPSHOT_KEY = "_messages"
# Kept in sync with evidence_service.DOSSIER_SNAPSHOT_KEY (import cycle).
DOSSIER_SNAPSHOT_KEY = "_dossier"
PRIVATE_SNAPSHOT_KEYS = frozenset(
    {
        "_triage",
        "_containment",
        "_origin",
        "_messages",
        "_dossier",
        "_sentinel",
    }
)
CE3_WINDOW_START_DAYS = 365
CE3_WINDOW_END_DAYS = 120
VOLUME_WINDOW_DAYS = 90
MESSAGE_MAX_CHARS = 2000
OPEN_STAGES = frozenset(
    {
        DisputeStage.INQUIRY,
        DisputeStage.CHARGEBACK,
        DisputeStage.PRE_ARBITRATION,
        DisputeStage.ARBITRATION,
    }
)
CLAIM_STAGES = frozenset(
    {DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION, DisputeStage.ARBITRATION}
)
SOURCE_BADGES: dict[str, str] = {
    "LIVE_PAYPAL_SANDBOX": "[LIVE PAYPAL SANDBOX]",
    "SIMULATED_CARD_NETWORK_FEED": "[VISA-TC40 / ACQUIRER-FEED SIMULATION]",
    "INTERNAL_TEST_EVENT": "[LOCAL TEST DISPUTE · PAYPAL SANDBOX ORDER]",
}
PROTECTED_ACTIONS = frozenset(
    {RecommendedAction.DEFLECT_INQUIRY, RecommendedAction.PROVIDE_EVIDENCE}
)


def _source_plane_for(payment_rail: str) -> str:
    return (
        "SIMULATED_CARD_NETWORK_FEED"
        if payment_rail == "UNBRANDED_CARD"
        else ("LIVE_PAYPAL_SANDBOX")
    )


def quantize_money(value: Decimal | int | float | str) -> Decimal:
    """Round any money-ish value to cents, toward zero (deterministic)."""
    raw = value if isinstance(value, Decimal) else Decimal(str(value))
    return raw.quantize(CENT, rounding=ROUND_DOWN)


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
        p_win=as_decimal(case.p_win),
        ev_fight_usd=quantize_money(as_decimal(case.ev_fight_usd)),
        ev_settle_usd=quantize_money(as_decimal(case.ev_settle_usd)),
        ev_offer_usd=quantize_money(as_decimal(case.ev_offer_usd)),
        telemetry_completeness=as_decimal(case.telemetry_completeness),
        recommended_action=RecommendedAction(case.recommended_action),
        subscription_suspended=bool(case.subscription_suspended),
        dossier_available=bool(case.dossier_pdf_url),
        seller_response_due_date=utc_aware(case.seller_response_due_date),
        created_at=utc_aware(case.created_at),
        updated_at=utc_aware(case.updated_at),
        payment_rail=case.payment_rail or "PAYPAL_WALLET",
        external_reason_code=case.external_reason_code,
        amount_minor=int(case.amount_minor or to_minor(as_decimal(case.amount_usd))),
        source_plane=case.source_plane or "LIVE_PAYPAL_SANDBOX",
        source_badge=SOURCE_BADGES.get(
            case.source_plane or "", SOURCE_BADGES["LIVE_PAYPAL_SANDBOX"]
        ),
        sla_response_days=int(
            ((case.facts_snapshot or {}).get(TRIAGE_SNAPSHOT_KEY) or {})
            .get("breakdown", {})
            .get("sla_response_days", 10)
        ),
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
            raise ConflictError("That idempotency key belongs to another dispute.") from None
        if existing.status == ACTION_STATUS_IN_PROGRESS:
            raise ConflictError(
                "This action is already being executed.", code="action_in_progress"
            ) from None
        return record, existing


INTERNAL_TEST_SKIP_REASON = (
    "internal_test_event: this dispute exists only in VerdictPay, so nothing was sent to PayPal"
)


def is_internal_test_case(case: DisputeCase) -> bool:
    """True for a dispute the demo built locally because PayPal could not."""
    return (case.facts_snapshot or {}).get(DISPUTE_ORIGIN_KEY) == "internal_test_event"


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


def _record_from_row(row: PaypalTransaction) -> PayPalTransactionRecord:
    return PayPalTransactionRecord(
        transaction_id=row.transaction_id,
        payer_id=row.payer_id,
        amount=as_decimal(row.amount_usd),
        currency=row.currency,
        status=row.status,
        client_ip=row.client_ip or "",
        device_fingerprint=row.device_fingerprint or "",
        created_at=utc_aware(row.created_at) or datetime.now(UTC),
        payment_rail=row.payment_rail or "PAYPAL_WALLET",
        payment_credential_hash=row.payment_credential_hash or "",
        account_login_id_hash=row.account_login_id_hash or "",
        shipping_address_hash=row.shipping_address_hash or "",
        has_prior_dispute=bool(row.disputed_claim),
        has_tc40=bool(row.has_tc40),
        source=row.source or "local",
    )


async def correlate_local_anchors(
    session: AsyncSession,
    *,
    merchant_id: str,
    payer_id: str,
    records: Sequence[PayPalTransactionRecord],
    start: datetime,
    end: datetime,
) -> list[PayPalTransactionRecord]:
    """Attach CE 3.0 anchors from the local ledger to Reporting v1 records.

    PayPal Reporting v1 has no buyer IP, device, credential, login or shipping
    fields. The local order/telemetry ledger does, keyed by transaction id, so
    each PayPal record is enriched from it, and ledger-only history rows (the
    labelled seed history) are included alongside.
    """
    rows = list(
        (
            await session.scalars(
                select(PaypalTransaction).where(
                    PaypalTransaction.merchant_id == merchant_id,
                    PaypalTransaction.payer_id == payer_id,
                    PaypalTransaction.created_at >= start,
                    PaypalTransaction.created_at <= end,
                )
            )
        ).all()
    )
    local = {row.transaction_id: _record_from_row(row) for row in rows}
    merged: list[PayPalTransactionRecord] = []
    for record in records:
        anchor = local.pop(record.transaction_id, None)
        if anchor is None:
            merged.append(record)
            continue
        merged.append(
            replace(
                record,
                client_ip=record.client_ip or anchor.client_ip,
                device_fingerprint=record.device_fingerprint or anchor.device_fingerprint,
                payment_rail=anchor.payment_rail,
                payment_credential_hash=anchor.payment_credential_hash,
                account_login_id_hash=anchor.account_login_id_hash,
                shipping_address_hash=anchor.shipping_address_hash,
                has_prior_dispute=anchor.has_prior_dispute,
                has_tc40=anchor.has_tc40,
            )
        )
    merged.extend(local[key] for key in sorted(local))
    return merged


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
        # ``provenance`` is the stable machine label ("paypal_sandbox",
        # "paypal_live"), not the mutable config spelling.
        paypal_mode=settings.provenance,
        records=transactions,
    )
    transactions = await correlate_local_anchors(
        session,
        merchant_id=merchant_id,
        payer_id=case.paypal_payer_id,
        records=transactions,
        start=reference - timedelta(days=CE3_WINDOW_START_DAYS + 1),
        end=reference - timedelta(days=CE3_WINDOW_END_DAYS - 1),
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
            payment_rail=case.payment_rail or "PAYPAL_WALLET",
            external_reason_code=case.external_reason_code,
            order_id=case.paypal_order_id,
            disputed_at=utc_aware(case.created_at) or reference,
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
        return await self._ingest_event(verification.event)

    async def open_sandbox_dispute(
        self,
        *,
        payer_id: str,
        order_id: str,
        reason_code: str,
        stage: DisputeStage,
        channel: DisputeChannel,
        amount: Decimal,
        buyer_claim_text: str | None = None,
        payment_rail: str = "PAYPAL_WALLET",
        external_reason_code: str | None = None,
    ) -> tuple[WebhookEventRecord, DisputeCase, str]:
        """Open a dispute for a demo order and run it through the case pipeline.

        PayPal is asked first (POST /v1/customer/disputes). Sandbox apps
        without dispute-creation rights get a 401; in demo mode the dispute is
        then built locally and returned with ``origin="internal_test_event"``,
        so nobody mistakes it for one PayPal filed. Returns the event record,
        the case and the origin label.
        """
        amount = quantize_money(amount)
        origin = "paypal_sandbox"
        try:
            dispute = await self.gateway.create_sandbox_dispute(
                payer_id=payer_id,
                order_id=order_id,
                reason_code=reason_code,
                amount=amount,
                currency="USD",
                stage=stage,
                channel=channel,
            )
        except UpstreamError as exc:
            if not self.settings.demo_mode:
                raise
            logger.info(
                "sandbox_dispute_internal_fallback",
                extra=log_context(order_id=order_id, reason=str(exc)[:200]),
            )
            origin = "internal_test_event"
            dispute = self._internal_test_dispute(
                payer_id=payer_id,
                order_id=order_id,
                reason_code=reason_code,
                stage=stage,
                channel=channel,
                amount=amount,
                payment_rail=payment_rail,
                external_reason_code=external_reason_code,
                hvd_sla_days=await self._current_sla_days(),
            )
        # Trust comes from the authenticated call (or from building it here),
        # not from a webhook signature, so no signature check is needed.
        event = wire.parse_webhook_event(self._webhook_envelope(dispute))
        # The claim text and origin must be on the case *before* triage runs,
        # otherwise the first triage (and its AI context) never sees them.
        preset: dict[str, Any] = {DISPUTE_ORIGIN_KEY: origin}
        claim = (buyer_claim_text or "").strip()[:4000]
        if claim:
            preset["buyer_claim_text"] = claim
        record, case = await self._ingest_event(event, preset_snapshot=preset)
        if case is None:
            raise ValidationFailedError("Sandbox dispute did not produce a case.")
        await self.session.commit()
        return record, case, origin

    @staticmethod
    def _internal_test_dispute(
        *,
        payer_id: str,
        order_id: str,
        reason_code: str,
        stage: DisputeStage,
        channel: DisputeChannel,
        amount: Decimal,
        payment_rail: str = "PAYPAL_WALLET",
        external_reason_code: str | None = None,
        hvd_sla_days: int = 10,
    ) -> PayPalDisputeRecord:
        """A locally built dispute; its response SLA follows the merchant's tier.

        PayPal gives standard merchants 10 days and HVD-tier merchants 3.
        """
        now = datetime.now(UTC)
        return PayPalDisputeRecord(
            dispute_id=f"PP-D-TEST-{uuid.uuid4().hex[:10].upper()}",
            reason_code=wire.normalise_reason(reason_code),
            stage=stage,
            channel=channel,
            status=DisputeStatus.OPEN,
            amount=amount,
            currency="USD",
            payer_id=payer_id,
            order_id=order_id,
            subscription_id=None,
            seller_response_due_date=now + timedelta(days=hvd_sla_days),
            links=expected_rels(stage),
            created_at=now,
            raw={"source": "internal_test_event"},
            external_reason_code=external_reason_code,
            payment_rail=payment_rail,
        )

    async def _ingest_event(
        self, event: WebhookEvent, *, preset_snapshot: Mapping[str, Any] | None = None
    ) -> tuple[WebhookEventRecord, DisputeCase | None]:
        """De-duplicate on event_id, then upsert and triage the case."""
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

        case = await self._apply_event(record, event, preset_snapshot=preset_snapshot)
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
        allowed_actions = to_allowed_actions(
            stage=stage,
            channel=channel,
            links=links,
            high_volume=breakdown.high_volume,
        )
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

            ensure_allowed(
                action,
                stage=DisputeStage(case.lifecycle_stage),
                channel=DisputeChannel(case.dispute_channel),
                links=dict(case.paypal_links or {}),
            )
            evidence = EvidenceService(
                self.session,
                settings=self.settings,
                gateway=self.gateway,
                narrative=self.narrative,
                merchant_id=self.merchant_id,
            )

            async def authorize_evidence(dossier: Any, document_name: str) -> dict[str, Any]:
                """Gate the upload with the frozen dossier as the evidence claim."""
                return await self.authorize_write(
                    case,
                    action,
                    request,
                    evidence_payload={
                        "attachments": [{"name": document_name, "size_bytes": dossier.size_bytes}],
                        # Digital goods: there is no shipment tracker, and the
                        # merchant asserts no tracking or refund reference it
                        # cannot corroborate, so nothing is claimed here.
                        "known_tracking_numbers": [],
                        "known_refund_ids": [],
                        "evidences": [],
                    },
                )

            return await evidence.submit(
                dispute_id,
                idempotency_key=request.idempotency_key or "",
                authorize=authorize_evidence,
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
                "stage": stage.value,
            },
        )
        if replay is not None:
            await self.session.refresh(case)
            return self._replay_action(replay, case)

        # The key is owned before the Sentinel runs, so two concurrent clicks
        # can never both clear the gate and dispatch. A veto is terminal for
        # this key: mark the claim FAILED or it blocks every later retry.
        try:
            approval = await self.authorize_write(case, action, request)
        except Exception as exc:
            record.status = ActionStatus.FAILED.value
            record.error = f"{type(exc).__name__}: {exc}"
            record.latency_ms = 0
            await self.session.commit()
            raise

        if is_internal_test_case(case):
            # PayPal has never seen this dispute, so any call would 404.
            record.status = ActionStatus.SKIPPED.value
            record.error = INTERNAL_TEST_SKIP_REASON
            record.latency_ms = 0
            record.response_payload = {"skipped": True, "reason": INTERNAL_TEST_SKIP_REASON}
            await self.session.commit()
            return record, case

        started = time.perf_counter()
        reset = sentinel_token.current_approval.set(approval["hmac_approval_token"])
        try:
            upstream = await self._dispatch(action, case, request)
        except Exception as exc:
            record.status = ActionStatus.FAILED.value
            record.error = f"{type(exc).__name__}: {exc}"
            record.latency_ms = _elapsed_ms(started)
            await self.session.commit()
            logger.error(
                "action_failed",
                extra=log_context(dispute_id=dispute_id, action=action.value, error=record.error),
            )
            raise
        finally:
            sentinel_token.current_approval.reset(reset)

        record.status = ActionStatus.EXECUTED.value
        record.latency_ms = _elapsed_ms(started)
        record.response_payload = dict(upstream.body)
        await self._refresh_from_gateway(case)
        if action is DisputeAction.ACCEPT_CLAIM:
            case.status = DisputeStatus.RESOLVED.value
            case.lifecycle_stage = DisputeStage.CLOSED.value
        await self.session.commit()
        return record, case

    async def authorize_write(
        self,
        case: DisputeCase,
        action: DisputeAction,
        request: schemas.ActionRequest,
        *,
        untrusted_text: str | None = None,
        evidence_payload: Mapping[str, Any] | None = None,
        claimed_ce3_manifest: Mapping[str, Any] | None = None,
        candidate_mode: str = "HARDENED",
    ) -> dict[str, Any]:
        """Run the Sentinel for one PayPal write; VETO raises 422, ALLOW returns a token.

        Actions chosen by the deterministic triage carry no buyer text (the
        text cannot have influenced them); AI-originated proposals pass it.
        The merchant's own ``note`` is untrusted too: it is sent to the buyer
        verbatim, so it is scanned and priced like any other free text.
        """
        note = (request.note or "").strip() or None
        gate_text = "\n".join(part for part in (untrusted_text, note) if part) or None
        if action is DisputeAction.PROVIDE_EVIDENCE and claimed_ce3_manifest is None:
            proof = (case.facts_snapshot or {}).get("ce3_proof")
            if isinstance(proof, Mapping):
                claim = proof.get("claim_manifest")
                if isinstance(claim, Mapping):
                    claimed_ce3_manifest = claim
        hvd = await self._hvd_inputs(exclude_dispute_id=case.dispute_id)
        vamp = await self.vamp_status()
        amount_minor = to_minor(quantize_money(as_decimal(case.amount_usd)))
        offer_minor = None
        if action is DisputeAction.MAKE_OFFER:
            ratio = request.offer_ratio
            if ratio is None:
                ratio = self.settings.offer_ratio
            offer_minor = to_minor(quantize_money(as_decimal(case.amount_usd) * as_decimal(ratio)))
        proposal = sentinel_bridge.build_proposal(
            dispute_id=case.dispute_id,
            action=action.value,
            stage=case.lifecycle_stage,
            channel=case.dispute_channel,
            reason_code=case.reason_code,
            payment_rail=case.payment_rail or "PAYPAL_WALLET",
            external_reason_code=case.external_reason_code,
            amount_minor=amount_minor,
            currency=case.currency,
            hateoas_rels=list((case.paypal_links or {}).keys()),
            portfolio={
                "hvd": {
                    "settled_txns_3m": hvd.settled_txns,
                    "net_sales_minor_3m": hvd.net_sales_minor,
                    "disputed_amount_minor_3m": hvd.disputed_minor,
                },
                "vamp": None
                if vamp is None
                else {
                    "tc05_settled_cnp": vamp.tc05_settled_cnp,
                    "tc40_fraud_count": vamp.tc40_fraud_count,
                    "tc15_dispute_count": vamp.tc15_dispute_count,
                },
            },
            untrusted_text=gate_text,
            offer_amount_minor=offer_minor,
            offer_note=note if action is DisputeAction.MAKE_OFFER else None,
            evidence_payload=evidence_payload,
            claimed_ce3_manifest=claimed_ce3_manifest,
            p_win_ppm=int((as_decimal(case.p_win) * PPM).to_integral_value(rounding=ROUND_DOWN)),
            modeled_fight_ev_minor=to_minor(quantize_money(as_decimal(case.ev_fight_usd))),
            candidate_mode=candidate_mode,
        )
        return await sentinel_bridge.authorize(
            self.session,
            settings=self.settings,
            merchant_id=self.merchant_id,
            proposal=proposal,
        )

    async def record_ai_veto(self, *, dispute_id: str, veto_code: str, detail: str) -> None:
        """Audit a deterministic AI-layer veto on the SENTINEL-AUDIT chain."""
        await sentinel_bridge.record_verdict(
            self.session,
            merchant_id=self.merchant_id,
            verdict={
                "proposal_id": str(uuid.uuid4()),
                "dispute_id": dispute_id,
                "proposed_action": "AI_ANALYZE",
                "verdict": "VETO",
                "exit_code": 2,
                "veto_codes": [veto_code],
                "reasons": [detail],
                "manifest_sha256": get_manifest().sha256,
                "candidate_mode": "LLM_UNGUARDED",
            },
        )
        await self.session.commit()

    def _replay_action(
        self, existing: DisputeActionRecord, case: DisputeCase
    ) -> tuple[DisputeActionRecord, DisputeCase]:
        """Return a finished audit row as the idempotent answer to a retry."""
        if existing.dispute_id != case.dispute_id:
            raise ConflictError("That idempotency key belongs to another dispute.")
        if existing.status == ACTION_STATUS_IN_PROGRESS:
            raise ConflictError("This action is already being executed.", code="action_in_progress")
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
        hvd_inputs = await self._hvd_inputs()
        hvd = hvd_state(
            settled_txns_3m=hvd_inputs.settled_txns,
            net_sales_minor_3m=hvd_inputs.net_sales_minor,
            disputed_amount_minor_3m=hvd_inputs.disputed_minor,
        )
        # Fees avoided = the active tier fee on INQUIRY cases that were *closed
        # amicably* (deflected / settled by offer) and so never became claims.
        # An open inquiry nobody acted on has avoided nothing yet.
        deflected = await self._resolved_deflected_inquiries(cases)
        fees_avoided = from_minor(hvd.active_fee_tier_usd_cents) * deflected
        p_wins = [as_decimal(case.p_win) for case in cases]
        confident = [
            as_decimal(case.p_win)
            for case in cases
            if as_decimal(case.telemetry_completeness) >= Decimal("0.6")
        ]
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
            subscription_suspensions=sum(1 for case in cases if bool(case.subscription_suspended)),
            chain_verified_customers=chain_verified,
            high_volume=schemas.HighVolumeStatus(
                flag=hvd.in_tier,
                ratio=Decimal(hvd.ratio_ppm) / PPM,
                threshold=Decimal(hvd.threshold_ppm) / PPM,
                sales_3mo=hvd.settled_txns_3m,
                disputes_3mo=hvd_inputs.disputed_claims,
                ratio_ppm=hvd.ratio_ppm,
                threshold_ppm=hvd.threshold_ppm,
                ratio_str=hvd.ratio_str,
                net_sales_minor_3m=hvd.net_sales_amount_minor_3m,
                disputed_amount_minor_3m=hvd.disputed_amount_minor_3m,
                amount_until_cliff_minor=hvd.amount_until_cliff_minor,
                active_fee_tier_usd_cents=hvd.active_fee_tier_usd_cents,
                fee_reimbursable_on_win=hvd.fee_reimbursable_on_win,
                sla_response_days=hvd.sla_response_days,
                window_start=hvd_inputs.window_start,
                window_end=hvd_inputs.window_end,
            ),
            vamp=await self.vamp_status(),
            rules_manifest_sha256=get_manifest().sha256,
            generated_at=datetime.now(UTC),
        )

    async def _resolved_deflected_inquiries(self, cases: Sequence[DisputeCase]) -> int:
        """INQUIRY cases closed amicably after an executed SEND_MESSAGE/MAKE_OFFER."""
        closed = [
            case
            for case in cases
            if DisputeStage(case.lifecycle_stage) in (DisputeStage.RESOLVED, DisputeStage.CLOSED)
        ]
        if not closed:
            return 0
        rows = (
            await self.session.execute(
                select(DisputeActionRecord.dispute_id, DisputeActionRecord.request_payload).where(
                    DisputeActionRecord.dispute_id.in_([case.dispute_id for case in closed]),
                    DisputeActionRecord.action.in_(
                        [DisputeAction.SEND_MESSAGE.value, DisputeAction.MAKE_OFFER.value]
                    ),
                    DisputeActionRecord.status == ActionStatus.EXECUTED.value,
                )
            )
        ).all()
        deflected: set[str] = set()
        for dispute_id, payload in rows:
            if (payload or {}).get("stage", DisputeStage.INQUIRY.value) == (
                DisputeStage.INQUIRY.value
            ):
                deflected.add(dispute_id)
        return len(deflected)

    # ------------------------------------------------------------------ internals
    async def _apply_event(
        self,
        record: WebhookEventRecord,
        event: WebhookEvent,
        *,
        preset_snapshot: Mapping[str, Any] | None = None,
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
            **dict(preset_snapshot or {}),
            CONTAINMENT_SNAPSHOT_KEY: asdict(containment),
        }
        if dispute.messages:
            case.facts_snapshot = {
                **case.facts_snapshot,
                MESSAGES_SNAPSHOT_KEY: [dict(message) for message in dispute.messages],
            }
        origin = (preset_snapshot or {}).get(DISPUTE_ORIGIN_KEY)
        if origin == "internal_test_event":
            case.source_plane = "INTERNAL_TEST_EVENT"
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
                payment_rail=dispute.payment_rail,
                external_reason_code=dispute.external_reason_code,
                amount_minor=to_minor(quantize_money(dispute.amount)),
                source_plane=_source_plane_for(dispute.payment_rail),
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
        case.payment_rail = dispute.payment_rail
        case.external_reason_code = dispute.external_reason_code or case.external_reason_code
        case.amount_minor = to_minor(quantize_money(dispute.amount))
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
        hvd = await self._hvd_inputs(exclude_dispute_id=case.dispute_id)
        stage = DisputeStage(case.lifecycle_stage)
        channel = DisputeChannel(case.dispute_channel)
        links = dict(case.paypal_links or {})
        amount = quantize_money(as_decimal(case.amount_usd))
        previous = dict(case.facts_snapshot or {})
        prior_claim = previous.get("buyer_claim_text")
        if prior_claim and not facts.buyer_claim_text:
            facts = facts.model_copy(update={"buyer_claim_text": prior_claim})
        inputs = EvInputs(
            amount_usd=amount,
            p_win=win.score,
            stage=stage,
            payment_rail=case.payment_rail or "PAYPAL_WALLET",
            reason_code=case.reason_code,
            settled_txns_3m=hvd.settled_txns,
            net_sales_minor_3m=hvd.net_sales_minor,
            disputed_amount_minor_3m=hvd.disputed_minor,
            disputes_3mo=hvd.disputed_claims,
            offer_ratio=self.settings.offer_ratio,
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

        case.p_win = Decimal(str(win.score)).quantize(Decimal("0.0001"))
        case.ev_fight_usd = quantize_money(outcome.ev_fight)
        case.ev_settle_usd = quantize_money(outcome.ev_settle)
        case.ev_offer_usd = quantize_money(outcome.ev_offer)
        case.telemetry_completeness = Decimal(str(signal_completeness))
        case.recommended_action = decision.action.value
        case.action_rationale = [item.model_dump(mode="json") for item in decision.rationale]
        snapshot = {
            **facts.model_dump(mode="json"),
            TRIAGE_SNAPSHOT_KEY: {
                "breakdown": breakdown.model_dump(mode="json"),
                "win_probability": win.model_dump(mode="json"),
                "hvd_window": [hvd.window_start.isoformat(), hvd.window_end.isoformat()],
            },
        }
        # Every private key (containment proof, origin, PayPal thread, the
        # dossier record, Sentinel audit) survives a re-triage untouched.
        for key in PRIVATE_SNAPSHOT_KEYS - {TRIAGE_SNAPSHOT_KEY}:
            if key in previous:
                snapshot[key] = previous[key]
        if prior_claim and "buyer_claim_text" not in snapshot:
            snapshot["buyer_claim_text"] = prior_claim
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
            note = (request.note or "").strip() or (
                f"Goodwill offer of {amount} USD to resolve dispute {case.dispute_id}."
            )
            return await self.gateway.make_offer(
                case.dispute_id,
                amount,
                note,
                currency=case.currency,
                offer_type=request.offer_type or "REFUND",
            )

        if action is DisputeAction.ACCEPT_CLAIM:
            note = f"Merchant accepts claim {case.dispute_id}."
            return await self.gateway.accept_claim(
                case.dispute_id,
                note,
                accept_claim_type=request.accept_claim_type or "REFUND",
            )

        if action is DisputeAction.ESCALATE:
            note = (request.note or "").strip() or f"Seller escalates {case.dispute_id}."
            return await self.gateway.escalate(case.dispute_id, note[:MESSAGE_MAX_CHARS])

        raise ValidationFailedError(f"Unsupported dispute action: {action}.")

    async def _refresh_from_gateway(self, case: DisputeCase) -> None:
        """Best-effort resync of stage/status/links; never fails the caller."""
        if is_internal_test_case(case):
            # PayPal has no record of it: asking only costs a 404 round trip.
            return
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

    async def _hvd_inputs(self, *, exclude_dispute_id: str | None = None) -> HvdInputs:
        """Dollar-weighted PayPal HVD inputs over the 3 full calendar months.

        Wallet rail only. Net sales = settled (COMPLETED/CAPTURED) wallet sales.
        Disputed amount = wallet INR/SNAD *claims* (historic sales flagged
        ``disputed_claim`` plus live cases in a claim stage). Unescalated
        INQUIRY cases and UNBRANDED_CARD disputes never count. The case being
        decided is excluded so the EV engine adds it exactly once.
        """
        rules = get_manifest().section("hvd")
        window_start, window_end = full_calendar_months_window(
            datetime.now(UTC), int(rules["lookback_full_calendar_months"])
        )
        wallet_sales = (
            PaypalTransaction.merchant_id == self.merchant_id,
            PaypalTransaction.status.in_(SETTLED_STATUSES),
            PaypalTransaction.payment_rail == "PAYPAL_WALLET",
            PaypalTransaction.created_at >= window_start,
            PaypalTransaction.created_at < window_end,
        )
        row = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(PaypalTransaction.amount_usd), 0))
                .select_from(PaypalTransaction)
                .where(*wallet_sales)
            )
        ).one()
        settled, net_sales = int(row[0] or 0), as_decimal(row[1] or 0)
        claimed = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(PaypalTransaction.amount_usd), 0))
                .select_from(PaypalTransaction)
                .where(*wallet_sales, PaypalTransaction.disputed_claim.is_(True))
            )
        ).one()
        claim_filters = [
            DisputeCase.merchant_id == self.merchant_id,
            DisputeCase.payment_rail == "PAYPAL_WALLET",
            DisputeCase.reason_code.in_(list(rules["countable_reasons"])),
            DisputeCase.lifecycle_stage.in_(list(rules["countable_stages"])),
            DisputeCase.created_at >= window_start,
            DisputeCase.created_at < window_end,
        ]
        if exclude_dispute_id is not None:
            claim_filters.append(DisputeCase.dispute_id != exclude_dispute_id)
        live = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(DisputeCase.amount_usd), 0))
                .select_from(DisputeCase)
                .where(*claim_filters)
            )
        ).one()
        return HvdInputs(
            settled_txns=settled,
            net_sales_minor=to_minor(net_sales),
            disputed_minor=to_minor(as_decimal(claimed[1] or 0))
            + to_minor(as_decimal(live[1] or 0)),
            disputed_claims=int(claimed[0] or 0) + int(live[0] or 0),
            window_start=window_start,
            window_end=window_end,
        )

    async def _current_sla_days(self) -> int:
        hvd = await self._hvd_inputs()
        return hvd_state(
            settled_txns_3m=hvd.settled_txns,
            net_sales_minor_3m=hvd.net_sales_minor,
            disputed_amount_minor_3m=hvd.disputed_minor,
        ).sla_response_days

    async def vamp_status(self) -> schemas.VampStatus | None:
        """Latest month of the simulated card-network feed, or None if absent."""
        feed = await self.session.scalar(
            select(CardNetworkMonthlyFeed)
            .where(CardNetworkMonthlyFeed.merchant_id == self.merchant_id)
            .order_by(CardNetworkMonthlyFeed.month.desc())
            .limit(1)
        )
        if feed is None:
            return None
        vamp = vamp_state(
            tc05_settled_cnp=feed.tc05_count,
            tc40_fraud_count=feed.tc40_count,
            tc15_dispute_count=feed.tc15_count,
            dual_counted_events=feed.dual_counted,
            ce3_remedied_tc15=feed.ce3_remedied_tc15,
        )
        ecp = ecp_state(
            prior_month_settled_mc=feed.mc_prior_month_settled,
            current_month_chargebacks_mc=feed.mc_chargebacks,
        )
        return schemas.VampStatus(
            month=feed.month,
            tc05_settled_cnp=vamp.tc05_settled_cnp,
            tc40_fraud_count=vamp.tc40_fraud_count,
            tc15_dispute_count=vamp.tc15_dispute_count,
            ce3_remedied_tc15=vamp.ce3_remedied_tc15,
            dual_counted_events=vamp.dual_counted_events,
            combined_events=vamp.combined_events,
            monthly_floor_events=vamp.monthly_floor_events,
            ratio_ppm=vamp.ratio_ppm,
            ratio_str=vamp.ratio_str,
            threshold_ppm=vamp.threshold_ppm,
            excessive_enforcement_active=vamp.excessive_enforcement_active,
            projected_vamp_fines_usd_cents=vamp.projected_vamp_fines_usd_cents,
            projected_vamp_fines_str=vamp.projected_vamp_fines_str,
            events_until_cliff=vamp.events_until_cliff,
            ecp_ratio_ppm=ecp.ratio_ppm,
            ecp_threshold_ppm=ecp.threshold_ppm,
            ecp_warning=ecp.warning,
            ecp_breached=ecp.breached,
            mc_chargebacks=ecp.current_month_chargebacks_mc,
            mc_prior_month_settled=ecp.prior_month_settled_mc,
        )

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
        """Rebuild CaseFacts from a stored snapshot, tolerating partial dicts.

        Older or partially written snapshots (for example one holding only the
        buyer claim text) must never surface as a 500 ValidationError.
        """
        payload = {
            key: value
            for key, value in (snapshot or {}).items()
            if key not in PRIVATE_SNAPSHOT_KEYS
        }
        fallback: dict[str, Any] = {
            "payer_id": case.paypal_payer_id,
            "chain_valid": False,
            "chain_head": "",
            "event_count": 0,
            "completeness": 0.0,
        }
        try:
            return schemas.CaseFacts.model_validate({**fallback, **payload})
        except ValidationError as exc:
            logger.warning(
                "facts_snapshot_invalid",
                extra=log_context(dispute_id=case.dispute_id, errors=exc.error_count()),
            )
            claim = payload.get("buyer_claim_text")
            if isinstance(claim, str) and claim:
                fallback["buyer_claim_text"] = claim[:4000]
            return schemas.CaseFacts.model_validate(fallback)

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
                "external_reason_code": dispute.external_reason_code,
                "payment_rail": dispute.payment_rail,
                "allowed_response_options": dict(dispute.allowed_response_options),
                "messages": [dict(message) for message in dispute.messages],
            },
        }
