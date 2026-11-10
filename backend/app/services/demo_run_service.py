"""Isolated judge demo runs: one run_id owns one order, its telemetry and its case.

A judge run is the unit of reproducibility. Every artifact the sandbox creates
carries the run's ``run_id``, so a fresh run can never surface a previous run's
dispute, order or AI analysis. ``run_*`` ids are the demo marker: reset deletes
only rows that carry one, never a row that does not.

Reset scope (POST /sandbox/runs/reset)
--------------------------------------
Deleted, in dependency order: ``dispute_actions`` (FK children of a demo case),
``dispute_cases``, ``webhook_events`` (the deterministic ``WH-<dispute_id>``
counterparts of those cases), ``paypal_transactions`` and ``paypal_orders`` whose
``run_id`` starts with ``run_``, then every ``demo_runs`` row.

Preserved, by construction:

* the ``merchants`` row (the merchant is the tenant, not demo data);
* every ``telemetry_ledger`` row — the ledger is append-only via ORM events, so a
  reset never attempts to delete chain history. Events keep their ``run_id`` in
  the payload, which is what scopes per-run counts instead of deletion;
* every order/transaction/case without a ``run_*`` run id. In particular seeded
  sales and seeded disputes share the demo payer id and are deliberately *not*
  used as a delete key: payer id is a demo default, not a run marker, and
  deleting by it would destroy judge-visible history that was never part of a
  run.
"""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import schemas
from app.config import Settings
from app.db.base import new_id
from app.db.models import (
    DemoRunRecord,
    DisputeActionRecord,
    DisputeCase,
    PaypalOrder,
    PaypalTransaction,
    TelemetryLedger,
    WebhookEventRecord,
)
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.service import TelemetryService
from app.errors import NotFoundError, ValidationFailedError
from app.services.dispute_service import quantize_money, utc_aware

DEMO_RUN_PREFIX = "run_"
"""Ids with this prefix are demo-scoped; reset deletes nothing else."""

# The seven observable steps of the judge workflow, in lifecycle order.
STEP_CHECKOUT = "checkout"
STEP_APPROVAL = "approval"
STEP_CAPTURE = "capture"
STEP_TELEMETRY = "telemetry"
REQUIRED_TELEMETRY_TYPES = frozenset(
    {"TOS_ACCEPTED", "SESSION_AUTH", "USAGE_METERED", "ASSET_DELIVERED"}
)
STEP_EVIDENCE = "evidence"
STEP_DISPUTE = "dispute"
STEP_TRIAGE = "triage"
STEP_AI = "ai"
STEP_DOSSIER = "dossier"

STEP_KEYS: tuple[str, ...] = (
    STEP_CHECKOUT,
    STEP_APPROVAL,
    STEP_CAPTURE,
    STEP_TELEMETRY,
    STEP_EVIDENCE,
    STEP_DISPUTE,
    STEP_TRIAGE,
    STEP_AI,
    STEP_DOSSIER,
)

STEP_PENDING = "pending"
STEP_DONE = "done"
STEP_FAILED = "failed"

_ORDER_STAGES = frozenset({"CREATED", "APPROVED", "CAPTURED", "FAILED"})
_PROVENANCE = frozenset({"paypal_sandbox", "paypal_live"})
_WEBHOOK_ID_TEMPLATE = "WH-{dispute_id}"
_RUN_ID_MIN_LENGTH = len(DEMO_RUN_PREFIX) + 1
_RUN_ID_MAX_LENGTH = 64


def new_run_id() -> str:
    """A fresh, unguessable demo run id."""
    return new_id(DEMO_RUN_PREFIX)


def is_demo_run_id(value: str | None) -> bool:
    """True when ``value`` is a demo-scoped run id."""
    return bool(value) and value.startswith(DEMO_RUN_PREFIX)


def empty_steps() -> dict[str, str]:
    """Every step starts pending so the UI can render progress honestly."""
    return dict.fromkeys(STEP_KEYS, STEP_PENDING)


def validated_run_id(value: str | None) -> str | None:
    """Accept only run ids this service could have issued.

    Reset deletes by ``run_`` prefix, so an arbitrary caller-chosen id would
    escape cleanup. Rejecting it keeps the isolation guarantee total.
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if not is_demo_run_id(cleaned) or not (
        _RUN_ID_MIN_LENGTH <= len(cleaned) <= _RUN_ID_MAX_LENGTH
    ):
        raise ValidationFailedError(
            f"run_id must start with {DEMO_RUN_PREFIX!r} and be "
            f"{_RUN_ID_MIN_LENGTH}-{_RUN_ID_MAX_LENGTH} characters.",
            details=[
                {
                    "field": "run_id",
                    "message": "Invalid demo run id.",
                    "code": "invalid_run_id",
                }
            ],
        )
    return cleaned


def _order_stage(value: str | None) -> str | None:
    """Normalise a stored stage onto the frozen four-value contract."""
    if value is None:
        return None
    token = value.strip().upper()
    return token if token in _ORDER_STAGES else None


def _provenance(value: str | None, fallback: str) -> str:
    token = (value or "").strip()
    return token if token in _PROVENANCE else fallback


def _event_run_id(row: TelemetryLedger) -> str | None:
    """The run tag stored inside a ledger row's payload (ledger stays append-only)."""
    payload = row.payload or {}
    metadata = payload.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("run_id"), str):
        return metadata["run_id"]
    direct = payload.get("run_id")
    return direct if isinstance(direct, str) else None


def _event_dispute_id(row: TelemetryLedger) -> str | None:
    payload = row.payload or {}
    metadata = payload.get("metadata")
    if isinstance(metadata, dict) and isinstance(metadata.get("dispute_id"), str):
        return metadata["dispute_id"]
    return None


class DemoRunService:
    """Read/write the isolated demo-run ledger for one merchant."""

    def __init__(self, session: AsyncSession, *, settings: Settings, merchant_id: str) -> None:
        self.session = session
        self.settings = settings
        self.merchant_id = merchant_id

    # ------------------------------------------------------------------ writes
    async def ensure_run(self, run_id: str | None = None) -> DemoRunRecord:
        """Return the named run, or create a brand-new one when no id is given.

        A supplied id reuses its record (so a retry of checkout inside one run
        never forks the run), while a missing id mints a fresh ``run_`` id — the
        judge's "New run" path.
        """
        cleaned = validated_run_id(run_id)
        if cleaned is not None:
            existing = await self.session.get(DemoRunRecord, cleaned)
            if existing is not None:
                if existing.merchant_id != self.merchant_id:
                    # Run ids are globally unique; adopting another tenant's run
                    # would hand them our orders, so refuse instead of forking.
                    raise ValidationFailedError(
                        f"run_id {cleaned!r} is already in use.",
                        details=[
                            {
                                "field": "run_id",
                                "message": "That demo run id belongs to another merchant.",
                                "code": "run_id_taken",
                            }
                        ],
                    )
                return existing
            record = DemoRunRecord(
                run_id=cleaned,
                merchant_id=self.merchant_id,
                status="OPEN",
                gateway_mode=self.settings.gateway_mode.value,
                provenance=self.settings.provenance,
                steps=empty_steps(),
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
            self.session.add(record)
            await self.session.commit()
            return record

        now = datetime.now(UTC)
        record = DemoRunRecord(
            run_id=new_run_id(),
            merchant_id=self.merchant_id,
            status="OPEN",
            gateway_mode=self.settings.gateway_mode.value,
            provenance=self.settings.provenance,
            steps=empty_steps(),
            created_at=now,
            updated_at=now,
        )
        self.session.add(record)
        await self.session.commit()
        return record

    async def touch(
        self,
        record: DemoRunRecord,
        *,
        step: str | None = None,
        step_state: str = STEP_DONE,
        steps: dict[str, str] | None = None,
        payer_id: str | None = None,
        order_id: str | None = None,
        capture_id: str | None = None,
        order_stage: str | None = None,
        amount: Decimal | None = None,
        currency: str | None = None,
        status: str | None = None,
        telemetry_token: str | None = None,
    ) -> DemoRunRecord:
        """Merge progress onto a run and commit.

        ``steps`` is always reassigned (never mutated in place): the column is
        plain JSON, so SQLAlchemy only sees a new object as a change.
        """
        merged_steps = {**empty_steps(), **(record.steps or {})}
        if steps:
            merged_steps.update(steps)
        if step:
            merged_steps[step] = step_state
        record.steps = merged_steps
        if payer_id is not None:
            record.payer_id = payer_id
        if order_id is not None:
            record.order_id = order_id
        if capture_id is not None:
            record.capture_id = capture_id
        if order_stage is not None:
            record.order_stage = _order_stage(order_stage)
        if amount is not None:
            record.amount_usd = quantize_money(amount)
        if currency is not None:
            record.currency = currency
        if telemetry_token is not None:
            record.telemetry_token = telemetry_token

        resolved_stage = _order_stage(record.order_stage)
        if status is not None:
            record.status = status
        elif resolved_stage == "CAPTURED":
            record.status = "COMPLETED"
        elif resolved_stage == "FAILED":
            record.status = "ABANDONED"

        record.updated_at = datetime.now(UTC)
        await self.session.commit()
        return record

    async def record_order(
        self,
        record: DemoRunRecord,
        *,
        order_id: str,
        payer_id: str,
        amount: Decimal,
        currency: str,
        order_stage: str,
        step: str = STEP_CHECKOUT,
        caption_id: str | None = None,
    ) -> DemoRunRecord:
        """Convenience wrapper for the checkout/approve/capture transitions."""
        return await self.touch(
            record,
            step=step,
            payer_id=payer_id,
            order_id=order_id,
            capture_id=caption_id,
            order_stage=order_stage,
            amount=amount,
            currency=currency,
        )

    # ------------------------------------------------------------------- reads
    async def get_run(self, run_id: str) -> DemoRunRecord:
        record = await self.session.get(DemoRunRecord, run_id)
        if record is None or record.merchant_id != self.merchant_id:
            raise NotFoundError(f"Demo run {run_id} was not found.")
        return record

    async def list_runs(self, *, limit: int = 200) -> list[DemoRunRecord]:
        rows = (
            await self.session.scalars(
                select(DemoRunRecord)
                .where(DemoRunRecord.merchant_id == self.merchant_id)
                .order_by(DemoRunRecord.created_at.desc(), DemoRunRecord.run_id.desc())
                .limit(limit)
            )
        ).all()
        return list(rows)

    async def get_order_row(self, order_id: str) -> PaypalOrder | None:
        return await self.session.scalar(
            select(PaypalOrder).where(
                PaypalOrder.merchant_id == self.merchant_id,
                PaypalOrder.order_id == order_id,
            )
        )

    async def run_case(self, run_id: str) -> DisputeCase | None:
        """The newest case that belongs to this run (isolation, not "latest global")."""
        return await self.session.scalar(
            select(DisputeCase)
            .where(
                DisputeCase.merchant_id == self.merchant_id,
                DisputeCase.run_id == run_id,
            )
            .order_by(DisputeCase.created_at.desc(), DisputeCase.dispute_id.desc())
        )

    # -------------------------------------------------------------- projections
    async def to_demo_run(self, record: DemoRunRecord) -> schemas.DemoRun:
        """Project one run plus its derived proof (chain, case, AI, dossier)."""
        chain_head: str | None = None
        chain_valid: bool | None = None
        event_count = 0
        tagged: list[TelemetryLedger] = []

        if record.payer_id:
            telemetry = TelemetryService(self.session, self.merchant_id)
            verification = await telemetry.verify(record.payer_id)
            if verification.event_count:
                chain_head = verification.head_hash
                chain_valid = verification.valid
            tagged = await self._events_for(record.payer_id, record.run_id)
            event_count = len(tagged)

        case = await self.run_case(record.run_id)
        dispute_id = case.dispute_id if case is not None else None
        ai_analyzed = await self._ai_analyzed(dispute_id, tagged)

        steps = {**empty_steps(), **(record.steps or {})}
        # Telemetry sent through the SDK route is tagged with metadata.run_id
        # instead of passing through /sandbox/usage, so derive the step from the
        # ledger: all four evidence events present means the step is done.
        tagged_types = {row.event_type for row in tagged}
        if tagged_types >= REQUIRED_TELEMETRY_TYPES:
            steps[STEP_TELEMETRY] = STEP_DONE
        if ai_analyzed:
            steps[STEP_AI] = STEP_DONE
        if case is not None and case.dossier_pdf_url:
            steps[STEP_DOSSIER] = STEP_DONE

        created_at = utc_aware(record.created_at) or datetime.now(UTC)
        return schemas.DemoRun(
            run_id=record.run_id,
            created_at=created_at,
            updated_at=utc_aware(record.updated_at) or created_at,
            status=record.status if record.status in {"OPEN", "COMPLETED", "ABANDONED"} else "OPEN",
            gateway_mode=record.gateway_mode,
            provenance=_provenance(record.provenance, self.settings.provenance),
            payer_id=record.payer_id,
            order_id=record.order_id,
            capture_id=record.capture_id,
            order_stage=_order_stage(record.order_stage),
            amount_usd=None if record.amount_usd is None else quantize_money(record.amount_usd),
            currency=record.currency,
            chain_head=chain_head,
            chain_valid=chain_valid,
            event_count=event_count,
            dispute_id=dispute_id,
            ai_analyzed=ai_analyzed,
            dossier_available=bool(case is not None and case.dossier_pdf_url),
            steps=steps,
        )

    async def list_demo_runs(self) -> schemas.DemoRunList:
        rows = await self.list_runs()
        return schemas.DemoRunList(
            runs=[await self.to_demo_run(row) for row in rows], total=len(rows)
        )

    async def _events_for(self, payer_id: str, run_id: str) -> list[TelemetryLedger]:
        rows = (
            await self.session.scalars(
                select(TelemetryLedger)
                .where(
                    TelemetryLedger.merchant_id == self.merchant_id,
                    TelemetryLedger.payer_id == payer_id,
                )
                .order_by(TelemetryLedger.sequence)
            )
        ).all()
        return [row for row in rows if _event_run_id(row) == run_id]

    async def _ai_analyzed(self, dispute_id: str | None, tagged: list[TelemetryLedger]) -> bool:
        """True only when a real AI provenance event exists for this run's case."""
        if dispute_id is None:
            return False
        for row in tagged:
            if row.event_type == TelemetryEventType.AI_GENERATION.value and (
                _event_dispute_id(row) == dispute_id
            ):
                return True
        rows = (
            await self.session.scalars(
                select(TelemetryLedger).where(
                    TelemetryLedger.merchant_id == self.merchant_id,
                    TelemetryLedger.event_type == TelemetryEventType.AI_GENERATION.value,
                )
            )
        ).all()
        return any(_event_dispute_id(row) == dispute_id for row in rows)

    # ------------------------------------------------------------------- reset
    async def reset(self) -> schemas.DemoResetResponse:
        """Delete demo-scoped records only; see the module docstring for the scope.

        The merchant row, the append-only telemetry ledger and every record
        without a ``run_`` run id survive. A fresh run id is returned so the
        caller can start the next demonstration immediately.
        """
        demo_dispute_ids = list(
            (
                await self.session.scalars(
                    select(DisputeCase.dispute_id).where(
                        DisputeCase.merchant_id == self.merchant_id,
                        DisputeCase.run_id.startswith(DEMO_RUN_PREFIX),
                    )
                )
            ).all()
        )
        webhook_ids = [
            _WEBHOOK_ID_TEMPLATE.format(dispute_id=dispute_id) for dispute_id in demo_dispute_ids
        ]

        # Children first: dispute_actions has a FK to dispute_cases.
        cleared_actions = 0
        if demo_dispute_ids:
            action_result = await self.session.execute(
                delete(DisputeActionRecord).where(
                    DisputeActionRecord.dispute_id.in_(demo_dispute_ids)
                )
            )
            # The real number of audit rows removed, not the number of cases.
            cleared_actions = int(action_result.rowcount or 0)
        if webhook_ids:
            webhook_result = await self.session.execute(
                delete(WebhookEventRecord).where(WebhookEventRecord.event_id.in_(webhook_ids))
            )
            cleared_webhooks = int(webhook_result.rowcount or 0)
        else:
            cleared_webhooks = 0

        case_result = await self.session.execute(
            delete(DisputeCase).where(
                DisputeCase.merchant_id == self.merchant_id,
                DisputeCase.run_id.startswith(DEMO_RUN_PREFIX),
            )
        )
        transaction_result = await self.session.execute(
            delete(PaypalTransaction).where(
                PaypalTransaction.merchant_id == self.merchant_id,
                PaypalTransaction.run_id.startswith(DEMO_RUN_PREFIX),
            )
        )
        order_result = await self.session.execute(
            delete(PaypalOrder).where(
                PaypalOrder.merchant_id == self.merchant_id,
                PaypalOrder.run_id.startswith(DEMO_RUN_PREFIX),
            )
        )
        run_result = await self.session.execute(
            delete(DemoRunRecord).where(
                DemoRunRecord.merchant_id == self.merchant_id,
                DemoRunRecord.run_id.startswith(DEMO_RUN_PREFIX),
            )
        )

        cleared_cases = int(case_result.rowcount or 0)
        cleared_transactions = int(transaction_result.rowcount or 0)
        cleared_orders = int(order_result.rowcount or 0)
        cleared_runs = int(run_result.rowcount or 0)
        await self.session.commit()

        preserved = 0
        for model in (PaypalOrder, PaypalTransaction, DisputeCase):
            # NULL run_id means "not created by a demo run", so it counts as kept;
            # a bare NOT LIKE would drop those rows because NULL is never TRUE.
            preserved += int(
                (
                    await self.session.scalar(
                        select(func.count())
                        .select_from(model)
                        .where(
                            model.merchant_id == self.merchant_id,
                            or_(
                                model.run_id.is_(None),
                                ~model.run_id.startswith(DEMO_RUN_PREFIX),
                            ),
                        )
                    )
                )
                or 0
            )

        fresh = await self.ensure_run()
        detail = (
            f"Cleared {cleared_runs} demo run(s): {cleared_cases} case(s), "
            f"{cleared_orders} order(s), {cleared_transactions} transaction(s), "
            f"{cleared_webhooks} webhook event(s), {cleared_actions} case action set(s). "
            f"Kept the merchant row, {preserved} non-demo record(s) and every "
            "telemetry-ledger row (append-only). Fresh run "
            f"{fresh.run_id} is ready."
        )
        return schemas.DemoResetResponse(
            run_id=fresh.run_id,
            cleared_runs=cleared_runs,
            cleared_cases=cleared_cases,
            merchant_records_preserved=preserved,
            detail=detail,
        )


__all__ = [
    "DEMO_RUN_PREFIX",
    "STEP_AI",
    "STEP_APPROVAL",
    "STEP_CAPTURE",
    "STEP_CHECKOUT",
    "STEP_DISPUTE",
    "STEP_DONE",
    "STEP_DOSSIER",
    "STEP_EVIDENCE",
    "STEP_FAILED",
    "STEP_KEYS",
    "STEP_PENDING",
    "STEP_TELEMETRY",
    "STEP_TRIAGE",
    "DemoRunService",
    "empty_steps",
    "is_demo_run_id",
    "new_run_id",
    "validated_run_id",
]
