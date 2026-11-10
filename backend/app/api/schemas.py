"""FROZEN API response contract.

The frontend is coded against these shapes. Money types are Decimal and are
serialised by Pydantic as strings (e.g. "99.00"); the TypeScript client coerces
them with Number(). Do not change field names without updating
frontend/lib/types.ts and its zod parsers.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal

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
class GatewayStatus(ApiModel):
    """Judge-facing gateway configuration completeness — never any secret."""

    mode: str
    readiness: Literal["ready", "degraded", "unconfigured"]
    sandbox: bool
    live: bool
    simulation: bool
    api_base: str
    credentials_configured: bool
    webhook_configured: bool
    blockers: list[str] = Field(default_factory=list)


class AiStatus(ApiModel):
    provider: str
    model: str
    enabled: bool
    configured: bool
    timeout_ms: int
    prompt_version: str


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
    gateway_status: GatewayStatus | None = None
    ai_status: AiStatus | None = None


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
    """Every number the UI needs to explain the fight/settle/offer decision.

    ``ratio_relation`` is the authoritative word ("below" / "at_or_above") — a
    renderer must never infer it from ``crosses_cliff``, because "no cliff" also
    describes a merchant who is *already above* the threshold.
    """

    amount_usd: Decimal
    high_volume: bool
    high_volume_fee_usd: Decimal
    standard_fee_usd: Decimal
    # The single fee PayPal charges in the active tier ($30 replaces $15).
    fee_tier_usd: Decimal = Decimal("15.00")
    accept_fee_usd: Decimal = Decimal("0.00")
    win_fee_usd: Decimal = Decimal("0.00")
    # The fee a lost fight pays (the tier the claim would land in).
    fight_fee_usd: Decimal = Decimal("15.00")
    fee_reimbursable_on_win: bool = True
    sla_response_days: int = 10
    penalty_ratio_usd: Decimal
    # Legacy display ratios (derived from the exact ppm fields below).
    ratio_before: float
    ratio_after: float
    # Exact ratios: integer parts-per-million plus a six-place string.
    ratio_before_ppm: int = 0
    ratio_after_ppm: int = 0
    ratio_threshold_ppm: int = 15000
    ratio_before_str: str = "0.000000"
    ratio_after_str: str = "0.000000"
    net_sales_minor_3m: int = 0
    disputed_amount_minor_3m: int = 0
    payment_rail: Literal["PAYPAL_WALLET", "UNBRANDED_CARD"] = "PAYPAL_WALLET"
    hvd_countable: bool = True
    source_plane: Literal["LIVE_PAYPAL_SANDBOX", "SIMULATED_CARD_NETWORK_FEED"] = (
        "LIVE_PAYPAL_SANDBOX"
    )
    # Threshold metadata: the policy line, plus a machine-checkable verdict.
    ratio_threshold: float
    ratio_relation: Literal["below", "at_or_above"]
    threshold_crossed_now: bool
    high_volume_min_sales: int
    sales_3mo: int
    disputes_3mo: int
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
    buyer_claim_text: str | None = Field(default=None, max_length=4000)
    response_due_date: datetime | None = None
    ce3_matches: list[dict[str, Any]] = Field(default_factory=list)
    ce3_window_days: int = 0
    # Strict Visa CE 3.0 3-way proof (UNBRANDED_CARD + reason 10.4 only).
    ce3_proof: dict[str, Any] | None = None
    payment_rail: str = "PAYPAL_WALLET"
    external_reason_code: str | None = None
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
    run_id: str | None = None
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
    payment_rail: Literal["PAYPAL_WALLET", "UNBRANDED_CARD"] = "PAYPAL_WALLET"
    external_reason_code: str | None = None
    amount_minor: int = 0
    source_plane: Literal[
        "LIVE_PAYPAL_SANDBOX", "SIMULATED_CARD_NETWORK_FEED", "INTERNAL_TEST_EVENT"
    ] = "LIVE_PAYPAL_SANDBOX"
    source_badge: str = "[LIVE PAYPAL SANDBOX]"
    sla_response_days: int = 10


class DecisionOption(ApiModel):
    """One row of the Fight / Settle / Make-offer comparison."""

    action: RecommendedAction
    label: str
    value_usd: Decimal
    detail: str
    is_policy_choice: bool
    is_best_financial: bool
    paypal_action_available: bool
    paypal_action_reason: str | None = None


class DecisionComparison(ApiModel):
    """Policy recommendation vs lowest modelled loss — two distinct concepts.

    ``agree`` is false when the policy the rules select is not the cheapest
    modelled outcome; the UI must then explain both rather than implying that
    the recommended action is the financially optimal one.
    """

    policy_action: RecommendedAction
    policy_label: str
    policy_reason: str
    best_financial_action: RecommendedAction
    best_financial_label: str
    agree: bool
    divergence_explanation: str | None = None
    options: list[DecisionOption] = Field(default_factory=list)


class DisputeDetail(DisputeSummary):
    breakdown: EvBreakdown
    win_probability: WinProbability
    allowed_actions: list[AllowedAction]
    rationale: list[RationaleItem]
    facts: CaseFacts
    actions: list[ActionRecord]
    decision_comparison: DecisionComparison | None = None


class ActionRequest(ApiModel):
    note: str | None = Field(default=None, max_length=2000)
    offer_ratio: Decimal | None = Field(default=None, gt=0, le=1)
    idempotency_key: str | None = Field(default=None, max_length=128)
    offer_type: (
        Literal[
            "REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT", "REPLACEMENT_WITHOUT_REFUND"
        ]
        | None
    ) = None
    accept_claim_type: (
        Literal[
            "REFUND", "REFUND_WITH_RETURN", "PARTIAL_REFUND", "REFUND_WITH_RETURN_SHIPMENT_LABEL"
        ]
        | None
    ) = None
    # Sentinel ApprovalToken (JSON) authorising this exact mutation.
    approval_token: dict[str, Any] | None = None


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
    # A judge run gets its own run_id so old cases never bleed into a new demo.
    run_id: str | None = Field(default=None, max_length=64)


class CheckoutResponse(ApiModel):
    """A created order. NOT a payment — status must be read literally."""

    order_id: str
    run_id: str | None = None
    subscription_id: str | None
    payer_id: str
    status: str
    amount_usd: Decimal
    currency: str
    approval_url: str
    created_at: datetime
    gateway_mode: str
    sandbox: bool
    lifecycle_stage: Literal["CREATED", "APPROVED", "CAPTURED", "FAILED"] = "CREATED"
    # Honest provenance: "paypal_sandbox" means a real PayPal order exists.
    provenance: Literal["paypal_sandbox", "paypal_live"] = "paypal_sandbox"
    paypal_debug_id: str | None = None


class OrderStatusResponse(ApiModel):
    """Live order state straight from PayPal."""

    order_id: str
    run_id: str | None = None
    status: str
    lifecycle_stage: Literal["CREATED", "APPROVED", "CAPTURED", "FAILED"]
    amount_usd: Decimal
    currency: str
    payer_id: str | None = None
    approval_url: str | None = None
    capture_id: str | None = None
    capture_status: str | None = None
    captured_at: datetime | None = None
    gateway_mode: str
    provenance: Literal["paypal_sandbox", "paypal_live"]
    paypal_debug_id: str | None = None
    payer_action_required: bool = False
    detail: str | None = None


class CaptureRequest(ApiModel):
    run_id: str | None = Field(default=None, max_length=64)


class CaptureResponse(ApiModel):
    """Result of POST /orders/{id}/capture — the only path that yields money."""

    order_id: str
    run_id: str | None = None
    capture_id: str | None
    capture_status: str
    lifecycle_stage: Literal["CAPTURED", "FAILED"]
    amount_usd: Decimal
    currency: str
    payer_id: str | None = None
    captured_at: datetime | None = None
    transaction: TransactionOut | None = None
    gateway_mode: str
    provenance: Literal["paypal_sandbox", "paypal_live"]
    paypal_debug_id: str | None = None
    detail: str | None = None


class UsageRequest(ApiModel):
    payer_id: str
    order_id: str
    subscription_id: str | None = None
    run_id: str | None = Field(default=None, max_length=64)
    logins: int = Field(default=15, ge=0, le=1000)
    tokens: int = Field(default=42000, ge=0, le=10_000_000)
    export_name: str = "q3_financial_model.xlsx"
    client_ip: str | None = None
    device_fingerprint: str | None = None


class UsageResponse(ApiModel):
    chain: ChainVerification
    events: list[TelemetryEventOut]
    totals: dict[str, int]
    run_id: str | None = None


class DisputeSimulationRequest(ApiModel):
    payer_id: str | None = None
    order_id: str | None = None
    run_id: str | None = Field(default=None, max_length=64)
    reason_code: DisputeReason = DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED
    stage: DisputeStage = DisputeStage.INQUIRY
    channel: DisputeChannel = DisputeChannel.INTERNAL
    amount_usd: Decimal | None = None
    claim_text: str | None = Field(default=None, max_length=4000)
    # UNBRANDED_CARD cases are labelled [VISA-TC40 / ACQUIRER-FEED SIMULATION].
    payment_rail: Literal["PAYPAL_WALLET", "UNBRANDED_CARD"] = "PAYPAL_WALLET"
    external_reason_code: str | None = Field(
        default=None, max_length=16, pattern=r"^[A-Za-z0-9.]{1,16}$"
    )


class DisputeSimulationResponse(ApiModel):
    dispute: DisputeSummary
    webhook_event_id: str
    triage_triggered: bool
    containment: dict[str, Any] = Field(default_factory=dict)
    # "paypal_sandbox": PayPal's Disputes API created it. "internal_test_event":
    # the demo built it locally because the sandbox app cannot create disputes.
    origin: Literal["paypal_sandbox", "internal_test_event"] = "paypal_sandbox"


# --------------------------------------------------------------------------- demo runs
class DemoRun(ApiModel):
    """One isolated judge run: its own order, telemetry, dispute and analysis."""

    run_id: str
    created_at: datetime
    updated_at: datetime
    status: Literal["OPEN", "COMPLETED", "ABANDONED"]
    gateway_mode: str
    provenance: Literal["paypal_sandbox", "paypal_live"]
    payer_id: str | None = None
    order_id: str | None = None
    capture_id: str | None = None
    order_stage: Literal["CREATED", "APPROVED", "CAPTURED", "FAILED"] | None = None
    amount_usd: Decimal | None = None
    currency: str | None = None
    chain_head: str | None = None
    chain_valid: bool | None = None
    event_count: int = 0
    dispute_id: str | None = None
    ai_analyzed: bool = False
    dossier_available: bool = False
    steps: dict[str, str] = Field(default_factory=dict)


class DemoRunList(ApiModel):
    runs: list[DemoRun] = Field(default_factory=list)
    total: int


class DemoResetResponse(ApiModel):
    run_id: str
    cleared_runs: int
    cleared_cases: int
    merchant_records_preserved: int
    detail: str


# --------------------------------------------------------------------------- reporting
class HighVolumeStatus(ApiModel):
    flag: bool
    ratio: float
    threshold: float
    sales_3mo: int
    disputes_3mo: int
    ratio_ppm: int = 0
    threshold_ppm: int = 15000
    ratio_str: str = "0.000000"
    net_sales_minor_3m: int = 0
    disputed_amount_minor_3m: int = 0
    amount_until_cliff_minor: int = 0
    active_fee_tier_usd_cents: int = 1500
    fee_reimbursable_on_win: bool = True
    sla_response_days: int = 10
    window_start: datetime | None = None
    window_end: datetime | None = None
    source_plane: Literal["LIVE_PAYPAL_SANDBOX"] = "LIVE_PAYPAL_SANDBOX"


class VampStatus(ApiModel):
    """Visa VAMP + Mastercard ECP state from the *simulated* acquirer feed."""

    month: str | None
    tc05_settled_cnp: int
    tc40_fraud_count: int
    tc15_dispute_count: int
    ce3_remedied_tc15: int
    dual_counted_events: int
    combined_events: int
    monthly_floor_events: int
    ratio_ppm: int
    ratio_str: str
    threshold_ppm: int
    excessive_enforcement_active: bool
    projected_vamp_fines_usd_cents: int
    projected_vamp_fines_str: str
    events_until_cliff: int
    ecp_ratio_ppm: int
    ecp_threshold_ppm: int
    ecp_warning: bool
    ecp_breached: bool
    mc_chargebacks: int
    mc_prior_month_settled: int
    source_plane: Literal["SIMULATED_CARD_NETWORK_FEED"] = "SIMULATED_CARD_NETWORK_FEED"
    badge: str = "[VISA-TC40 / ACQUIRER-FEED SIMULATION]"


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
    vamp: VampStatus | None = None
    rules_manifest_sha256: str | None = None
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


# --------------------------------------------------------------------------- dossier integrity
class DossierManifest(ApiModel):
    """Everything a judge needs to verify a downloaded dossier independently."""

    dispute_id: str
    run_id: str | None = None
    filename: str
    sha256: str
    size_bytes: int
    generated_at: datetime
    chain_head: str | None = None
    chain_valid: bool | None = None
    event_count: int = 0
    narrative_source: str = "template"
    snapshot_hash: str | None = None
    download_url: str


class DossierVerification(ApiModel):
    """Result of re-rendering the dossier from its frozen snapshot and diffing."""

    dispute_id: str
    verified: bool
    expected_sha256: str | None = None
    actual_sha256: str | None = None
    verified_at: datetime
    detail: str
    checks: dict[str, bool] = Field(default_factory=dict)
