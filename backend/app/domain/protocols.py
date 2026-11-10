"""Ports for every external dependency.

Nothing in the domain imports httpx, SQLAlchemy or an LLM SDK directly. The demo
uses LiveGateway with zero domain changes.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from typing import Any, Protocol, runtime_checkable

from app.domain.enums import DisputeChannel, DisputeStage, DisputeStatus


@dataclass(frozen=True, slots=True)
class PayPalDisputeRecord:
    dispute_id: str
    reason_code: str
    stage: DisputeStage
    channel: DisputeChannel
    status: DisputeStatus
    amount: Decimal
    currency: str
    payer_id: str
    order_id: str
    subscription_id: str | None
    seller_response_due_date: datetime | None
    links: Mapping[str, str]
    created_at: datetime
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)
    external_reason_code: str | None = None
    allowed_response_options: Mapping[str, Any] = field(default_factory=dict, repr=False)
    messages: tuple[Mapping[str, Any], ...] = ()
    payment_rail: str = "PAYPAL_WALLET"


@dataclass(frozen=True, slots=True)
class PayPalTransactionRecord:
    transaction_id: str
    payer_id: str
    amount: Decimal
    currency: str
    status: str
    client_ip: str
    device_fingerprint: str
    created_at: datetime
    # CE 3.0 anchors. PayPal Reporting v1 carries none of these; they are
    # correlated from the local telemetry/order ledger by transaction id.
    payment_rail: str = "PAYPAL_WALLET"
    payment_credential_hash: str = ""
    account_login_id_hash: str = ""
    shipping_address_hash: str = ""
    has_prior_dispute: bool = False
    has_tc40: bool = False
    source: str = "paypal_reporting"


@dataclass(frozen=True, slots=True)
class EvidenceDocument:
    name: str
    content: bytes
    content_type: str = "application/pdf"


@dataclass(frozen=True, slots=True)
class EvidenceSubmission:
    dispute_id: str
    evidence_type: str
    notes: str
    documents: Sequence[EvidenceDocument]
    idempotency_key: str


@dataclass(frozen=True, slots=True)
class GatewayResponse:
    status_code: int
    body: Mapping[str, Any]
    latency_ms: int
    request_id: str | None = None


@dataclass(frozen=True, slots=True)
class WebhookEvent:
    event_id: str
    event_type: str
    resource_type: str
    summary: str
    dispute: PayPalDisputeRecord | None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class WebhookVerification:
    verified: bool
    event: WebhookEvent | None = None
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class SandboxOrder:
    """A created PayPal order — explicitly NOT a captured payment."""

    order_id: str
    subscription_id: str | None
    payer_id: str
    amount: Decimal
    currency: str
    status: str
    approval_url: str
    created_at: datetime
    # "CREATED" until PayPal reports the buyer approved, then "APPROVED".
    lifecycle_stage: str = "CREATED"
    paypal_debug_id: str | None = None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)


@dataclass(frozen=True, slots=True)
class OrderCapture:
    """The outcome of capturing an approved order.

    ``capture_id`` and ``capture_status`` come from PayPal's capture resource;
    only ``status == "COMPLETED"`` means the money actually moved.
    """

    order_id: str
    capture_id: str | None
    capture_status: str
    amount: Decimal
    currency: str
    payer_id: str | None
    captured_at: datetime | None
    raw: Mapping[str, Any] = field(default_factory=dict, repr=False)
    paypal_debug_id: str | None = None

    @property
    def completed(self) -> bool:
        return (self.capture_status or "").upper() in {"COMPLETED", "CAPTURED"}


@runtime_checkable
class PayPalGateway(Protocol):
    """All PayPal API surface VerdictPay needs, in one testable seam."""

    mode: str

    async def get_dispute(self, dispute_id: str) -> PayPalDisputeRecord: ...

    async def list_disputes(self, *, page_size: int = 50) -> list[PayPalDisputeRecord]: ...

    async def send_message(self, dispute_id: str, message: str) -> GatewayResponse: ...

    async def make_offer(
        self,
        dispute_id: str,
        amount: Decimal,
        note: str,
        *,
        currency: str = "USD",
        offer_type: str = "REFUND",
    ) -> GatewayResponse: ...

    async def accept_claim(
        self, dispute_id: str, note: str, *, accept_claim_type: str = "REFUND"
    ) -> GatewayResponse: ...

    async def escalate(self, dispute_id: str, note: str) -> GatewayResponse: ...

    async def appeal(self, submission: EvidenceSubmission) -> GatewayResponse: ...

    async def adjudicate(self, dispute_id: str, outcome: str) -> GatewayResponse: ...

    async def add_trackers(self, trackers: Sequence[Mapping[str, str]]) -> GatewayResponse: ...

    async def provide_evidence(self, submission: EvidenceSubmission) -> GatewayResponse: ...

    async def require_evidence(
        self, dispute_id: str, *, action: str = "SELLER_EVIDENCE"
    ) -> GatewayResponse: ...

    async def suspend_subscription(self, subscription_id: str, reason: str) -> GatewayResponse: ...

    async def search_transactions(
        self, *, payer_id: str, start: datetime, end: datetime
    ) -> list[PayPalTransactionRecord]: ...

    async def verify_webhook(
        self, headers: Mapping[str, str], raw_body: bytes
    ) -> WebhookVerification: ...

    async def create_order(
        self,
        *,
        payer_id: str,
        amount: Decimal,
        currency: str = "USD",
        description: str = "VerdictPay demo plan",
        return_url: str | None = None,
        cancel_url: str | None = None,
    ) -> SandboxOrder: ...

    async def get_order(self, order_id: str) -> SandboxOrder: ...

    async def capture_order(self, order_id: str) -> OrderCapture: ...

    async def create_sandbox_dispute(
        self,
        *,
        payer_id: str,
        order_id: str,
        reason_code: str,
        amount: Decimal,
        currency: str = "USD",
        stage: DisputeStage = DisputeStage.INQUIRY,
        channel: DisputeChannel = DisputeChannel.INTERNAL,
    ) -> PayPalDisputeRecord: ...

    async def close(self) -> None: ...


@dataclass(frozen=True, slots=True)
class NarrativeRequest:
    reason_code: str
    stage: str
    amount_usd: Decimal
    payer_id: str
    merchant_name: str
    facts: Mapping[str, Any]
    max_chars: int = 1800


@runtime_checkable
class NarrativeProvider(Protocol):
    """Writes prose only. Facts are already locked; never returns new facts."""

    mode: str

    async def compose(self, request: NarrativeRequest) -> str: ...


@runtime_checkable
class SearchIndex(Protocol):
    """Optional sponsor adapter: mirrors documents for sub-second correlation."""

    enabled: bool

    async def index_telemetry(self, document: Mapping[str, Any]) -> None: ...

    async def index_transaction(self, document: Mapping[str, Any]) -> None: ...

    async def close(self) -> None: ...
