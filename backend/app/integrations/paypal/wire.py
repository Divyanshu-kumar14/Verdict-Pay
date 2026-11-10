"""Pure PayPal wire-format helpers.

Everything here maps PayPal JSON onto the frozen domain records. PayPal adds
reason codes, stages and statuses without notice, so unknown enum values degrade
to documented safe defaults instead of raising KeyError.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from app.domain.enums import DisputeChannel, DisputeReason, DisputeStage, DisputeStatus
from app.domain.protocols import (
    PayPalDisputeRecord,
    PayPalTransactionRecord,
    WebhookEvent,
)

CENT = Decimal("0.01")

_STAGES: dict[str, DisputeStage] = {
    "INQUIRY": DisputeStage.INQUIRY,
    "CHARGEBACK": DisputeStage.CHARGEBACK,
    "PRE_ARBITRATION": DisputeStage.PRE_ARBITRATION,
    "ARBITRATION": DisputeStage.ARBITRATION,
    "RESOLVED": DisputeStage.RESOLVED,
    "CLOSED": DisputeStage.CLOSED,
}

# Reporting v1 transaction_status is a one-letter code, not an Orders v2 status.
_REPORTING_STATUS: dict[str, str] = {
    "S": "COMPLETED",
    "P": "PENDING",
    "V": "REVERSED",
    "D": "DENIED",
}

_CHANNELS: dict[str, DisputeChannel] = {
    "INTERNAL": DisputeChannel.INTERNAL,
    "EXTERNAL": DisputeChannel.EXTERNAL,
}

_STATUSES: dict[str, DisputeStatus] = {
    "OPEN": DisputeStatus.OPEN,
    "WAITING_FOR_SELLER_RESPONSE": DisputeStatus.WAITING_FOR_SELLER_RESPONSE,
    "WAITING_FOR_BUYER_RESPONSE": DisputeStatus.WAITING_FOR_SELLER_RESPONSE,
    "UNDER_REVIEW": DisputeStatus.UNDER_REVIEW,
    "RESOLVED": DisputeStatus.RESOLVED,
    "CLOSED": DisputeStatus.CLOSED,
}

_REASON_ALIASES: tuple[tuple[tuple[str, ...], DisputeReason], ...] = (
    (
        ("NOT_RECEIVED", "ITEM_NOT_RECEIVED", "INR"),
        DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED,
    ),
    (
        ("NOT_AS_DESCRIBED", "SNAD", "NOT_AS_DESCRIBED_OR_DEFECTIVE"),
        DisputeReason.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED,
    ),
    (("UNAUTHORIZED", "UNAUTHORISED"), DisputeReason.UNAUTHORIZED),
)

# Safe fallbacks for values this build does not recognise. A CLOSED stage can
# never unlock a PayPal action, so it is the conservative stage default.
DEFAULT_STAGE = DisputeStage.CLOSED
DEFAULT_CHANNEL = DisputeChannel.INTERNAL
DEFAULT_STATUS = DisputeStatus.OPEN


def ensure_utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime, treating naive input as UTC."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def parse_datetime(value: Any) -> datetime | None:
    """Parse PayPal ISO-8601 timestamps; None when the value is unusable."""
    if isinstance(value, datetime):
        return ensure_utc(value)
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return datetime.fromtimestamp(value, UTC)
        except (OverflowError, OSError, ValueError):
            return None
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    if text.endswith(("Z", "z")):
        text = text[:-1] + "+00:00"
    try:
        return ensure_utc(datetime.fromisoformat(text))
    except ValueError:
        return None


def parse_decimal(value: Any, *, default: Decimal = Decimal("0.00")) -> Decimal:
    """Parse a money value to cents, never raising on hostile input."""
    if isinstance(value, bool) or value is None:
        return default
    try:
        parsed = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError):
        return default
    if not parsed.is_finite():
        return default
    try:
        return parsed.quantize(CENT)
    except InvalidOperation:
        return default


def parse_currency(payload: Mapping[str, Any] | None, *, default: str = "USD") -> str:
    """Extract a 3-letter currency code from a PayPal money object."""
    if not payload:
        return default
    raw = payload.get("currency_code")
    if not isinstance(raw, str):
        return default
    code = raw.strip().upper()
    return code if len(code) == 3 and code.isalpha() else default


def parse_links(links: Any) -> dict[str, str]:
    """Convert PayPal HATEOAS links[] into a rel -> href map."""
    if not isinstance(links, Sequence):
        return {}
    parsed: dict[str, str] = {}
    for link in links:
        if not isinstance(link, Mapping):
            continue
        rel = link.get("rel")
        href = link.get("href")
        if isinstance(rel, str) and rel and isinstance(href, str) and href:
            parsed[rel] = href
    return parsed


def normalise_stage(raw: Any, *, default: DisputeStage = DEFAULT_STAGE) -> DisputeStage:
    """Map dispute_life_cycle_stage onto the frozen enum."""
    if isinstance(raw, DisputeStage):
        return raw
    if isinstance(raw, str):
        return _STAGES.get(raw.strip().upper(), default)
    return default


def normalise_channel(raw: Any, *, default: DisputeChannel = DEFAULT_CHANNEL) -> DisputeChannel:
    """Map dispute_channel onto the frozen enum."""
    if isinstance(raw, DisputeChannel):
        return raw
    if isinstance(raw, str):
        return _CHANNELS.get(raw.strip().upper(), default)
    return default


def normalise_status(raw: Any, *, default: DisputeStatus = DEFAULT_STATUS) -> DisputeStatus:
    """Map status / dispute_state onto the frozen enum."""
    if isinstance(raw, DisputeStatus):
        return raw
    if isinstance(raw, str):
        return _STATUSES.get(raw.strip().upper(), default)
    return default


def normalise_reason(raw: Any) -> str:
    """Canonicalise a PayPal reason code, degrading unknown codes to OTHER."""
    if isinstance(raw, DisputeReason):
        return raw.value
    if not isinstance(raw, str) or not raw.strip():
        return DisputeReason.OTHER.value
    candidate = raw.strip().upper()
    try:
        return DisputeReason(candidate).value
    except ValueError:
        pass
    for aliases, reason in _REASON_ALIASES:
        if any(alias in candidate for alias in aliases):
            return reason.value
    return DisputeReason.OTHER.value


def _money(payload: Any) -> tuple[Decimal, str]:
    if not isinstance(payload, Mapping):
        return Decimal("0.00"), "USD"
    return parse_decimal(payload.get("value")), parse_currency(payload)


def _first_str(payload: Mapping[str, Any] | Any, *keys: str) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


_MESSAGE_MAX_CHARS = 4000
_MESSAGES_MAX = 50


def parse_messages(raw: Any) -> tuple[dict[str, str], ...]:
    """PayPal ``messages[]`` as bounded ``{posted_by, time_posted, content}`` dicts."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return ()
    messages: list[dict[str, str]] = []
    for item in raw[:_MESSAGES_MAX]:
        if not isinstance(item, Mapping):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        messages.append(
            {
                "posted_by": str(item.get("posted_by") or "UNKNOWN")[:16],
                "time_posted": str(item.get("time_posted") or "")[:40],
                "content": content[:_MESSAGE_MAX_CHARS],
            }
        )
    return tuple(messages)


def _external_reason_code(payload: Mapping[str, Any]) -> str | None:
    code = _first_str(payload, "external_reason_code")
    return code[:16] if code else None


def infer_payment_rail(payload: Mapping[str, Any], external_reason_code: str | None) -> str:
    """PAYPAL_WALLET unless the payload says otherwise.

    Disputes v1 has no explicit rail field. An explicit ``payment_rail`` wins;
    otherwise an EXTERNAL dispute carrying a Visa-style ``NN.N`` network reason
    code (for example ``10.4``) is treated as an unbranded card transaction.
    """
    explicit = _first_str(payload, "payment_rail")
    if explicit in {"PAYPAL_WALLET", "UNBRANDED_CARD"}:
        return explicit
    channel = str(payload.get("dispute_channel") or "").upper()
    code = external_reason_code or ""
    head, _, tail = code.partition(".")
    if channel == "EXTERNAL" and head.isdigit() and tail.isdigit():
        return "UNBRANDED_CARD"
    return "PAYPAL_WALLET"


def parse_dispute(
    payload: Mapping[str, Any], *, now: datetime | None = None
) -> PayPalDisputeRecord:
    """Build a frozen dispute record from a PayPal dispute or webhook resource."""
    amount, currency = _money(payload.get("dispute_amount"))
    payer = payload.get("payer")
    payer_id = _first_str(payer, "payer_id")
    payer_id = payer_id or _first_str(payload, "payer_id", "paypal_payer_id") or ""

    created_at = parse_datetime(
        payload.get("create_time") or payload.get("created_at")
    ) or ensure_utc(now or datetime.now(UTC))
    external_code = _external_reason_code(payload)

    return PayPalDisputeRecord(
        dispute_id=_first_str(payload, "dispute_id", "id") or "",
        reason_code=normalise_reason(payload.get("reason") or payload.get("reason_code")),
        stage=normalise_stage(payload.get("dispute_life_cycle_stage")),
        channel=normalise_channel(payload.get("dispute_channel")),
        status=normalise_status(payload.get("status") or payload.get("dispute_state")),
        amount=amount,
        currency=currency,
        payer_id=payer_id,
        order_id=(
            _first_str(
                payload,
                "seller_transaction_id",
                "order_id",
                "paypal_order_id",
                "invoice_id",
            )
            or ""
        ),
        subscription_id=_first_str(
            payload, "subscription_id", "paypal_subscription_id", "billing_agreement_id"
        ),
        seller_response_due_date=parse_datetime(payload.get("seller_response_due_date")),
        links=parse_links(payload.get("links")),
        created_at=created_at,
        raw=payload,
        external_reason_code=external_code,
        allowed_response_options=(
            dict(payload["allowed_response_options"])
            if isinstance(payload.get("allowed_response_options"), Mapping)
            else {}
        ),
        messages=parse_messages(payload.get("messages")),
        payment_rail=infer_payment_rail(payload, external_code),
    )


def parse_transaction(payload: Mapping[str, Any]) -> PayPalTransactionRecord:
    """Build a transaction record from a Reporting v1 transaction_details item.

    Reporting v1 has no buyer IP or device fields, so ``client_ip`` and
    ``device_fingerprint`` are left empty here; the service correlates them
    (and the CE 3.0 hashes) from the local telemetry/order ledger by
    transaction id instead of trusting fields PayPal never sends.
    """
    info = payload.get("transaction_info")
    info = info if isinstance(info, Mapping) else payload
    payer = payload.get("payer_info")
    payer_id = _first_str(payer, "payer_id")
    amount, currency = _money(info.get("transaction_amount"))
    return PayPalTransactionRecord(
        transaction_id=_first_str(info, "transaction_id") or "",
        payer_id=payer_id or _first_str(info, "payer_id") or "",
        amount=amount,
        currency=currency,
        status=_REPORTING_STATUS.get(
            (_first_str(info, "transaction_status") or "").upper(),
            _first_str(info, "transaction_status") or "",
        ),
        client_ip="",
        device_fingerprint="",
        created_at=parse_datetime(info.get("transaction_initiation_date")) or datetime.now(UTC),
    )


def build_auth_assertion(client_id: str, payer_id: str) -> str:
    """Build the PayPal-Auth-Assertion value (unsigned JWT for the buyer)."""
    header = _b64url(json.dumps({"alg": "none", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = _b64url(
        json.dumps({"iss": client_id, "payer_id": payer_id}, separators=(",", ":")).encode()
    )
    return f"{header}.{claims}."


def _b64url(payload: bytes) -> str:
    return base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")


def build_offer_amount(amount: Decimal, currency: str) -> dict[str, str]:
    """Render a PayPal money object with a stable two-decimal string value."""
    return {"currency_code": currency.upper(), "value": f"{parse_decimal(amount):.2f}"}


def extract_error_issues(body: Mapping[str, Any]) -> list[str]:
    """The machine-readable ``details[].issue`` codes from a PayPal error.

    PayPal puts the actionable token here — ``ORDER_NOT_APPROVED``,
    ``INSTRUMENT_DECLINED``, ``DUPLICATE_REQUEST_ID`` — while ``name`` stays the
    generic ``UNPROCESSABLE_ENTITY``. Callers branch on these tokens, so dropping
    them makes an approved-order retry indistinguishable from a hard failure.
    """
    details = body.get("details")
    if not isinstance(details, Sequence) or isinstance(details, (str, bytes)):
        return []
    issues: list[str] = []
    for entry in details:
        if not isinstance(entry, Mapping):
            continue
        issue = entry.get("issue")
        if isinstance(issue, str) and issue and issue not in issues:
            issues.append(issue)
    return issues


def extract_error_detail(body: Mapping[str, Any]) -> str:
    """Produce a short, secret-free description of a PayPal error payload.

    Includes the ``details[].issue`` codes so the caller can see *why* PayPal
    refused (for example ``ORDER_NOT_APPROVED``) rather than only the generic
    status name.
    """
    name = body.get("name") if isinstance(body.get("name"), str) else "unknown_error"
    message = body.get("message") if isinstance(body.get("message"), str) else ""
    detail = f"{name}: {message}".strip(": ") or "no detail"
    issues = extract_error_issues(body)
    if issues:
        detail = f"{detail} [{' | '.join(issues)}]"
    for marker in ("access_token", "client_secret", "Bearer "):
        if marker in detail:
            return "upstream error redacted"
    return detail[:300]


def parse_webhook_event(payload: Mapping[str, Any], *, now: datetime | None = None) -> WebhookEvent:
    """Build a WebhookEvent from a PayPal webhook body, including its dispute."""
    resource = payload.get("resource")
    dispute: PayPalDisputeRecord | None = None
    if isinstance(resource, Mapping):
        dispute_id = resource.get("dispute_id")
        if isinstance(dispute_id, str) and dispute_id:
            dispute = parse_dispute(resource, now=now)
    event_type = payload.get("event_type")
    resource_type = payload.get("resource_type")
    summary = payload.get("summary")
    return WebhookEvent(
        event_id=str(payload.get("id") or ""),
        event_type=event_type if isinstance(event_type, str) else "",
        resource_type=resource_type if isinstance(resource_type, str) else "",
        summary=summary if isinstance(summary, str) else "",
        dispute=dispute,
        raw=payload,
    )
