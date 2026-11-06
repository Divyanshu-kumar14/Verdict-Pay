"""Deterministic, keyless PayPal simulator.

This is the gateway the judge demo runs on and the real code path exercised by
the end-to-end tests. It keeps an in-memory store guarded by an asyncio lock,
derives every id from a monotonic counter (or a stable hash), records every
mutating call in the public calls log and never touches the network.

Nothing here is random: two gateways given the same call sequence produce the
same ids, the same due dates (with an injected clock) and the same bodies.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from app.config import Settings
from app.domain.enums import DisputeChannel, DisputeStage, DisputeStatus
from app.domain.protocols import (
    EvidenceSubmission,
    GatewayResponse,
    OrderCapture,
    PayPalDisputeRecord,
    PayPalTransactionRecord,
    SandboxOrder,
    WebhookEvent,
    WebhookVerification,
)
from app.errors import UpstreamError
from app.integrations.paypal import wire
from app.security import verify_signature

EVIDENCE_MAX_BYTES = 10 * 1024 * 1024
NOTE_MAX_CHARS = 2000
SANDBOX_CHECKOUT_BASE = "https://sandbox.paypal.com/checkoutnow?token="
CLIENT_IP = "203.0.113.42"
DEVICE_FINGERPRINT = "fp_89a7c6d5e4f3"
DUE_DAYS = 10
MAX_PAGE_SIZE = 50
DISPUTE_ID_BASE = 40000
DISPUTE_ID_PREFIX = "PP-D-"

_HISTORY: tuple[tuple[int, Decimal], ...] = (
    (150, Decimal("99.00")),
    (240, Decimal("99.00")),
    (330, Decimal("49.00")),
)


def _digest(seed: str) -> str:
    return hashlib.sha256(seed.encode("utf-8")).hexdigest().upper()


def _order_id(payer_id: str, sequence: int) -> str:
    return f"5O1{_digest(f'{payer_id}:{sequence}')[:14]}"


def _subscription_id(payer_id: str, sequence: int) -> str:
    return f"I-BW{_digest(f'sub:{payer_id}:{sequence}')[:10]}"


def _capture_id(order_id: str) -> str:
    return f"CAP{_digest(f'cap:{order_id}')[:14].upper()}"


def _require_currency(raw: Any) -> str:
    code = raw.strip().upper() if isinstance(raw, str) else ""
    if len(code) != 3 or not code.isalpha():
        raise UpstreamError("invalid_currency")
    return code


def synthetic_transaction_id(payer_id: str, days: int) -> str:
    """Stable PayPal-style transaction id derived from sha256(payer_id + days)."""
    return f"TXN{_digest(f'{payer_id}{days}')[:16]}"


def synthetic_transactions(
    payer_id: str, *, now: datetime | None = None
) -> list[PayPalTransactionRecord]:
    """Deterministic Visa CE 3.0 history: three prior COMPLETED transactions.

    Rows sit at now-150d, now-240d and now-330d, share the same IP and device
    fingerprint, and use amounts 99/99/49 USD. The now argument is injectable so
    seeding and tests can pin the history exactly.
    """
    reference = wire.ensure_utc(now) if now is not None else datetime.now(UTC)
    return [
        PayPalTransactionRecord(
            transaction_id=synthetic_transaction_id(payer_id, days),
            payer_id=payer_id,
            amount=amount,
            currency="USD",
            status="COMPLETED",
            client_ip=CLIENT_IP,
            device_fingerprint=DEVICE_FINGERPRINT,
            created_at=reference - timedelta(days=days),
        )
        for days, amount in _HISTORY
    ]


@dataclass(slots=True)
class _StoredDispute:
    """Mutable internal state behind a frozen PayPalDisputeRecord snapshot."""

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
    links: dict[str, str]
    created_at: datetime

    def to_record(self) -> PayPalDisputeRecord:
        raw: dict[str, Any] = {
            "dispute_id": self.dispute_id,
            "reason": self.reason_code,
            "dispute_life_cycle_stage": self.stage.value,
            "dispute_channel": self.channel.value,
            "status": self.status.value,
            "dispute_amount": {
                "currency_code": self.currency,
                "value": f"{self.amount:.2f}",
            },
            "seller_transaction_id": self.order_id,
            "payer": {"payer_id": self.payer_id},
            "links": [{"rel": rel, "href": href} for rel, href in self.links.items()],
        }
        if self.subscription_id:
            raw["subscription_id"] = self.subscription_id
        return PayPalDisputeRecord(
            dispute_id=self.dispute_id,
            reason_code=self.reason_code,
            stage=self.stage,
            channel=self.channel,
            status=self.status,
            amount=self.amount,
            currency=self.currency,
            payer_id=self.payer_id,
            order_id=self.order_id,
            subscription_id=self.subscription_id,
            seller_response_due_date=self.seller_response_due_date,
            links=dict(self.links),
            created_at=self.created_at,
            raw=raw,
        )


class SimulatorGateway:
    """Keyless PayPal stand-in: deterministic ids, real state transitions."""

    mode = "LOCAL_SIMULATOR"

    def __init__(
        self, settings: Settings, *, clock: Callable[[], datetime] | None = None
    ) -> None:
        self._settings = settings
        self._clock = clock or (lambda: datetime.now(UTC))
        self._lock = asyncio.Lock()
        self._disputes: dict[str, _StoredDispute] = {}
        self._dispute_order: list[str] = []
        self._order_sequence = 0
        self._dispute_sequence = 0
        self._message_sequence = 0
        self._evidence_replays: dict[str, GatewayResponse] = {}
        self._subscriptions: dict[str, str] = {}
        self._order_subscriptions: dict[str, str] = {}
        # Full order lifecycle: CREATED -> APPROVED -> CAPTURED. An order exists
        # here as CREATED and is never implicitly paid.
        self._orders: dict[str, SandboxOrder] = {}
        self._captures: dict[str, OrderCapture] = {}
        self._suspended: dict[str, str] = {}
        self.calls: list[tuple[str, dict[str, Any]]] = []
        if settings.demo_subscription_id:
            self._subscriptions[settings.demo_subscription_id] = settings.demo_payer_id

    @property
    def suspended_subscriptions(self) -> Mapping[str, str]:
        """Snapshot of suspended subscription ids mapped to their reasons."""
        return dict(self._suspended)

    # ------------------------------------------------------------------ helpers
    def _now(self) -> datetime:
        return wire.ensure_utc(self._clock())

    def _record_call(self, name: str, payload: Mapping[str, Any]) -> None:
        self.calls.append((name, dict(payload)))

    def _require_dispute(self, dispute_id: str) -> _StoredDispute:
        state = self._disputes.get(dispute_id)
        if state is None:
            raise UpstreamError("dispute_not_found")
        return state

    def _links_for(self, stage: DisputeStage, dispute_id: str) -> dict[str, str]:
        base = self._settings.paypal_api_base.rstrip("/")
        self_url = f"{base}/v1/customer/disputes/{dispute_id}"
        links: dict[str, str] = {"self": self_url}
        if stage in (DisputeStage.RESOLVED, DisputeStage.CLOSED):
            return links
        if stage is not DisputeStage.PRE_ARBITRATION:
            links["send-message"] = f"{self_url}/send-message"
            links["make-offer"] = f"{self_url}/make-offer"
        links["accept-claim"] = f"{self_url}/accept-claim"
        if stage is not DisputeStage.INQUIRY:
            links["provide-evidence"] = f"{self_url}/provide-evidence"
        return links

    # ------------------------------------------------------------------ orders
    async def create_order(
        self,
        *,
        payer_id: str,
        amount: Decimal,
        currency: str = "USD",
        description: str = "VerdictPay demo plan",
        return_url: str | None = None,
        cancel_url: str | None = None,
    ) -> SandboxOrder:
        """Create a deterministic Orders v2 order plus its subscription id.

        The order starts in CREATED. Money only moves through capture_order(),
        mirroring PayPal's real intent=CAPTURE lifecycle.
        """
        if not isinstance(payer_id, str) or not payer_id.strip():
            raise UpstreamError("payer_id_required")
        order_amount = wire.parse_decimal(amount)
        if order_amount <= 0:
            raise UpstreamError("invalid_order_amount")
        code = _require_currency(currency)
        if not isinstance(description, str) or not description.strip():
            raise UpstreamError("description_required")

        async with self._lock:
            self._order_sequence += 1
            sequence = self._order_sequence
            order_id = _order_id(payer_id.strip(), sequence)
            subscription_id = _subscription_id(payer_id.strip(), sequence)
            created_at = self._now()
            self._subscriptions[subscription_id] = payer_id.strip()
            self._order_subscriptions[order_id] = subscription_id
            self._record_call(
                "create_order",
                {
                    "order_id": order_id,
                    "subscription_id": subscription_id,
                    "payer_id": payer_id.strip(),
                    "amount": f"{order_amount:.2f}",
                    "currency": code,
                },
            )
            order = SandboxOrder(
                order_id=order_id,
                subscription_id=subscription_id,
                payer_id=payer_id.strip(),
                amount=order_amount,
                currency=code,
                status="CREATED",
                approval_url=f"{SANDBOX_CHECKOUT_BASE}{order_id}",
                created_at=created_at,
                lifecycle_stage="CREATED",
            )
            self._orders[order_id] = order
            return order

    async def get_order(self, order_id: str) -> SandboxOrder:
        """Return the stored order, reflecting approver/capture progress."""
        if not isinstance(order_id, str) or not order_id.strip():
            raise UpstreamError("order_id_required")
        async with self._lock:
            order = self._orders.get(order_id.strip())
            if order is None:
                raise UpstreamError("order_not_found")
            return order

    async def approve_order(self, order_id: str) -> SandboxOrder:
        """Simulate the buyer approving in the PayPal UI (test affordance only)."""
        if not isinstance(order_id, str) or not order_id.strip():
            raise UpstreamError("order_id_required")
        async with self._lock:
            order = self._orders.get(order_id.strip())
            if order is None:
                raise UpstreamError("order_not_found")
            if order.lifecycle_stage == "CAPTURED":
                return order
            approved = replace(order, status="APPROVED", lifecycle_stage="APPROVED")
            self._orders[approved.order_id] = approved
            self._record_call("approve_order", {"order_id": approved.order_id})
            return approved

    async def capture_order(self, order_id: str) -> OrderCapture:
        """Capture an approved order; refuse an unapproved one, like PayPal does."""
        if not isinstance(order_id, str) or not order_id.strip():
            raise UpstreamError("order_id_required")
        async with self._lock:
            order = self._orders.get(order_id.strip())
            if order is None:
                raise UpstreamError("order_not_found")
            if order.lifecycle_stage != "APPROVED":
                # Mirrors PayPal's 422 ORDER_NOT_APPROVED for an unapproved order.
                raise UpstreamError("order_not_approved")
            captured_at = self._now()
            capture_id = _capture_id(order.order_id)
            capture = OrderCapture(
                order_id=order.order_id,
                capture_id=capture_id,
                capture_status="COMPLETED",
                amount=order.amount,
                currency=order.currency,
                payer_id=order.payer_id,
                captured_at=captured_at,
            )
            self._captures[order.order_id] = capture
            self._orders[order.order_id] = replace(
                order, status="COMPLETED", lifecycle_stage="CAPTURED"
            )
            self._record_call(
                "capture_order",
                {
                    "order_id": order.order_id,
                    "capture_id": capture_id,
                    "capture_status": "COMPLETED",
                    "amount": f"{order.amount:.2f}",
                },
            )
            return capture

    # ----------------------------------------------------------------- disputes
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
    ) -> PayPalDisputeRecord:
        """Open a sandbox dispute with the requested stage, channel and reason."""
        if not isinstance(payer_id, str) or not payer_id.strip():
            raise UpstreamError("payer_id_required")
        if not isinstance(order_id, str) or not order_id.strip():
            raise UpstreamError("order_id_required")
        dispute_amount = wire.parse_decimal(amount)
        if dispute_amount <= 0:
            raise UpstreamError("invalid_dispute_amount")
        code = _require_currency(currency)
        try:
            dispute_stage = DisputeStage(stage)
            dispute_channel = DisputeChannel(channel)
        except ValueError as exc:
            raise UpstreamError("invalid_dispute_state") from exc

        async with self._lock:
            self._dispute_sequence += 1
            dispute_id = (
                f"{DISPUTE_ID_PREFIX}{DISPUTE_ID_BASE + self._dispute_sequence:05d}"
            )
            created_at = self._now()
            subscription_id = self._order_subscriptions.get(order_id.strip())
            state = _StoredDispute(
                dispute_id=dispute_id,
                reason_code=wire.normalise_reason(reason_code),
                stage=dispute_stage,
                channel=dispute_channel,
                status=DisputeStatus.OPEN,
                amount=dispute_amount,
                currency=code,
                payer_id=payer_id.strip(),
                order_id=order_id.strip(),
                subscription_id=subscription_id,
                seller_response_due_date=created_at + timedelta(days=DUE_DAYS),
                links=self._links_for(dispute_stage, dispute_id),
                created_at=created_at,
            )
            self._disputes[dispute_id] = state
            self._dispute_order.append(dispute_id)
            self._record_call(
                "create_sandbox_dispute",
                {
                    "dispute_id": dispute_id,
                    "reason_code": state.reason_code,
                    "stage": state.stage.value,
                    "channel": state.channel.value,
                    "amount": f"{dispute_amount:.2f}",
                },
            )
            return state.to_record()

    def _advance_sequence(self, dispute_id: str) -> None:
        if not dispute_id.startswith(DISPUTE_ID_PREFIX):
            return
        suffix = dispute_id[len(DISPUTE_ID_PREFIX) :]
        if suffix.isdigit():
            self._dispute_sequence = max(
                self._dispute_sequence, int(suffix) - DISPUTE_ID_BASE
            )

    async def hydrate(self, records: Sequence[PayPalDisputeRecord]) -> None:
        """Merge persisted dispute snapshots so a restarted server can still act.

        Existing disputes are replaced by id, disputes created after hydration
        are never wiped, and the id counter advances past persisted ids so new
        disputes cannot collide. Hydration is not a merchant action, so the
        public calls log stays untouched.
        """
        async with self._lock:
            for record in records:
                dispute_id = record.dispute_id
                if not isinstance(dispute_id, str) or not dispute_id:
                    continue
                links = (
                    dict(record.links)
                    if record.links
                    else self._links_for(record.stage, dispute_id)
                )
                self._disputes[dispute_id] = _StoredDispute(
                    dispute_id=dispute_id,
                    reason_code=record.reason_code,
                    stage=record.stage,
                    channel=record.channel,
                    status=record.status,
                    amount=record.amount,
                    currency=record.currency,
                    payer_id=record.payer_id,
                    order_id=record.order_id,
                    subscription_id=record.subscription_id,
                    seller_response_due_date=record.seller_response_due_date,
                    links=links,
                    created_at=record.created_at,
                )
                if dispute_id not in self._dispute_order:
                    self._dispute_order.append(dispute_id)
                self._advance_sequence(dispute_id)
                if record.subscription_id:
                    self._subscriptions[record.subscription_id] = record.payer_id

    async def get_dispute(self, dispute_id: str) -> PayPalDisputeRecord:
        """Return the current snapshot of one dispute."""
        async with self._lock:
            return self._require_dispute(dispute_id).to_record()

    async def list_disputes(self, *, page_size: int = 50) -> list[PayPalDisputeRecord]:
        """Return disputes newest first, clamped to PayPal's 50-row page size."""
        if not isinstance(page_size, int) or isinstance(page_size, bool) or page_size < 1:
            raise UpstreamError("invalid_page_size")
        limit = min(page_size, MAX_PAGE_SIZE)
        async with self._lock:
            newest_first = [self._disputes[key] for key in reversed(self._dispute_order)]
            return [state.to_record() for state in newest_first[:limit]]

    async def send_message(self, dispute_id: str, message: str) -> GatewayResponse:
        """Send a seller message and park the dispute on the seller."""
        text = message.strip() if isinstance(message, str) else ""
        if not text:
            raise UpstreamError("message_required")
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("message_too_long")

        async with self._lock:
            state = self._require_dispute(dispute_id)
            self._message_sequence += 1
            message_id = f"MSG-{self._message_sequence:03d}"
            state.status = DisputeStatus.WAITING_FOR_SELLER_RESPONSE
            self._record_call(
                "send_message",
                {"dispute_id": dispute_id, "message": text, "message_id": message_id},
            )
            return GatewayResponse(
                status_code=200,
                body={
                    "dispute_id": dispute_id,
                    "message_id": message_id,
                    "message": text,
                    "status": state.status.value,
                },
                latency_ms=0,
            )

    async def make_offer(
        self, dispute_id: str, amount: Decimal, note: str, *, currency: str = "USD"
    ) -> GatewayResponse:
        """Make an offer, rejecting values outside (0, dispute amount]."""
        offer_amount = wire.parse_decimal(amount)
        if offer_amount <= 0:
            raise UpstreamError("invalid_offer_amount")
        text = note if isinstance(note, str) else ""
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("note_too_long")
        code = _require_currency(currency)

        async with self._lock:
            state = self._require_dispute(dispute_id)
            if offer_amount > state.amount:
                raise UpstreamError("invalid_offer_amount")
            state.status = DisputeStatus.WAITING_FOR_SELLER_RESPONSE
            self._record_call(
                "make_offer",
                {
                    "dispute_id": dispute_id,
                    "amount": f"{offer_amount:.2f}",
                    "currency": code,
                    "note": text,
                },
            )
            return GatewayResponse(
                status_code=200,
                body={
                    "dispute_id": dispute_id,
                    "offer_amount": wire.build_offer_amount(offer_amount, code),
                    "note": text,
                    "status": state.status.value,
                },
                latency_ms=0,
            )

    async def accept_claim(self, dispute_id: str, note: str) -> GatewayResponse:
        """Accept the claim: the dispute is resolved in the buyer's favour."""
        text = note if isinstance(note, str) else ""
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("note_too_long")

        async with self._lock:
            state = self._require_dispute(dispute_id)
            state.status = DisputeStatus.RESOLVED
            self._record_call("accept_claim", {"dispute_id": dispute_id, "note": text})
            return GatewayResponse(
                status_code=200,
                body={
                    "dispute_id": dispute_id,
                    "status": state.status.value,
                    "note": text,
                },
                latency_ms=0,
            )

    # ----------------------------------------------------------------- evidence
    async def provide_evidence(self, submission: EvidenceSubmission) -> GatewayResponse:
        """Upload evidence; replays of one idempotency key return the first body."""
        raw_key = submission.idempotency_key
        key = raw_key.strip() if isinstance(raw_key, str) else ""
        if not key:
            raise UpstreamError("idempotency_key_required")
        raw_type = submission.evidence_type
        evidence_type = raw_type.strip() if isinstance(raw_type, str) else ""
        if not evidence_type:
            raise UpstreamError("evidence_type_required")

        async with self._lock:
            original = self._evidence_replays.get(key)
            if original is not None:
                replay_body = dict(original.body)
                replay_body["note"] = "idempotent_replay"
                self._record_call(
                    "provide_evidence_replay",
                    {"dispute_id": submission.dispute_id, "idempotency_key": key},
                )
                return replace(original, body=replay_body)

            state = self._require_dispute(submission.dispute_id)
            documents = list(submission.documents)
            if not documents:
                raise UpstreamError("evidence_documents_required")
            names: list[str] = []
            total_bytes = 0
            for document in documents:
                name = document.name.strip() if isinstance(document.name, str) else ""
                if not name:
                    raise UpstreamError("evidence_document_name_required")
                if not document.content:
                    raise UpstreamError("evidence_document_empty")
                names.append(name)
                total_bytes += len(document.content)
            if total_bytes > EVIDENCE_MAX_BYTES:
                raise UpstreamError("evidence_too_large")
            notes = submission.notes if isinstance(submission.notes, str) else ""
            if len(notes) > NOTE_MAX_CHARS:
                raise UpstreamError("evidence_notes_too_long")

            state.status = DisputeStatus.UNDER_REVIEW
            response = GatewayResponse(
                status_code=200,
                body={
                    "dispute_id": state.dispute_id,
                    "evidence_type": evidence_type,
                    "documents": names,
                },
                latency_ms=0,
            )
            self._evidence_replays[key] = response
            self._record_call(
                "provide_evidence",
                {
                    "dispute_id": state.dispute_id,
                    "idempotency_key": key,
                    "evidence_type": evidence_type,
                    "documents": names,
                    "bytes": total_bytes,
                },
            )
            return response

    async def require_evidence(
        self, dispute_id: str, *, action: str = "SELLER_EVIDENCE"
    ) -> GatewayResponse:
        """Escalate to chargeback: PayPal now demands seller evidence."""
        if not isinstance(action, str) or not action.strip():
            raise UpstreamError("invalid_evidence_action")

        async with self._lock:
            state = self._require_dispute(dispute_id)
            state.stage = DisputeStage.CHARGEBACK
            state.links = self._links_for(state.stage, state.dispute_id)
            self._record_call(
                "require_evidence", {"dispute_id": dispute_id, "action": action}
            )
            return GatewayResponse(
                status_code=200,
                body={
                    "dispute_id": dispute_id,
                    "action": action,
                    "dispute_life_cycle_stage": state.stage.value,
                    "status": state.status.value,
                },
                latency_ms=0,
            )

    # ------------------------------------------------------------ subscriptions
    async def suspend_subscription(self, subscription_id: str, reason: str) -> GatewayResponse:
        """Suspend a subscription created by this simulator (or the demo one)."""
        if not isinstance(subscription_id, str) or not subscription_id:
            raise UpstreamError("subscription_not_found")
        text = reason if isinstance(reason, str) else ""
        async with self._lock:
            if subscription_id not in self._subscriptions:
                raise UpstreamError("subscription_not_found")
            self._suspended[subscription_id] = text
            self._record_call(
                "suspend_subscription",
                {"subscription_id": subscription_id, "reason": text},
            )
            return GatewayResponse(
                status_code=200,
                body={
                    "subscription_id": subscription_id,
                    "status": "SUSPENDED",
                    "reason": text,
                },
                latency_ms=0,
            )

    async def search_transactions(
        self, *, payer_id: str, start: datetime, end: datetime
    ) -> list[PayPalTransactionRecord]:
        """Return deterministic synthetic history filtered to [start, end]."""
        if not isinstance(payer_id, str) or not payer_id.strip():
            raise UpstreamError("payer_id_required")
        if not isinstance(start, datetime) or not isinstance(end, datetime):
            raise UpstreamError("invalid_transaction_window")
        begin = wire.ensure_utc(start)
        finish = wire.ensure_utc(end)
        if begin > finish:
            raise UpstreamError("invalid_transaction_window")

        async with self._lock:
            self._record_call(
                "search_transactions",
                {
                    "payer_id": payer_id.strip(),
                    "start": begin.isoformat(),
                    "end": finish.isoformat(),
                },
            )
        return [
            record
            for record in synthetic_transactions(payer_id.strip(), now=self._now())
            if begin <= record.created_at <= finish
        ]

    # ----------------------------------------------------------------- webhooks
    async def verify_webhook(
        self, headers: Mapping[str, str], raw_body: bytes
    ) -> WebhookVerification:
        """Verify the simulator HMAC and parse the event; never raises."""
        normalised = {str(key).lower(): str(value) for key, value in headers.items()}
        timestamp = normalised.get("x-verdictpay-timestamp")
        signature = normalised.get("x-verdictpay-signature")
        if not timestamp or not signature:
            if self._settings.allow_unsigned_webhooks and self._settings.app_env == "local":
                return await self._parse_webhook_event(raw_body, reason="unsigned_dev_mode")
            return WebhookVerification(verified=False, reason="missing_signature_headers")
        verified, reason = verify_signature(
            secret=self._settings.verdictpay_webhook_secret,
            timestamp=timestamp,
            body=raw_body,
            signature=signature,
            tolerance_seconds=self._settings.webhook_tolerance_seconds,
        )
        if not verified:
            return WebhookVerification(verified=False, reason=reason)
        return await self._parse_webhook_event(raw_body, reason=None)

    async def _parse_webhook_event(
        self, raw_body: bytes, *, reason: str | None
    ) -> WebhookVerification:
        try:
            payload = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return WebhookVerification(verified=False, reason="invalid_json")
        if not isinstance(payload, Mapping):
            return WebhookVerification(verified=False, reason="invalid_json")
        event_id = payload.get("id")
        if not isinstance(event_id, str) or not event_id:
            return WebhookVerification(verified=False, reason="missing_event_id")

        dispute: PayPalDisputeRecord | None = None
        resource = payload.get("resource")
        async with self._lock:
            if isinstance(resource, Mapping):
                dispute_id = resource.get("dispute_id")
                if isinstance(dispute_id, str) and dispute_id:
                    stored = self._disputes.get(dispute_id)
                    dispute = (
                        stored.to_record()
                        if stored is not None
                        else wire.parse_dispute(resource, now=self._now())
                    )
        event = WebhookEvent(
            event_id=event_id,
            event_type=str(payload.get("event_type") or ""),
            resource_type=str(payload.get("resource_type") or ""),
            summary=str(payload.get("summary") or ""),
            dispute=dispute,
            raw=payload,
        )
        return WebhookVerification(verified=True, event=event, reason=reason)

    async def close(self) -> None:
        """The simulator owns no sockets; close is an intentional no-op."""
        return None