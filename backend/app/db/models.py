"""Frozen database schema.

Design notes:
* Every table uses portable SQL types (no SQLite-only constructs).
* telemetry_ledger is append-only; the service layer refuses updates and deletes
  and there is a unique (merchant_id, payer_id, sequence) constraint that makes
  a forked chain impossible even under concurrency.
* Money is Numeric(12, 2); probabilities are Numeric(6, 4).
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    event,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, new_id, utcnow


class Merchant(Base):
    __tablename__ = "merchants"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("mch_"))
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    api_key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class TelemetryLedger(Base):
    __tablename__ = "telemetry_ledger"
    __table_args__ = (
        UniqueConstraint("merchant_id", "payer_id", "sequence", name="uq_telemetry_stream_seq"),
        UniqueConstraint("merchant_id", "event_id", name="uq_telemetry_event_id"),
        Index("ix_telemetry_payer_created", "merchant_id", "payer_id", "created_at"),
        Index("ix_telemetry_event_type", "event_type"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("tel_"))
    event_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    merchant_id: Mapped[str] = mapped_column(String(40), ForeignKey("merchants.id"), nullable=False)
    payer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_type: Mapped[str] = mapped_column(String(40), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    client_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    device_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    resource_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    resource_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    units_consumed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    prev_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    chain_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utcnow
    )


class PaypalTransaction(Base):
    """Historical transaction cache / simulator ledger used for Visa CE 3.0 lookbacks."""

    __tablename__ = "paypal_transactions"
    __table_args__ = (Index("ix_txn_payer_created", "merchant_id", "payer_id", "created_at"),)

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("txn_"))
    merchant_id: Mapped[str] = mapped_column(String(40), ForeignKey("merchants.id"), nullable=False)
    transaction_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    payer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    client_ip: Mapped[str] = mapped_column(String(64), nullable=False)
    device_fingerprint: Mapped[str] = mapped_column(String(128), nullable=False)
    source: Mapped[str] = mapped_column(String(32), nullable=False, default="local_simulator")
    capture_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class DisputeCase(Base):
    __tablename__ = "dispute_cases"
    __table_args__ = (
        Index("ix_dispute_merchant_stage", "merchant_id", "lifecycle_stage"),
        Index("ix_dispute_due", "seller_response_due_date"),
    )

    dispute_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(40), ForeignKey("merchants.id"), nullable=False)
    # Isolates one judge run from every other; NULL marks a non-demo record.
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    paypal_order_id: Mapped[str] = mapped_column(String(64), nullable=False)
    paypal_subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    paypal_payer_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    reason_code: Mapped[str] = mapped_column(String(64), nullable=False)
    lifecycle_stage: Mapped[str] = mapped_column(String(32), nullable=False)
    dispute_channel: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(48), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    p_win: Mapped[Decimal] = mapped_column(Numeric(6, 4), nullable=False, default=0)
    ev_fight_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    ev_settle_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    ev_offer_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    telemetry_completeness: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, default=0
    )
    recommended_action: Mapped[str] = mapped_column(String(32), nullable=False, default="MONITOR")
    action_rationale: Mapped[list[dict[str, Any]]] = mapped_column(
        JSON, nullable=False, default=list
    )
    facts_snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    subscription_suspended: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    dossier_pdf_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    seller_response_due_date: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    paypal_links: Mapped[dict[str, str]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


class DisputeActionRecord(Base):
    __tablename__ = "dispute_actions"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_dispute_action_idempotency"),
        Index("ix_action_dispute_created", "dispute_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("act_"))
    dispute_id: Mapped[str] = mapped_column(
        String(64), ForeignKey("dispute_cases.dispute_id"), nullable=False
    )
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True)
    request_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    response_payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class WebhookEventRecord(Base):
    __tablename__ = "webhook_events"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("whk_"))
    event_id: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    event_type: Mapped[str] = mapped_column(String(80), nullable=False)
    verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PaypalOrder(Base):
    """Server-side record of a PayPal order and its capture lifecycle.

    An order is not a payment. ``lifecycle_stage`` records the furthest stage
    actually confirmed by PayPal (CREATED -> APPROVED -> CAPTURED), so nothing in
    the product can mistake "order created" for "money received".
    """

    __tablename__ = "paypal_orders"
    __table_args__ = (
        Index("ix_order_run", "run_id"),
        Index("ix_order_payer", "merchant_id", "payer_id"),
    )

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default=lambda: new_id("ord_"))
    order_id: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    merchant_id: Mapped[str] = mapped_column(String(40), ForeignKey("merchants.id"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    payer_id: Mapped[str] = mapped_column(String(64), nullable=False)
    subscription_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    capture_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    amount_usd: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(8), nullable=False, default="USD")
    status: Mapped[str] = mapped_column(String(48), nullable=False, default="CREATED")
    lifecycle_stage: Mapped[str] = mapped_column(String(16), nullable=False, default="CREATED")
    capture_status: Mapped[str | None] = mapped_column(String(48), nullable=True)
    approval_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    gateway_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    provenance: Mapped[str] = mapped_column(String(32), nullable=False, default="local_simulator")
    paypal_debug_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    raw_response: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
    captured_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DemoRunRecord(Base):
    """One isolated judge run. Every artifact of the run hangs off this id."""

    __tablename__ = "demo_runs"

    run_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    merchant_id: Mapped[str] = mapped_column(String(40), ForeignKey("merchants.id"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="OPEN")
    gateway_mode: Mapped[str] = mapped_column(String(32), nullable=False)
    provenance: Mapped[str] = mapped_column(String(32), nullable=False, default="local_simulator")
    payer_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    capture_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order_stage: Mapped[str | None] = mapped_column(String(16), nullable=True)
    amount_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(8), nullable=True)
    telemetry_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
    steps: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )


# --------------------------------------------------------------------------- append-only guard
# The ledger is a system of record: once written a row must never change or vanish.
# A DB trigger would be vendor-specific, so the guard lives at the ORM boundary and the
# service layer adds the perimeter check covered by its unit tests.


@event.listens_for(TelemetryLedger, "before_update")
def _forbid_ledger_update(mapper: object, connection: object, target: TelemetryLedger) -> None:
    raise RuntimeError("telemetry_ledger is append-only: updates are forbidden")


@event.listens_for(TelemetryLedger, "before_delete")
def _forbid_ledger_delete(mapper: object, connection: object, target: TelemetryLedger) -> None:
    raise RuntimeError("telemetry_ledger is append-only: deletes are forbidden")
