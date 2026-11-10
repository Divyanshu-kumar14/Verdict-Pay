"""LivePayPalGateway contract tests against respx fixtures only.

No test in this file may touch the real network: every PayPal endpoint is a
respx route. The fixtures mirror PayPal's documented response shapes so parsing
and retry behaviour are exercised for real.
"""

from __future__ import annotations

import base64
import json
import math
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from itertools import pairwise

import httpx
import pytest
import pytest_asyncio
import respx

from app.config import Settings
from app.domain.enums import DisputeChannel, DisputeStage, DisputeStatus
from app.domain.protocols import EvidenceDocument, EvidenceSubmission
from app.errors import UpstreamError
from app.integrations.paypal.live import LivePayPalGateway
from app.integrations.paypal.wire import build_auth_assertion

BASE = "https://api-m.sandbox.paypal.com"
TOKEN_URL = f"{BASE}/v1/oauth2/token"

DISPUTE_JSON = {
    "dispute_id": "PP-D-1",
    "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    "dispute_life_cycle_stage": "INQUIRY",
    "dispute_channel": "INTERNAL",
    "status": "OPEN",
    "dispute_amount": {"currency_code": "USD", "value": "99.00"},
    "seller_response_due_date": "2026-01-11T00:00:00.000Z",
    "create_time": "2026-01-01T00:00:00.000Z",
    "seller_transaction_id": "5O190127TN364715T",
    "payer": {"payer_id": "YRZ829104KLA"},
    "links": [
        {
            "rel": "self",
            "href": f"{BASE}/v1/customer/disputes/PP-D-1",
            "method": "GET",
        },
        {
            "rel": "send-message",
            "href": f"{BASE}/v1/customer/disputes/PP-D-1/send-message",
            "method": "POST",
        },
    ],
}


@pytest.fixture
def live_settings() -> Settings:
    return Settings(
        app_env="test",
        paypal_mode="live",
        paypal_api_base=BASE,
        paypal_client_id="client-abc",
        paypal_client_secret="secret-xyz",
        paypal_webhook_id="WH-TEST-1",
        paypal_timeout_seconds=2.0,
    )


@pytest_asyncio.fixture
async def live(live_settings: Settings) -> LivePayPalGateway:
    gateway = LivePayPalGateway(live_settings)
    yield gateway
    await gateway.close()


def _token_ok() -> httpx.Response:
    return httpx.Response(
        200, json={"access_token": "AUTH-TOKEN", "expires_in": 3600, "token_type": "Bearer"}
    )


def _decode_jwt_part(part: str) -> dict[str, object]:
    padded = part + "=" * (-len(part) % 4)
    return json.loads(base64.urlsafe_b64decode(padded))


def _transaction(
    transaction_id: str,
    *,
    payer_id: str = "YRZ829104KLA",
    amount: str = "99.00",
) -> dict[str, object]:
    return {
        "transaction_info": {
            "transaction_id": transaction_id,
            "transaction_amount": {"currency_code": "USD", "value": amount},
            "transaction_status": "COMPLETED",
            "transaction_initiation_date": "2025-01-01T00:00:00Z",
        },
        "payer_info": {"payer_id": payer_id},
    }


def _reporting_date(value: str) -> datetime:
    """Parse the compact UTC form PayPal accepts, asserting it is that form."""
    assert len(value) == 24, value
    assert value.endswith("+0000"), value
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S+0000").replace(tzinfo=UTC)


@respx.mock
async def test_oauth_token_is_cached_across_calls(live: LivePayPalGateway) -> None:
    token_route = respx.post(TOKEN_URL).mock(return_value=_token_ok())
    dispute_route = respx.get(f"{BASE}/v1/customer/disputes/PP-D-1").mock(
        return_value=httpx.Response(200, json=DISPUTE_JSON)
    )

    first = await live.get_dispute("PP-D-1")
    second = await live.get_dispute("PP-D-1")

    assert token_route.call_count == 1
    assert dispute_route.call_count == 2
    token_request = token_route.calls[0].request
    expected_basic = base64.b64encode(b"client-abc:secret-xyz").decode("ascii")
    assert token_request.headers["authorization"] == f"Basic {expected_basic}"
    assert token_request.content == b"grant_type=client_credentials"

    assert first.dispute_id == "PP-D-1"
    assert first.reason_code == "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    assert first.stage is DisputeStage.INQUIRY
    assert first.channel is DisputeChannel.INTERNAL
    assert first.status is DisputeStatus.OPEN
    assert first.amount == Decimal("99.00")
    assert first.currency == "USD"
    assert first.payer_id == "YRZ829104KLA"
    assert first.order_id == "5O190127TN364715T"
    assert first.seller_response_due_date == datetime(2026, 1, 11, tzinfo=UTC)
    assert first.created_at == datetime(2026, 1, 1, tzinfo=UTC)
    assert first.links == {
        "self": f"{BASE}/v1/customer/disputes/PP-D-1",
        "send-message": f"{BASE}/v1/customer/disputes/PP-D-1/send-message",
    }
    assert second.stage is DisputeStage.INQUIRY


@respx.mock
async def test_unknown_enums_degrade_safely(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    weird = dict(
        DISPUTE_JSON,
        dispute_life_cycle_stage="SOMETHING_NEW",
        dispute_channel="CARRIER_PIGEON",
        status="MYSTERY_STATE",
        reason="CREDIT_NOT_PROCESSED",
        dispute_amount={"currency_code": "EUR", "value": "12.30"},
    )
    respx.get(f"{BASE}/v1/customer/disputes/PP-D-1").mock(
        return_value=httpx.Response(200, json=weird)
    )

    record = await live.get_dispute("PP-D-1")

    assert record.stage is DisputeStage.CLOSED
    assert record.channel is DisputeChannel.INTERNAL
    assert record.status is DisputeStatus.OPEN
    assert record.reason_code == "OTHER"
    assert record.currency == "EUR"
    assert record.amount == Decimal("12.30")


@respx.mock
async def test_429_is_retried_with_stable_idempotency_key(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v1/customer/disputes/PP-D-1/send-message").mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "0"}),
            httpx.Response(200, json={"message_id": "MSG-1"}),
        ]
    )

    response = await live.send_message("PP-D-1", "We have server-side logs.")

    assert response.status_code == 200
    assert response.body == {"message_id": "MSG-1"}
    assert route.call_count == 2
    request_ids = [call.request.headers["paypal-request-id"] for call in route.calls]
    assert request_ids[0] == request_ids[1]
    assert len(request_ids[0]) == 32
    assert json.loads(route.calls[1].request.content) == {"message": "We have server-side logs."}


@respx.mock
async def test_retries_are_bounded_to_three_attempts(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v1/customer/disputes/PP-D-1").mock(
        return_value=httpx.Response(503, headers={"Retry-After": "0"}, json={})
    )

    with pytest.raises(UpstreamError, match="status 503"):
        await live.get_dispute("PP-D-1")

    assert route.call_count == 3


@respx.mock
async def test_provide_evidence_posts_multipart_related(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v1/customer/disputes/PP-D-1/provide-evidence").mock(
        return_value=httpx.Response(200, json={"dispute_id": "PP-D-1"})
    )
    submission = EvidenceSubmission(
        dispute_id="PP-D-1",
        evidence_type="PROOF_OF_DELIVERY",
        notes="Delivered and used.",
        documents=[EvidenceDocument(name="dossier.pdf", content=b"%PDF-1.4 demo")],
        idempotency_key="idem-evidence-1",
    )

    response = await live.provide_evidence(submission)

    assert response.status_code == 200
    request = route.calls[0].request
    content_type = request.headers["content-type"]
    assert content_type.startswith('multipart/related; boundary="')
    boundary = content_type.split('boundary="', 1)[1].rstrip('"')
    assert request.headers["paypal-request-id"] == "idem-evidence-1"
    body = request.content
    assert body.startswith(("--" + boundary).encode("ascii"))
    assert body.rstrip(b"\r\n").endswith(("--" + boundary + "--").encode("ascii"))
    assert b"application/json" in body
    assert b"PROOF_OF_DELIVERY" in body
    assert b"dossier.pdf" in body
    assert b"%PDF-1.4 demo" in body


@respx.mock
async def test_verify_webhook_signature_success(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v1/notifications/verify-webhook-signature").mock(
        return_value=httpx.Response(200, json={"verification_status": "SUCCESS"})
    )
    event = {
        "id": "WH-1",
        "event_type": "CUSTOMER.DISPUTE.CREATED",
        "resource_type": "dispute",
        "summary": "A dispute was created.",
        "resource": DISPUTE_JSON,
    }
    raw_body = json.dumps(event).encode("utf-8")
    headers = {
        "PAYPAL-TRANSMISSION-ID": "tx-1",
        "PAYPAL-TRANSMISSION-TIME": "2026-01-01T00:00:00Z",
        "PAYPAL-CERT-URL": "https://api.paypal.com/cert.pem",
        "PAYPAL-AUTH-ALGO": "SHA256withRSA",
        "PAYPAL-TRANSMISSION-SIG": "sig-abc",
    }

    verification = await live.verify_webhook(headers, raw_body)

    assert verification.verified is True
    assert verification.reason is None
    assert verification.event is not None
    assert verification.event.event_id == "WH-1"
    assert verification.event.dispute is not None
    assert verification.event.dispute.dispute_id == "PP-D-1"
    sent = json.loads(route.calls[0].request.content)
    assert sent == {
        "auth_algo": "SHA256withRSA",
        "cert_url": "https://api.paypal.com/cert.pem",
        "transmission_id": "tx-1",
        "transmission_sig": "sig-abc",
        "transmission_time": "2026-01-01T00:00:00Z",
        "webhook_id": "WH-TEST-1",
        "webhook_event": event,
    }


@respx.mock
async def test_verify_webhook_signature_failure(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.post(f"{BASE}/v1/notifications/verify-webhook-signature").mock(
        return_value=httpx.Response(200, json={"verification_status": "FAILURE"})
    )
    raw_body = json.dumps({"id": "WH-1", "resource": {"dispute_id": "PP-D-1"}}).encode()
    headers = {
        "paypal-transmission-id": "tx-1",
        "paypal-transmission-time": "2026-01-01T00:00:00Z",
        "paypal-cert-url": "https://api.paypal.com/cert.pem",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-transmission-sig": "sig-abc",
    }

    verification = await live.verify_webhook(headers, raw_body)

    assert verification.verified is False
    assert verification.reason == "verification_status=FAILURE"
    assert verification.event is None


async def test_verify_webhook_requires_transmission_headers(
    live: LivePayPalGateway,
) -> None:
    verification = await live.verify_webhook({}, b"{}")
    assert verification.verified is False
    assert verification.reason == "missing_transmission_headers"


@respx.mock
async def test_non_2xx_raises_sanitized_upstream_error(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.get(f"{BASE}/v1/customer/disputes/PP-D-404").mock(
        return_value=httpx.Response(
            404,
            json={"name": "RESOURCE_NOT_FOUND", "message": "The dispute was not found."},
            headers={"PayPal-Debug-Id": "debug-404"},
        )
    )

    with pytest.raises(UpstreamError) as excinfo:
        await live.get_dispute("PP-D-404")

    message = str(excinfo.value)
    assert "status 404" in message
    assert "RESOURCE_NOT_FOUND" in message
    assert "The dispute was not found." in message
    assert "AUTH-TOKEN" not in message
    assert "secret-xyz" not in message
    assert excinfo.value.details == [{"field": "paypal_debug_id", "message": "debug-404"}]


@respx.mock
async def test_token_failure_is_sanitized(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(
        return_value=httpx.Response(
            401, json={"error": "invalid_client", "error_description": "bad secret"}
        )
    )

    with pytest.raises(UpstreamError) as excinfo:
        await live.get_dispute("PP-D-1")

    message = str(excinfo.value)
    assert "status 401" in message
    assert "secret-xyz" not in message
    assert "AUTH-TOKEN" not in message


@respx.mock
async def test_create_sandbox_dispute_sends_auth_assertion(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v1/customer/disputes").mock(
        return_value=httpx.Response(201, json=DISPUTE_JSON)
    )

    record = await live.create_sandbox_dispute(
        payer_id="YRZ829104KLA",
        order_id="5O190127TN364715T",
        reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        amount=Decimal("99.00"),
        stage=DisputeStage.CHARGEBACK,
        channel=DisputeChannel.EXTERNAL,
    )

    assert record.dispute_id == "PP-D-1"
    request = route.calls[0].request
    assertion = request.headers["paypal-auth-assertion"]
    assert assertion == build_auth_assertion("client-abc", "YRZ829104KLA")
    header_part, claims_part, empty_signature = assertion.split(".")
    assert empty_signature == ""
    assert _decode_jwt_part(header_part) == {"alg": "none", "typ": "JWT"}
    assert _decode_jwt_part(claims_part) == {
        "iss": "client-abc",
        "payer_id": "YRZ829104KLA",
    }
    assert json.loads(request.content) == {
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "dispute_amount": {"currency_code": "USD", "value": "99.00"},
        "dispute_life_cycle_stage": "CHARGEBACK",
        "dispute_channel": "EXTERNAL",
        "seller_transaction_id": "5O190127TN364715T",
    }


@respx.mock
async def test_create_order_parses_approval_link(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v2/checkout/orders").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "5O1EXAMPLEORDER",
                "status": "PAYER_ACTION_REQUIRED",
                "links": [
                    {
                        "rel": "payer-action",
                        "href": "https://sandbox.paypal.com/checkoutnow?token=5O1EXAMPLEORDER",
                    }
                ],
            },
        )
    )

    order = await live.create_order(
        payer_id="YRZ829104KLA", amount=Decimal("99.00"), description="Pro plan"
    )

    assert order.order_id == "5O1EXAMPLEORDER"
    assert order.subscription_id is None
    assert order.status == "PAYER_ACTION_REQUIRED"
    assert order.approval_url == ("https://sandbox.paypal.com/checkoutnow?token=5O1EXAMPLEORDER")
    assert order.amount == Decimal("99.00")
    assert order.currency == "USD"
    assert order.created_at.tzinfo is UTC
    # A created order is not a captured payment.
    assert order.lifecycle_stage == "CREATED"
    assert route.calls[0].request.url.path == "/v2/checkout/orders"
    body = json.loads(route.calls[0].request.content)
    assert body["intent"] == "CAPTURE"
    assert body["purchase_units"] == [
        {
            "amount": {"currency_code": "USD", "value": "99.00"},
            "description": "Pro plan",
            "custom_id": "YRZ829104KLA",
        }
    ]
    # application_context drives the real buyer approval redirect.
    assert body["application_context"]["user_action"] == "PAY_NOW"
    assert body["application_context"]["brand_name"]


@respx.mock
async def test_create_order_falls_back_to_sandbox_checkout_url(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v2/checkout/orders").mock(
        return_value=httpx.Response(201, json={"id": "ORDER-NO-LINKS"})
    )

    order = await live.create_order(payer_id="YRZ829104KLA", amount=Decimal("1.00"))

    assert route.calls[0].request.url.path == "/v2/checkout/orders"
    assert order.order_id == "ORDER-NO-LINKS"
    assert order.approval_url == ("https://www.sandbox.paypal.com/checkoutnow?token=ORDER-NO-LINKS")


@respx.mock
async def test_search_transactions_parses_reporting_payload(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v1/reporting/transactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "transaction_details": [_transaction("TXN-LIVE-1")],
                "total_pages": 1,
            },
        )
    )

    start = datetime(2024, 12, 25, tzinfo=UTC)
    end = datetime(2025, 1, 5, tzinfo=UTC)
    records = await live.search_transactions(payer_id="YRZ829104KLA", start=start, end=end)

    assert len(records) == 1
    assert records[0].transaction_id == "TXN-LIVE-1"
    assert records[0].amount == Decimal("99.00")
    assert records[0].currency == "USD"
    assert records[0].status == "COMPLETED"
    assert records[0].payer_id == "YRZ829104KLA"
    assert records[0].created_at == datetime(2025, 1, 1, tzinfo=UTC)
    params = route.calls[0].request.url.params
    assert "payer_id" not in params
    assert params["start_date"] == "2024-12-25T00:00:00+0000"
    assert params["end_date"] == "2025-01-05T00:00:00+0000"
    assert params["fields"] == "transaction_info,payer_info"
    assert params["page_size"] == "500"
    assert params["page"] == "1"


@respx.mock
async def test_search_transactions_chunks_a_365_day_window(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v1/reporting/transactions").mock(
        return_value=httpx.Response(200, json={"transaction_details": [], "total_pages": 1})
    )

    start = datetime(2024, 1, 1, tzinfo=UTC)
    end = start + timedelta(days=365)
    records = await live.search_transactions(payer_id="YRZ829104KLA", start=start, end=end)

    assert records == []
    expected_chunks = math.ceil(365 / 31)
    assert route.call_count == expected_chunks == 12
    windows: list[tuple[datetime, datetime]] = []
    for call in route.calls:
        params = call.request.url.params
        assert "payer_id" not in params
        assert params["page"] == "1"
        assert params["page_size"] == "500"
        first = _reporting_date(params["start_date"])
        last = _reporting_date(params["end_date"])
        assert timedelta(0) <= last - first <= timedelta(days=31)
        windows.append((first, last))

    assert windows[0][0] == start
    assert windows[-1][1] == end
    for previous, current in pairwise(windows):
        # Windows are contiguous with 1s gap to avoid duplicate boundary timestamp.
        assert current[0] == previous[1] + timedelta(seconds=1)


@respx.mock
async def test_search_transactions_follows_pagination_and_dedupes(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())

    def handler(request: httpx.Request) -> httpx.Response:
        page = int(request.url.params["page"])
        if page == 1:
            details = [_transaction("TXN-1"), _transaction("TXN-2")]
        else:
            details = [_transaction("TXN-2"), _transaction("TXN-3")]
        return httpx.Response(200, json={"transaction_details": details, "total_pages": 2})

    route = respx.get(f"{BASE}/v1/reporting/transactions").mock(side_effect=handler)

    records = await live.search_transactions(
        payer_id="YRZ829104KLA",
        start=datetime(2025, 1, 1, tzinfo=UTC),
        end=datetime(2025, 1, 10, tzinfo=UTC),
    )

    assert route.call_count == 2
    assert [call.request.url.params["page"] for call in route.calls] == ["1", "2"]
    assert [record.transaction_id for record in records] == [
        "TXN-1",
        "TXN-2",
        "TXN-3",
    ]


@respx.mock
async def test_search_transactions_dedupes_across_windows(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v1/reporting/transactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "transaction_details": [_transaction("TXN-DUP")],
                "total_pages": 1,
            },
        )
    )

    start = datetime(2025, 1, 1, tzinfo=UTC)
    records = await live.search_transactions(
        payer_id="YRZ829104KLA", start=start, end=start + timedelta(days=45)
    )

    assert route.call_count == 2
    assert [record.transaction_id for record in records] == ["TXN-DUP"]


@respx.mock
async def test_search_transactions_filters_payer_client_side(
    live: LivePayPalGateway,
) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v1/reporting/transactions").mock(
        return_value=httpx.Response(
            200,
            json={
                "transaction_details": [
                    _transaction("TXN-KEEP", payer_id="YRZ829104KLA"),
                    _transaction("TXN-DROP", payer_id="SOMEONE-ELSE"),
                ],
                "total_pages": 1,
            },
        )
    )

    records = await live.search_transactions(
        payer_id="YRZ829104KLA",
        start=datetime(2025, 1, 1, tzinfo=UTC),
        end=datetime(2025, 1, 10, tzinfo=UTC),
    )

    assert [record.transaction_id for record in records] == ["TXN-KEEP"]
    assert all("payer_id" not in call.request.url.params for call in route.calls)


# --------------------------------------------------------------------- order capture
_ORDER_JSON = {
    "id": "5O1EXAMPLEORDER",
    "status": "CREATED",
    "create_time": "2026-01-01T00:00:00Z",
    "purchase_units": [
        {"amount": {"currency_code": "USD", "value": "99.00"}},
    ],
    "links": [{"rel": "approve", "href": "https://sandbox.paypal.com/checkoutnow?token=5O1EX"}],
}

_CAPTURE_JSON = {
    "id": "5O1EXAMPLEORDER",
    "status": "COMPLETED",
    "payer": {"payer_id": "YRZ829104KLA"},
    "purchase_units": [
        {
            "amount": {"currency_code": "USD", "value": "99.00"},
            "payments": {
                "captures": [
                    {
                        "id": "3C679366HH908993F",
                        "status": "COMPLETED",
                        "create_time": "2026-01-02T03:04:05Z",
                        "amount": {"currency_code": "USD", "value": "99.00"},
                    }
                ]
            },
        }
    ],
}


@respx.mock
async def test_get_order_reads_authoritative_status(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.get(f"{BASE}/v2/checkout/orders/5O1EXAMPLEORDER").mock(
        return_value=httpx.Response(200, json=_ORDER_JSON)
    )

    order = await live.get_order("5O1EXAMPLEORDER")

    assert order.order_id == "5O1EXAMPLEORDER"
    assert order.status == "CREATED"
    assert order.lifecycle_stage == "CREATED"
    assert order.amount == Decimal("99.00")
    assert order.approval_url.endswith("token=5O1EX")
    assert route.calls[0].request.method == "GET"


@respx.mock
async def test_capture_order_returns_real_capture_id(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    route = respx.post(f"{BASE}/v2/checkout/orders/5O1EXAMPLEORDER/capture").mock(
        return_value=httpx.Response(201, json=_CAPTURE_JSON)
    )

    capture = await live.capture_order("5O1EXAMPLEORDER")

    assert capture.capture_id == "3C679366HH908993F"
    assert capture.capture_status == "COMPLETED"
    assert capture.completed is True
    assert capture.amount == Decimal("99.00")
    assert capture.currency == "USD"
    assert capture.payer_id == "YRZ829104KLA"
    assert capture.captured_at is not None
    assert capture.captured_at.tzinfo is not None
    assert route.calls[0].request.method == "POST"
    # Idempotency header is mandatory for a money-moving POST.
    assert route.calls[0].request.headers.get("PayPal-Request-Id")


@respx.mock
async def test_capture_order_surfaces_order_not_approved(live: LivePayPalGateway) -> None:
    """PayPal 422 ORDER_NOT_APPROVED must propagate, never look like success."""
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.post(f"{BASE}/v2/checkout/orders/5O1EXAMPLEORDER/capture").mock(
        return_value=httpx.Response(
            422,
            json={
                "name": "UNPROCESSABLE_ENTITY",
                "details": [
                    {"issue": "ORDER_NOT_APPROVED", "description": "Payer has not approved."}
                ],
            },
        )
    )

    with pytest.raises(UpstreamError):
        await live.capture_order("5O1EXAMPLEORDER")


@respx.mock
async def test_unapproved_capture_is_not_reported_as_completed(live: LivePayPalGateway) -> None:
    """A non-COMPLETED capture response must not satisfy ``completed``."""
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.post(f"{BASE}/v2/checkout/orders/5O1EXAMPLEORDER/capture").mock(
        return_value=httpx.Response(
            201,
            json={
                "id": "5O1EXAMPLEORDER",
                "status": "COMPLETED",
                "purchase_units": [
                    {
                        "payments": {
                            "captures": [
                                {
                                    "id": "CAP-PENDING",
                                    "status": "PENDING",
                                    "amount": {"currency_code": "USD", "value": "99.00"},
                                }
                            ]
                        }
                    }
                ],
            },
        )
    )

    capture = await live.capture_order("5O1EXAMPLEORDER")

    assert capture.capture_status == "PENDING"
    assert capture.completed is False


async def test_live_gateway_reports_sandbox_mode(live: LivePayPalGateway) -> None:
    """The adapter reports which network it points at, not a generic 'live'."""
    assert live.mode == "PAYPAL_SANDBOX"
    assert live.is_sandbox is True


# --------------------------------------------------- machine-readable issue codes
_ORDER_ID = "5O190127TN364715T"


@respx.mock
async def test_capture_failure_surfaces_order_not_approved_issue(live: LivePayPalGateway) -> None:
    """PayPal's ORDER_NOT_APPROVED token must reach the caller.

    Live-verified: PayPal answers an unapproved capture with 422 and the issue
    token inside ``details[]``, while ``message`` stays generic. Losing the token
    makes "buyer has not approved yet" indistinguishable from a hard failure.
    """
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.post(f"{BASE}/v2/checkout/orders/{_ORDER_ID}/capture").mock(
        return_value=httpx.Response(
            422,
            json={
                "name": "UNPROCESSABLE_ENTITY",
                "message": (
                    "The requested action could not be performed, semantically "
                    "incorrect, or failed business validation."
                ),
                "details": [
                    {
                        "issue": "ORDER_NOT_APPROVED",
                        "description": "Payer has not yet approved the Order for payment.",
                    }
                ],
            },
            headers={"paypal-debug-id": "debug-422"},
        )
    )

    with pytest.raises(UpstreamError) as excinfo:
        await live.capture_order(_ORDER_ID)

    error = excinfo.value
    assert error.has_issue("ORDER_NOT_APPROVED")
    assert error.upstream_status == 422
    assert "ORDER_NOT_APPROVED" in error.message


@respx.mock
async def test_duplicate_request_id_issue_is_reported_not_hidden(live: LivePayPalGateway) -> None:
    respx.post(TOKEN_URL).mock(return_value=_token_ok())
    respx.post(f"{BASE}/v2/checkout/orders").mock(
        return_value=httpx.Response(
            422,
            json={
                "name": "UNPROCESSABLE_ENTITY",
                "message": "Duplicate request id.",
                "details": [{"issue": "DUPLICATE_REQUEST_ID"}],
            },
        )
    )

    with pytest.raises(UpstreamError) as excinfo:
        await live.create_order(payer_id="YRZ829104KLA", amount=Decimal("99.00"), currency="USD")

    assert excinfo.value.has_issue("DUPLICATE_REQUEST_ID")


def test_error_payload_never_leaks_a_credential() -> None:
    from app.integrations.paypal.wire import extract_error_detail

    detail = extract_error_detail(
        {"name": "AUTH", "message": "bad client_secret for Bearer access_token"}
    )

    assert detail == "upstream error redacted"
