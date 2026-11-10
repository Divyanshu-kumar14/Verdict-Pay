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
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
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
    OrderCapture,
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
CHECKOUT_FALLBACK_SANDBOX = "https://www.sandbox.paypal.com/checkoutnow?token="
CHECKOUT_FALLBACK_PRODUCTION = "https://www.paypal.com/checkoutnow?token="
NOTE_MAX_CHARS = 2000
PAGE_SIZE_MAX = 50
ORDERS_PATH = "/v2/checkout/orders"
TRANSACTIONS_PATH = "/v1/reporting/transactions"
TRACKERS_PATH = "/v1/shipping/trackers-batch"
TRACKERS_BATCH_MAX = 20
OFFER_TYPES = frozenset(
    {"REFUND", "REFUND_WITH_RETURN", "REFUND_WITH_REPLACEMENT", "REPLACEMENT_WITHOUT_REFUND"}
)
ACCEPT_CLAIM_TYPES = frozenset(
    {"REFUND", "REFUND_WITH_RETURN", "PARTIAL_REFUND", "REFUND_WITH_RETURN_SHIPMENT_LABEL"}
)
ADJUDICATION_OUTCOMES = frozenset({"BUYER_FAVOR", "SELLER_FAVOR"})
TRANSACTION_FIELDS = "transaction_info,payer_info"
# PayPal's Reporting API rejects windows greater than 31 days; exactly 31 is
# accepted, so every request window is capped at this many days and merged.
TRANSACTION_WINDOW_DAYS = 31
# Reporting v1 caps page_size at 500; the cap below stops a corrupt total_pages
# value from turning one window into an unbounded number of requests.
REPORTING_PAGE_SIZE_MAX = 500
REPORTING_MAX_PAGES = 10
REPORTING_MAX_CONCURRENCY = 4
# PayPal rejects datetime.isoformat() ("+00:00") with HTTP 400. It accepts this
# compact, second-precision UTC form (and the equivalent "...Z" suffix).
REPORTING_DATE_FORMAT = "%Y-%m-%dT%H:%M:%S+0000"


class LivePayPalGateway:
    """httpx-backed gateway for PAYPAL_SANDBOX and PAYPAL_LIVE.

    Both network modes share this adapter; only ``paypal_api_base`` and the
    reported ``mode`` differ, so sandbox and production exercise identical code.
    """

    @property
    def mode(self) -> str:
        return self._settings.gateway_mode.value

    @property
    def is_sandbox(self) -> bool:
        return "sandbox" in self._settings.paypal_api_base.lower()

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

    async def _refresh_token(self, rejected: str) -> str:
        """Replace a token PayPal rejected with 401.

        Concurrent requests can all hit 401 with the same stale token; only the
        first one fetches, the rest reuse the token it stored.
        """
        async with self._token_lock:
            if self._token and self._token != rejected:
                return self._token
            self._token = None
            self._token_expires_at = 0.0
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
            f"PayPal {method.upper()} {path} failed with status {response.status_code}: {detail}"
        )
        debug_id = response.headers.get("paypal-debug-id") or response.headers.get(
            "paypal-correlation-id"
        )
        details = [{"field": "paypal_debug_id", "message": debug_id}] if debug_id else []
        # Carry PayPal's machine-readable issue tokens (ORDER_NOT_APPROVED and
        # friends) on the error itself: a caller retrying an approved capture
        # must be able to tell that apart from a hard failure.
        return UpstreamError(
            message,
            details=details,
            issues=wire.extract_error_issues(body),
            upstream_status=response.status_code,
        )

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
            # Fixed for every attempt, including the post-401 retry below, so
            # PayPal de-duplicates a POST that reached it more than once.
            request_headers["PayPal-Request-Id"] = idempotency_key or uuid.uuid4().hex

        attempts = MAX_ATTEMPTS if retry else 1
        started = time.perf_counter()
        response: httpx.Response | None = None
        body: dict[str, Any] = {}
        token_refreshed = False
        attempt = 0
        while attempt < attempts:
            response = await self._client.request(
                method,
                path,
                json=json_body if content is None else None,
                params=params,
                headers=request_headers,
                content=content,
            )
            body = self._decode(response)
            if response.status_code == 401 and not token_refreshed:
                # The cached token was revoked or expired early. Fetch a new one
                # and retry once; a second 401 is a real credential failure.
                token_refreshed = True
                token = await self._refresh_token(token)
                request_headers["Authorization"] = f"Bearer {token}"
                continue
            if response.status_code not in RETRYABLE_STATUS or attempt == attempts - 1:
                break
            await asyncio.sleep(self._retry_delay(response, attempt))
            attempt += 1

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
        response = await self._request("GET", f"{DISPUTES_PATH}/{quote(dispute, safe='')}")
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
        return [wire.parse_dispute(item) for item in items if isinstance(item, Mapping)]

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
        self,
        dispute_id: str,
        amount: Decimal,
        note: str,
        *,
        currency: str = "USD",
        offer_type: str = "REFUND",
    ) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/make-offer."""
        if offer_type not in OFFER_TYPES:
            raise UpstreamError("invalid_offer_type")
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
                "offer_type": offer_type,
            },
        )

    async def accept_claim(
        self, dispute_id: str, note: str, *, accept_claim_type: str = "REFUND"
    ) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/accept-claim."""
        if accept_claim_type not in ACCEPT_CLAIM_TYPES:
            raise UpstreamError("invalid_accept_claim_type")
        dispute = self._require_text(dispute_id, "dispute_id_required")
        text = note if isinstance(note, str) else ""
        if len(text) > NOTE_MAX_CHARS:
            raise UpstreamError("note_too_long")
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/accept-claim",
            json_body={"note": text, "accept_claim_type": accept_claim_type},
        )

    async def escalate(self, dispute_id: str, note: str) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/escalate (INQUIRY -> CLAIM)."""
        dispute = self._require_text(dispute_id, "dispute_id_required")
        text = self._require_text(note, "note_required", max_chars=NOTE_MAX_CHARS)
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/escalate",
            json_body={"note": text},
        )

    async def appeal(self, submission: EvidenceSubmission) -> GatewayResponse:
        """POST multipart/related evidence to /appeal (after a seller loss)."""
        dispute = self._require_text(submission.dispute_id, "dispute_id_required")
        key = self._require_text(submission.idempotency_key, "idempotency_key_required")
        payload = build_multipart_related(submission)
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/appeal",
            headers={"Content-Type": payload.content_type},
            content=payload.body,
            idempotency_key=key,
        )

    async def adjudicate(self, dispute_id: str, outcome: str) -> GatewayResponse:
        """POST /v1/customer/disputes/{id}/adjudicate — PayPal sandbox only."""
        if not self.is_sandbox:
            raise UpstreamError("adjudicate_is_sandbox_only")
        if outcome not in ADJUDICATION_OUTCOMES:
            raise UpstreamError("invalid_adjudication_outcome")
        dispute = self._require_text(dispute_id, "dispute_id_required")
        return await self._request(
            "POST",
            f"{DISPUTES_PATH}/{quote(dispute, safe='')}/adjudicate",
            json_body={"adjudication_outcome": outcome},
        )

    async def add_trackers(self, trackers: Sequence[Mapping[str, str]]) -> GatewayResponse:
        """POST /v1/shipping/trackers-batch (Trackers v1)."""
        if not trackers or len(trackers) > TRACKERS_BATCH_MAX:
            raise UpstreamError("invalid_tracker_batch")
        body: list[dict[str, str]] = []
        for item in trackers:
            entry = {
                "transaction_id": self._require_text(
                    item.get("transaction_id"), "tracker_transaction_id_required"
                ),
                "tracking_number": self._require_text(
                    item.get("tracking_number"), "tracking_number_required", max_chars=64
                ),
                "status": str(item.get("status") or "SHIPPED"),
                "carrier": self._require_text(item.get("carrier"), "carrier_required"),
            }
            body.append(entry)
        return await self._request("POST", TRACKERS_PATH, json_body={"trackers": body})

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
    @staticmethod
    def _reporting_date(value: datetime) -> str:
        """Render a Reporting v1 timestamp in PayPal's compact UTC form."""
        return wire.ensure_utc(value).strftime(REPORTING_DATE_FORMAT)

    @staticmethod
    def _total_pages(body: Mapping[str, Any]) -> int | None:
        """Read total_pages defensively; None when PayPal omitted or mangled it."""
        raw = body.get("total_pages")
        if raw is None or isinstance(raw, bool):
            return None
        try:
            total = int(raw)
        except (TypeError, ValueError):
            return None
        return total if total >= 1 else None

    async def _search_transaction_window(
        self, begin: datetime, finish: datetime
    ) -> list[PayPalTransactionRecord]:
        """Fetch one <=31-day window, following Reporting API pagination."""
        records: list[PayPalTransactionRecord] = []
        page = 1
        while page <= REPORTING_MAX_PAGES:
            response = await self._request(
                "GET",
                TRANSACTIONS_PATH,
                params={
                    "start_date": self._reporting_date(begin),
                    "end_date": self._reporting_date(finish),
                    "fields": TRANSACTION_FIELDS,
                    "page_size": REPORTING_PAGE_SIZE_MAX,
                    "page": page,
                },
            )
            details = response.body.get("transaction_details")
            if not isinstance(details, list) or not details:
                break
            records.extend(
                wire.parse_transaction(item) for item in details if isinstance(item, Mapping)
            )
            total_pages = self._total_pages(response.body)
            if total_pages is not None:
                if page >= total_pages:
                    break
            elif len(details) < REPORTING_PAGE_SIZE_MAX:
                break
            page += 1
        return records

    async def search_transactions(
        self, *, payer_id: str, start: datetime, end: datetime
    ) -> list[PayPalTransactionRecord]:
        """Merge Reporting v1 transactions across <=31-day windows and pages.

        PayPal constraints handled here:
        - timestamps must use the compact "...+0000" form, not "+00:00";
        - payer_id is not a valid reporting query parameter (HTTP 400), so the
          filter is applied to parsed records after the response;
        - a window may not exceed 31 days, so long CE 3.0 lookbacks are chunked;
        - a page holds at most 500 records, so pages are followed (bounded).
        """
        payer = self._require_text(payer_id, "payer_id_required")
        if not isinstance(start, datetime) or not isinstance(end, datetime):
            raise UpstreamError("invalid_transaction_window")
        begin = wire.ensure_utc(start).replace(microsecond=0)
        finish = wire.ensure_utc(end).replace(microsecond=0)
        if begin > finish:
            raise UpstreamError("invalid_transaction_window")

        window = timedelta(days=TRANSACTION_WINDOW_DAYS)
        windows: list[tuple[datetime, datetime]] = []
        chunk_start = begin
        while chunk_start <= finish:
            chunk_end = min(chunk_start + window, finish)
            windows.append((chunk_start, chunk_end))
            if chunk_end >= finish:
                break
            chunk_start = chunk_end + timedelta(seconds=1)

        # A 245-day CE 3.0 lookback is 8 windows. Fetched one after another
        # they took ~20s per dossier, so fetch them concurrently (bounded, to
        # stay clear of PayPal's rate limit). gather keeps window order, so the
        # merge and de-duplication below are unchanged.
        limit = asyncio.Semaphore(REPORTING_MAX_CONCURRENCY)

        async def fetch(span: tuple[datetime, datetime]) -> list[PayPalTransactionRecord]:
            async with limit:
                return await self._search_transaction_window(*span)

        batches = await asyncio.gather(*(fetch(span) for span in windows))

        expected_payer = payer.strip()
        records: list[PayPalTransactionRecord] = []
        seen: set[str] = set()
        for batch in batches:
            for record in batch:
                if record.payer_id.strip() != expected_payer:
                    continue
                transaction_id = record.transaction_id.strip()
                if transaction_id:
                    if transaction_id in seen:
                        continue
                    seen.add(transaction_id)
                records.append(record)
        return records

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
        return_url: str | None = None,
        cancel_url: str | None = None,
    ) -> SandboxOrder:
        """POST /v2/checkout/orders (the v1 path rejects purchase_units).

        The returned order is *created*, not paid: PayPal reports
        ``status=CREATED`` until the buyer approves in the PayPal UI.
        """
        payer = self._require_text(payer_id, "payer_id_required")
        order_amount = wire.parse_decimal(amount)
        if order_amount <= 0:
            raise UpstreamError("invalid_order_amount")
        code = self._require_currency(currency)
        text = self._require_text(description, "description_required")
        application_context: dict[str, object] = {
            "brand_name": self._settings.demo_merchant_name,
            "shipping_preference": "NO_SHIPPING",
            "user_action": "PAY_NOW",
        }
        if return_url:
            application_context["return_url"] = return_url
        if cancel_url:
            application_context["cancel_url"] = cancel_url
        response = await self._request(
            "POST",
            ORDERS_PATH,
            json_body={
                "intent": "CAPTURE",
                "purchase_units": [
                    {
                        "amount": {"currency_code": code, "value": f"{order_amount:.2f}"},
                        "description": text,
                        "custom_id": payer,
                    }
                ],
                "application_context": application_context,
            },
        )
        order_id = response.body.get("id")
        if not isinstance(order_id, str) or not order_id:
            raise UpstreamError("PayPal order response did not include an order id.")
        links = wire.parse_links(response.body.get("links"))
        fallback = (
            CHECKOUT_FALLBACK_SANDBOX
            if "sandbox" in self._settings.paypal_api_base.lower()
            else CHECKOUT_FALLBACK_PRODUCTION
        )
        approval_url = links.get("approve") or links.get("payer-action") or f"{fallback}{order_id}"
        subscription_id = response.body.get("subscription_id")
        return SandboxOrder(
            order_id=order_id,
            subscription_id=subscription_id if isinstance(subscription_id, str) else None,
            payer_id=payer,
            amount=order_amount,
            currency=code,
            # NEVER default to COMPLETED: an order that was not approved yet is
            # the truth PayPal just told us, and defaulting it would fake a sale.
            status=str(response.body.get("status") or "CREATED"),
            approval_url=approval_url,
            created_at=datetime.now(UTC),
            lifecycle_stage=_order_stage(str(response.body.get("status") or "CREATED")),
            paypal_debug_id=response.request_id,
            raw=dict(response.body),
        )

    async def get_order(self, order_id: str) -> SandboxOrder:
        """GET /v2/checkout/orders/{id} — the authoritative order state."""
        order = self._require_text(order_id, "order_id_required")
        response = await self._request("GET", f"{ORDERS_PATH}/{quote(order, safe='')}")
        body = response.body
        links = wire.parse_links(body.get("links"))
        fallback = (
            CHECKOUT_FALLBACK_SANDBOX
            if "sandbox" in self._settings.paypal_api_base.lower()
            else CHECKOUT_FALLBACK_PRODUCTION
        )
        amount, currency = _purchase_unit_amount(body)
        payer_id = _payer_id_from(body)
        status = str(body.get("status") or "CREATED")
        return SandboxOrder(
            order_id=str(body.get("id") or order),
            subscription_id=None,
            payer_id=payer_id or "",
            amount=amount,
            currency=currency,
            status=status,
            approval_url=links.get("approve") or links.get("payer-action") or f"{fallback}{order}",
            created_at=wire.parse_datetime(body.get("create_time")) or datetime.now(UTC),
            lifecycle_stage=_order_stage(status),
            paypal_debug_id=response.request_id,
            raw=dict(body),
        )

    async def capture_order(self, order_id: str) -> OrderCapture:
        """POST /v2/checkout/orders/{id}/capture — the only path that moves money.

        A 422 ``ORDER_NOT_APPROVED`` is surfaced as-is: it means the buyer has not
        approved the order yet, not that the payment failed silently.
        """
        order = self._require_text(order_id, "order_id_required")
        response = await self._request(
            "POST", f"{ORDERS_PATH}/{quote(order, safe='')}/capture", json_body={}
        )
        body = response.body
        status = str(body.get("status") or "").upper()
        capture_id, capture_status, captured_at = _capture_details(body)
        amount, currency = _purchase_unit_amount(body)
        return OrderCapture(
            order_id=str(body.get("id") or order),
            capture_id=capture_id,
            capture_status=capture_status or status,
            amount=amount,
            currency=currency,
            payer_id=_payer_id_from(body),
            captured_at=captured_at,
            raw=dict(body),
            paypal_debug_id=response.request_id,
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


# ------------------------------------------------------------------ order helpers
_ORDER_STAGES = {
    "CREATED": "CREATED",
    "SAVED": "CREATED",
    "PAYER_ACTION_REQUIRED": "CREATED",
    "APPROVED": "APPROVED",
    "COMPLETED": "CAPTURED",
}


def _order_stage(status: str) -> str:
    """Map a PayPal order status onto our three honest lifecycle stages."""
    return _ORDER_STAGES.get(status.upper(), "CREATED")


def _purchase_unit_amount(body: Mapping[str, Any]) -> tuple[Decimal, str]:
    """Read the amount from either an order or a capture-shaped response."""
    units = body.get("purchase_units")
    if isinstance(units, Sequence) and not isinstance(units, (str, bytes)):
        for unit in units:
            if not isinstance(unit, Mapping):
                continue
            payments = unit.get("payments")
            if isinstance(payments, Mapping):
                captures = payments.get("captures")
                if isinstance(captures, Sequence) and not isinstance(captures, (str, bytes)):
                    for capture in captures:
                        if isinstance(capture, Mapping):
                            amount = capture.get("amount")
                            if isinstance(amount, Mapping):
                                return (
                                    wire.parse_decimal(amount.get("value")),
                                    wire.parse_currency(amount, default="USD"),
                                )
            amount = unit.get("amount")
            if isinstance(amount, Mapping):
                return (
                    wire.parse_decimal(amount.get("value")),
                    wire.parse_currency(amount, default="USD"),
                )
    return Decimal("0.00"), "USD"


def _capture_details(
    body: Mapping[str, Any],
) -> tuple[str | None, str | None, datetime | None]:
    """Extract (capture_id, capture_status, captured_at) from a capture response."""
    units = body.get("purchase_units")
    if not isinstance(units, Sequence) or isinstance(units, (str, bytes)):
        return None, None, None
    for unit in units:
        if not isinstance(unit, Mapping):
            continue
        payments = unit.get("payments")
        if not isinstance(payments, Mapping):
            continue
        captures = payments.get("captures")
        if not isinstance(captures, Sequence) or isinstance(captures, (str, bytes)):
            continue
        for capture in captures:
            if not isinstance(capture, Mapping):
                continue
            capture_id = capture.get("id")
            return (
                capture_id if isinstance(capture_id, str) else None,
                str(capture.get("status") or "") or None,
                wire.parse_datetime(capture.get("create_time")),
            )
    return None, None, None


def _payer_id_from(body: Mapping[str, Any]) -> str | None:
    payer = body.get("payer")
    if isinstance(payer, Mapping):
        value = payer.get("payer_id")
        if isinstance(value, str) and value:
            return value
    return None
