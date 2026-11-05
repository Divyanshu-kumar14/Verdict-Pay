"""FROZEN API response contract.

The frontend is coded against these shapes. Money types are Decimal and are
serialised by Pydantic as strings (e.g. "99.00"); the TypeScript client coerces
them with Number(). Do not change field names without updating
frontend/lib/types.ts and its zod parsers.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.domain.enums import (
    ActionStatus,
    DisputeAction,
    DisputeChannel,
    DisputeReason,
    DisputeStage,
    DisputeStatus,
    RecommendedAction,
    TelemetryEventType,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --------------------------------------------------------------------------- errors
class ErrorDetail(ApiModel):
    field: str | None = None
    message: str
    code: str | None = None


class ErrorBody(ApiModel):
    code: str
    message: str
    details: list[ErrorDetail] = Field(default_factory=list)
    request_id: str | None = None


class ErrorResponse(ApiModel):
    error: ErrorBody


# --------------------------------------------------------------------------- health
class HealthResponse(ApiModel):
    status: str
    mode: str
    version: str
    database: str
    gateway: str
    llm: str
    demo_mode: bool
    uptime_seconds: float
    timestamp: datetime


# --------------------------------------------------------------------------- telemetry
class TelemetryEventIn(ApiModel):
    event_type: TelemetryEventType
    paypal_payer_id: str = Field(min_length=3, max_length=64)
    paypal_order_id: str | None = None
    paypal_subscription_id: str | None = None
    client_ip: str = Field(min_length=2, max_length=64)
    device_fingerprint: str = Field(min_length=2, max_length=128)
    resource_id: str | None = None
    resource_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    units_consumed: int = Field(default=0, ge=0)
    occurred_at: datetime | None = None
    tos_version: str | None = None
    tos_content_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")
    metadata: dict[str, Any] = Field(default_factory=dict)
    event_id: str | None = None


class TelemetryBatchIn(ApiModel):
    events: list[TelemetryEventIn] = Field(min_length=1, max_length=500)


class TelemetryEventOut(ApiModel):
    id: str
    event_id: str | None = None
    event_type: TelemetryEventType
    paypal_payer_id: str
    sequence: int
    client_ip: str
    device_fingerprint: str
    resource_id: str | None
    resource_sha256: str | None
    units_consumed: int
    prev_hash: str
    chain_hash: str
    created_at: datetime


class TelemetryIngestResponse(ApiModel):
    accepted: int
    duplicates: int
    events: list[TelemetryEventOut]
    chain: ChainVerification


class ChainBreak(ApiModel):
    sequence: int
    event_id: str
    expected_prev_hash: str
    actual_prev_hash: str
    stored_hash: str
    recomputed_hash: str


class ChainVerification(ApiModel):
    payer_id: str
    valid: bool
    event_count: int
    head_hash: str
    broken_at_sequence: int | None = None
    breaks: list[ChainBreak] = Field(default_factory=list)
    verified_at: datetime


class TimelineSummary(ApiModel):
    first_seen: datetime | None
    last_seen: datetime | None
    distinct_ips: int
    distinct_devices: int
    total_units: int
    assets_delivered: int
    login_count: int
    tos_versions: list[str]


class CustomerTimeline(ApiModel):
    payer_id: str
    events: list[TelemetryEventOut]
    summary: TimelineSummary
    chain: ChainVerification


# --------------------------------------------------------------------------- disputes
class EvBreakdown(ApiModel):
    amount_usd: Decimal
    high_volume: bool
    high_volume_fee_usd: Decimal
    standard_fee_usd: Decimal
    penalty_ratio_usd: Decimal
    ratio_before: float
    ratio_after: float
    crosses_cliff: bool
    p_win: float
    offer_ratio: float
    ev_fight_usd: Decimal
    ev_settle_usd: Decimal
    ev_offer_usd: Decimal
    best_action: RecommendedAction
    formula_notes: list[str] = Field(default_factory=list)


class SignalContribution(ApiModel):
    key: str
    label: str
    delta: float
    present: bool


class WinProbability(ApiModel):
    score: float
    base: float
    signal_sum: float
    reason_multiplier: float
    signals: list[SignalContribution]


class AllowedAction(ApiModel):
    action: DisputeAction
    allowed: bool
    reason: str | None = None
    fee_usd: Decimal
    paypal_link: str | None = None


class RationaleItem(ApiModel):
    key: str
    label: str
    detail: str


class CaseFacts(ApiModel):
    payer_id: str
    chain_valid: bool
    chain_head: str
    event_count: int
    completeness: float
    tos_version: str | None = None
    tos_hash: str | None = None
    tos_accepted_at: datetime | None = None
    first_seen: datetime | None = None
    last_seen: datetime | None = None
    ips: list[str] = Field(default_factory=list)
    devices: list[str] = Field(default_factory=list)
    deliveries: list[dict[str, Any]] = Field(default_factory=list)
    usage_units: int = 0
    usage_events: int = 0
    login_count: int = 0
    response_due_date: datetime | None = None
    ce3_matches: list[dict[str, Any]] = Field(default_factory=list)
    ce3_window_days: int = 0
    signals: dict[str, bool] = Field(default_factory=dict)


class ActionRecord(ApiModel):
    action_id: str
    action: DisputeAction
    status: ActionStatus
    latency_ms: int
    created_at: datetime
    error: str | None = None


class DisputeSummary(ApiModel):
    dispute_id: str
    payer_id: str
    order_id: str
    subscription_id: str | None
    reason_code: DisputeReason
    stage: DisputeStage
    channel: DisputeChannel
    status: DisputeStatus
    currency: str
    amount_usd: Decimal
    p_win: float
    ev_fight_usd: Decimal
    ev_settle_usd: Decimal
    ev_offer_usd: Decimal
    telemetry_completeness: float
    recommended_action: RecommendedAction
    subscription_suspended: bool
    dossier_available: bool
    seller_response_due_date: datetime | None
    created_at: datetime
    updated_at: datetime


class DisputeDetail(DisputeSummary):
    breakdown: EvBreakdown
    win_probability: WinProbability
    allowed_actions: list[AllowedAction]
    rationale: list[RationaleItem]
    facts: CaseFacts
    actions: list[ActionRecord]


class ActionRequest(ApiModel):
    note: str | None = Field(default=None, max_length=2000)
    offer_ratio: Decimal | None = Field(default=None, gt=0, le=1)
    idempotency_key: str | None = Field(default=None, max_length=128)


class ActionResponse(ApiModel):
    action_id: str
    dispute_id: str
    action: DisputeAction
    status: ActionStatus
    latency_ms: int
    upstream: dict[str, Any] = Field(default_factory=dict)
    case: DisputeSummary


class TriageResponse(ApiModel):
    dispute_id: str
    recommended_action: RecommendedAction
    breakdown: EvBreakdown
    win_probability: WinProbability
    allowed_actions: list[AllowedAction]
    rationale: list[RationaleItem]


# --------------------------------------------------------------------------- sandbox
class CheckoutRequest(ApiModel):
    plan: str = Field(default="pro", pattern=r"^(pro|scale)$")
    payer_id: str | None = None
    email: str | None = None
    tos_version: str = "v2.4-2026-01"


class CheckoutResponse(ApiModel):
    order_id: str
    subscription_id: str | None
    payer_id: str
    status: str
    amount_usd: Decimal
    currency: str
    approval_url: str
    created_at: datetime


class UsageRequest(ApiModel):
    payer_id: str
    order_id: str
    subscription_id: str | None = None
    logins: int = Field(default=15, ge=0, le=1000)
    tokens: int = Field(default=42000, ge=0, le=10_000_000)
    export_name: str = "q3_financial_model.xlsx"
    client_ip: str | None = None
    device_fingerprint: str | None = None


class UsageResponse(ApiModel):
    chain: ChainVerification
    events: list[TelemetryEventOut]
    totals: dict[str, int]


class DisputeSimulationRequest(ApiModel):
    payer_id: str | None = None
    order_id: str | None = None
    reason_code: DisputeReason = DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED
    stage: DisputeStage = DisputeStage.INQUIRY
    channel: DisputeChannel = DisputeChannel.INTERNAL
    amount_usd: Decimal | None = None


class DisputeSimulationResponse(ApiModel):
    dispute: DisputeSummary
    webhook_event_id: str
    triage_triggered: bool
    containment: dict[str, Any] = Field(default_factory=dict)


# --------------------------------------------------------------------------- reporting
class HighVolumeStatus(ApiModel):
    flag: bool
    ratio: float
    threshold: float
    sales_3mo: int
    disputes_3mo: int


class ReportingSummary(ApiModel):
    total_cases: int
    open_cases: int
    in_inquiry: int
    in_claim: int
    total_exposure_usd: Decimal
    protected_usd: Decimal
    fees_avoided_usd: Decimal
    avg_p_win: float
    win_rate_estimate: float
    subscription_suspensions: int
    chain_verified_customers: int
    high_volume: HighVolumeStatus
    generated_at: datetime


class TransactionOut(ApiModel):
    transaction_id: str
    payer_id: str
    order_id: str | None
    amount_usd: Decimal
    currency: str
    status: str
    client_ip: str
    device_fingerprint: str
    source: str
    created_at: datetime


# --------------------------------------------------------------------------- pagination
class PageMeta(ApiModel):
    total: int
    page: int
    per_page: int
    total_pages: int


class Page[T](ApiModel):
    data: list[T]
    meta: PageMeta


class DisputePage(Page[DisputeSummary]):
    pass
