"""Production-shaped PayPal client.

Speaks the real PayPal REST APIs (Disputes v1, Subscriptions v1, Reporting v1,
Orders v2, Notifications v1) through httpx with OAuth2 client-credentials, an
expiry-cached token, idempotency keys on every POST and bounded retries.

Security: the access token and client secret are never logged, never placed in
error messages and never returned to callers.
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any
from urllib.parse import quote

import httpx

from app.config import Settings
from app.domain.enums import DisputeChannel, DisputeStage
from app.domain.evidence.multipart import build_multipart_related
from app.domain.protocols import (
    EvidenceSubmission,
    GatewayResponse,
    PayPalDisputeRecord,
    PayPalTransactionRecord,
    SandboxOrder,
    WebhookVerification,
)
from app.errors import UpstreamError
from app.integrations.paypal import wire

TOKEN_PATH = "/v1/oauth2/token"
DISPUTES_PATH = "/v1/customer/disputes"
MAX_ATTEMPTS = 3
RETRY_DELAYS = (0.2, 0.4)
MAX_RETRY_AFTER_SECONDS = 2.0
TOKEN_REFRESH_MARGIN_SECONDS = 60.0
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})
CHECKOUT_FALLBACK = "https://sandbox.paypal.com/checkoutnow?token="
NOTE_MAX_CHARS = 2000
PAGE_SIZE_MAX = 50


class LivePayPalGateway:
    """httpx-backed PayPal gateway selected by PAYPAL_MODE=live."""

    mode = "live"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = httpx.AsyncClient(
            base_url=settings.paypal_api_base.rstrip("/"),
            timeout=settings.paypal_timeout_seconds,
        )
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()

    # -------------------------------------------------------------------- auth
    async def _access_token(self) -> str:
        """Return a cached OAuth token, refreshing it 60s before expiry."""
        async with self._token_lock:
            now = time.monotonic()
            if self._token and now < self._token_expires_at - TOKEN_REFRESH_MARGIN_SECONDS:
                return self._token
            token, expires_in = await self._fetch_token()
            self._token = token
            self._token_expires_at = time.monotonic() + expires_in
            return token

    async def _fetch_token(self) -> tuple[str, float]:
        response = await self._client.post(
            TOKEN_PATH,
            data={"grant_type": "client_credentials"},
            auth=httpx.BasicAuth(
                self._settings.paypal_client_id, self._settings.paypal_client_secret
            ),
            headers={"Accept": "application/json"},
        )
        body = self._decode(response)
        if response.status_code >= 400:
            raise self._upstream_error("POST", TOKEN_PATH, response, body)
        token = body.get("access_token")
        if not isinstance(token, str) or not token:
            raise UpstreamError("PayPal token response did not include an access token.")
        try:
            expires_in = float(body.get("expires_in", 0.0))
        except (TypeError, ValueError):
            expires_in = 0.0
        return token, expires_in

    # ----------------------------------------------------------------- plumbing
    @staticmethod
    def _decode(response: httpx.Response) -> dict[str, Any]:
        try:
            payload = response.json()
        except ValueError:
            return {}
        return payload if isinstance(payload, dict) else {}

    @staticmethod
    def _upstream_error(
        method: str, path: str, response: httpx.Response, body: Mapping[str, Any]
    ) -> UpstreamError:
        detail = wire.extract_error_detail(body)
        message = (
            f"PayPal {method.upper()} {path} failed with status "
            f"{response.status_code}: {detail}"
        )
        debug_id = response.headers.get("paypal-debug-id") or response.headers.get(
            "paypal-correlation-id"
        )
        details = [{"field": "paypal_debug_id", "message": debug_id}] if debug_id else []
        return UpstreamError(message, details=details)

    def _retry_delay(self, response: httpx.Response, attempt: int) -> float:
        retry_after = response.headers.get("retry-after")
        if retry_after:
            try:
                parsed = float(retry_after)
            except ValueError:
                parsed = -1.0
            if parsed >= 0:
                return min(parsed, MAX_RETRY_AFTER_SECONDS)
        return RETRY_DELAYS[min(attempt, len(RETRY_DELAYS) - 1)]

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        content: bytes | None = None,
        idempotency_key: str | None = None,
        retry: bool = True,
    ) -> GatewayResponse:
        token = await self._access_token()
        request_headers: dict[str, str] = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Prefer": "return=representation",
        }
        if headers:
            request_headers.update(headers)
        if method.upper() in {"POST", "PUT", "PATCH"}:
            request_headers["PayPal-Request-Id"] = idempotency_key or uuid.uuid4().hex

        attempts = MAX_ATTEMPTS if retry else 1
        started = time.perf_counter()
        response: httpx.Response | None = None
        body: dict[str, Any] = {}
        for attempt in range(attempts):
            response = await self._client.request(
                method,
                path,
                json=json_body if content is None else None,
                params=params,
                headers=request_headers,
                content=content,
            )
            body = self._decode(response)
            if response.status_code not in RETRYABLE_STATUS or attempt == attempts - 1:
                break
            await asyncio.sleep(self._retry_delay(response, attempt))

        if response is None:
            raise UpstreamError(f"PayPal {method.upper()} {path} was never attempted.")
        latency_ms = round((time.perf_counter() - started) * 1000)
        if response.status_code >= 400:
            raise self._upstream_error(method, path, response, body)
        request_id = response.headers.get("paypal-debug-id") or response.headers.get(
            "paypal-correlation-id"
        )
        return GatewayResponse(
            status_code=response.status_code,
            body=body,
            latency_ms=latency_ms,
            request_id=request_id,
        )

    @staticmethod
    def _require_text(value: Any, code: str, *, max_chars: int | None = None) -> str:
        text = value.strip() if isinstance(value, str) else ""
        if not text:
            raise UpstreamError(code)
        if max_chars is not None and len(text) > max_chars:
            raise UpstreamError(code)
        return text

    @staticmethod
    def _require_currency(raw: Any) -> str:
        code = raw.strip().upper() if isinstance(raw, str) else ""
        if len(code) != 3 or not code.isalpha():
            raise UpstreamError("invalid_currency")
        return code

    # ----------------------------------------------------------------- disputes
    async def get_dispute(self, dispute_id: str) -> PayPalDisputeRecord:
        """GET /v1/customer/disputes/{id}."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        response = await self._request(
            "GET", f"{DISPUTES_PATH}/{quote(dispute, safe='')}"
        )
        return wire.parse_dispute(response.body)

    async def list_disputes(self, *, page_size: int = 50) -> list[PayPalDisputeRecord]:
        """GET /v1/customer/disputes?page_size=..."""
        if not isinstance(page_size, int) or isinstance(page_size, bool):
            raise UpstreamError("invalid_page_size")
        if page_size < 1:
            raise UpstreamError("invalid_page_size")
        response = await self._request(
            "GET", DISPUTES_PATH, params={"page_size": min(page_size, PAGE_SIZE_MAX)}
        )
        items = response.body.get("items")
        if not isinstance(items, list):
            return []
        return [
            wire.parse_dispute(item)
            for item in items
            if isinstance(item, Mapping)
        ]

    async def send_message(self, dispute_id: str, message: str) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/send-message."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        text = self._require_text(message, "message_required", max_chars=NOTE_MAX_CHARS)
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/send-message",
            json_body={"message": text},
        )

    async def make_offer(
        self, dispute_id: str, amount: Decimal, note: str, *, currency: str = "USD"
    ) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/make-offer."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        offer_amount = wire.parse_decimal(amount)
        if offer_amount <= 0:
            raise UpstreamError("invalid_offer_amount")
        code = self._require_currency(currency)
        text = note if isinstance(note, str) else ""
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("note_too_long")
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/make-offer",
            json_body={
                "note": text,
                "offer_amount": wire.build_offer_amount(offer_amount, code),
            },
        )

    async def accept_claim(self, dispute_id: str, note: str) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/accept-claim."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        text = note if isinstance(note, str) else ""
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("note_too_long")
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/accept-claim",
            json_body={"note": text},
        )

    async def provide_evidence(self, submission: EvidenceSubmission) -> GatewayResponse:
        """POST multipart/related evidence built by the frozen evidence builder."""
        dispute = self._require_text(submission.dispute_id, "dispute_id_required")
        key = self._require_text(submission.idempotency_key, "idempotency_key_required")
        self._require_text(submission.evidence_type, "evidence_type_required")
        payload = build_multipart_related(submission)
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/provide-evidence",
            headers={"Content-Type": payload.content_type},
            content=payload.body,
            idempotency_key=key,
        )

    async def require_evidence(
        self, dispute_id: str, *, action: str = "SELLER_EVIDENCE"
    ) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/require-evidence."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        evidence_action = self._require_text(action, "invalid_evidence_action")
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/require-evidence",
            json_body={"action": evidence_action},
        )

    # ------------------------------------------------------------ subscriptions
    async def suspend_subscription(self, subscription_id: str, reason: str) -> GatewayResponse:
        """POST /v1/billing/subscriptions/{id}/suspend."""
        subscription = self._require_text(subscription_id, "subscription_id_required")
        return await self._request(
            "POST",
            f"/v1/billing/subscriptions/{quote(subscription, safe='')}/suspend",
            json_body={"reason": reason if isinstance(reason, str) else ""},
        )

    # ----------------------------------------------------------------- reporting
    async def search_transactions(
        self, *, payer_id: str, start: datetime, end: datetime
    ) -> list[PayPalTransactionRecord]:
        """GET /v1/reporting/transactions for the CE 3.0 lookback window."""
        payer = self._require_text(payer_id, "payer_id_required")
        if not isinstance(start, datetime) or not isinstance(end, datetime):
            raise UpstreamError("invalid_transaction_window")
        begin = wire.ensure_utc(start)
        finish = wire.ensure_utc(end)
        if begin > finish:
            raise UpstreamError("invalid_transaction_window")
        response = await self._request(
            "GET",
            "/v1/reporting/transactions",
            params={
                "payer_id": payer,
                "start_date": begin.isoformat(),
                "end_date": finish.isoformat(),
                "fields": "transaction_info,payer_info",
            },
        )
        details = response.body.get("transaction_details")
        if not isinstance(details, list):
            return []
        return [
            wire.parse_transaction(item)
            for item in details
            if isinstance(item, Mapping)
        ]

    # ----------------------------------------------------------------- webhooks
    async def verify_webhook(
        self, headers: Mapping[str, str], raw_body: bytes
    ) -> WebhookVerification:
        """Verify a webhook with PayPal's verify-webhook-signature endpoint."""
        normalised = {str(key).lower(): str(value) for key, value in headers.items()}
        transmission = {
            "transmission_id": normalised.get("paypal-transmission-id"),
            "transmission_time": normalised.get("paypal-transmission-time"),
            "cert_url": normalised.get("paypal-cert-url"),
            "auth_algo": normalised.get("paypal-auth-algo"),
            "transmission_sig": normalised.get("paypal-transmission-sig"),
        }
        if not all(transmission.values()):
            return WebhookVerification(verified=False, reason="missing_transmission_headers")
        if not self._settings.paypal_webhook_id:
            return WebhookVerification(verified=False, reason="webhook_id_not_configured")
        try:
            payload = json.loads(raw_body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return WebhookVerification(verified=False, reason="invalid_json")
        if not isinstance(payload, Mapping):
            return WebhookVerification(verified=False, reason="invalid_json")
        if not isinstance(payload.get("id"), str) or not payload.get("id"):
            return WebhookVerification(verified=False, reason="missing_event_id")

        response = await self._request(
            "POST",
            "/v1/notifications/verify-webhook-signature",
            json_body={
                "auth_algo": transmission["auth_algo"],
                "cert_url": transmission["cert_url"],
                "transmission_id": transmission["transmission_id"],
                "transmission_sig": transmission["transmission_sig"],
                "transmission_time": transmission["transmission_time"],
                "webhook_id": self._settings.paypal_webhook_id,
                "webhook_event": payload,
            },
        )
        status = str(response.body.get("verification_status") or "").upper()
        if status != "SUCCESS":
            return WebhookVerification(
                verified=False, reason=f"verification_status={status or 'unknown'}"
            )
        return WebhookVerification(
            verified=True, event=wire.parse_webhook_event(payload), reason=None
        )

    # -------------------------------------------------------------------- orders
    async def create_order(
        self,
        *,
        payer_id: str,
        amount: Decimal,
        currency: str = "USD",
        description: str = "VerdictPay demo plan",
    ) -> SandboxOrder:
        """POST /v1/checkout/orders."""
        payer = self._require_text(payer_id, "payer_id_required")
        order_amount = wire.parse_decimal(amount)
        if order_amount <= 0:
            raise UpstreamError("invalid_order_amount")
        code = self._require_currency(currency)
        text = self._require_text(description, "description_required")
        response = await self._request(
            "POST",
            "/v1/checkout/orders",
            json_body={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {"currency_code": code, "value": f"{order_amount:.2f}"},
                        "description": text,
                        "custom_id": payer,
                    }
                ],
            },
        )
        order_id = response.body.get("id")
        if not isinstance(order_id, str) or not order_id:
            raise UpstreamError("PayPal order response did not include an order id.")
        links = wire.parse_links(response.body.get("links"))
        approval_url = (
            links.get("approve")
            or links.get("payer-action")
            or f"{CHECKOUT_FALLBACK}{order_id}"
        )
        subscription_id = response.body.get("subscription_id")
        return SandboxOrder(
            order_id=order_id,
            subscription_id=subscription_id if isinstance(subscription_id, str) else None,
            payer_id=payer,
            amount=order_amount,
            currency=code,
            status=str(response.body.get("status") or "COMPLETED"),
            approval_url=approval_url,
            created_at=datetime.now(UTC),
        )

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
        """POST /v1/customer/disputes with an unsigned buyer auth assertion."""
        payer = self._require_text(payer_id, "payer_id_required")
        order = self._require_text(order_id, "order_id_required")
        dispute_amount = wire.parse_decimal(amount)
        if dispute_amount <= 0:
            raise UpstreamError("invalid_dispute_amount")
        code = self._require_currency(currency)
        try:
            dispute_stage = DisputeStage(stage)
            dispute_channel = DisputeChannel(channel)
        except ValueError as exc:
            raise UpstreamError("invalid_dispute_state") from exc
        response = await self._request(
            "POST",
            DISPUTES_PATH,
            headers={
                "PayPal-Auth-Assertion": wire.build_auth_assertion(
                    self._settings.paypal_client_id, payer
                )
            },
            json_body={
                "reason": wire.normalise_reason(reason_code),
                "dispute_amount": {
                    "currency_code": code,
                    "value": f"{dispute_amount:.2f}",
                },
                "dispute_life_cycle_stage": dispute_stage.value,
                "dispute_channel": dispute_channel.value,
                "seller_transaction_id": order,
            },
        )
        return wire.parse_dispute(response.body)

    async def close(self) -> None:
        """Release the HTTP connection pool and invalidate the cached token."""
        self._token = None
        self._token_expires_at = 0.0
        await self._client.aclose()
