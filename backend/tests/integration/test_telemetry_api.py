"""Integration tests for the telemetry HTTP surface.

The app is created from the shared client fixture: real routers, real SQLite and
the real PAYPAL_SANDBOX gateway behind the app factory. Nothing is monkeypatched.

Ingest requests are signed exactly the way the TypeScript SDK signs them: the
HMAC covers the literal bytes sent over the wire, so these tests exercise the
real signature check rather than a bypass.
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from typing import Any

from httpx import AsyncClient, Response

from app.config import Settings
from app.security import compute_signature

API = "/api/v1"
PAYER_ID = "YRZ829104KLA"


def event_payload(
    event_id: str, event_type: str = "SESSION_AUTH", **overrides: Any
) -> dict[str, Any]:
    """Build one valid ingest body event; overrides replace the defaults."""
    payload: dict[str, Any] = {
        "event_type": event_type,
        "paypal_payer_id": PAYER_ID,
        "client_ip": "203.0.113.7",
        "device_fingerprint": "fp_device_alpha",
        "event_id": event_id,
        "occurred_at": "2025-03-01T12:00:00+00:00",
    }
    payload.update(overrides)
    return payload


def encode(payload: dict[str, Any]) -> bytes:
    """Serialise a body exactly once; the signature covers these bytes."""
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def sign(settings: Settings, raw: bytes, timestamp: str) -> str:
    """Compute the SDK signature for a timestamp and a raw body."""
    return compute_signature(settings.verdictpay_signing_secret, timestamp, raw)


def signed_headers(
    settings: Settings, raw: bytes, *, timestamp: str | None = None
) -> dict[str, str]:
    """Return the ingest headers with a valid signature for these exact bytes."""
    stamp = timestamp if timestamp is not None else str(int(time.time()))
    return {
        "Content-Type": "application/json",
        "X-VerdictPay-Timestamp": stamp,
        "X-VerdictPay-Signature": sign(settings, raw, stamp),
    }


async def post_events(
    client: AsyncClient,
    settings: Settings,
    payload: dict[str, Any],
    *,
    timestamp: str | None = None,
) -> Response:
    """POST a signed ingest body (single event or batch)."""
    raw = encode(payload)
    return await client.post(
        f"{API}/telemetry/events",
        content=raw,
        headers=signed_headers(settings, raw, timestamp=timestamp),
    )


async def chain_event_count(client: AsyncClient) -> int:
    """Read the current stream length through the verify endpoint."""
    response = await client.get(f"{API}/telemetry/chain/{PAYER_ID}/verify")
    assert response.status_code == 200
    return int(response.json()["event_count"])


async def test_signed_batch_of_four_ingests_and_verifies(
    client: AsyncClient, settings: Settings
) -> None:
    events = [
        event_payload("evt_000", "TOS_ACCEPTED", tos_version="v2.4-2026-01"),
        event_payload("evt_001", "SESSION_AUTH"),
        event_payload(
            "evt_002",
            "ASSET_DELIVERED",
            resource_id="q3_financial_model.xlsx",
            resource_sha256="a" * 64,
        ),
        event_payload("evt_003", "USAGE_METERED", units_consumed=42000),
    ]

    response = await post_events(client, settings, {"events": events})

    assert response.status_code == 200
    body = response.json()
    assert body["accepted"] == 4
    assert body["duplicates"] == 0
    assert len(body["events"]) == 4
    assert [event["sequence"] for event in body["events"]] == [0, 1, 2, 3]
    assert body["events"][0]["prev_hash"] == "0" * 64
    assert body["events"][1]["prev_hash"] == body["events"][0]["chain_hash"]
    assert body["events"][2]["prev_hash"] == body["events"][1]["chain_hash"]
    assert body["events"][3]["prev_hash"] == body["events"][2]["chain_hash"]
    assert body["events"][0]["created_at"] == "2025-03-01T12:00:00Z"
    assert body["chain"]["payer_id"] == PAYER_ID
    assert body["chain"]["valid"] is True
    assert body["chain"]["event_count"] == 4
    assert body["chain"]["head_hash"] == body["events"][3]["chain_hash"]

    verify = await client.get(f"{API}/telemetry/chain/{PAYER_ID}/verify")

    assert verify.status_code == 200
    verification = verify.json()
    assert verification["valid"] is True
    assert verification["event_count"] == 4
    assert verification["head_hash"] == body["chain"]["head_hash"]
    assert verification["broken_at_sequence"] is None
    assert verification["breaks"] == []


async def test_signed_single_event_ingest_and_replay_dedupes(
    client: AsyncClient, settings: Settings
) -> None:
    single = event_payload("evt_single", "SESSION_AUTH")

    first = await post_events(client, settings, single)

    assert first.status_code == 200
    first_body = first.json()
    assert first_body["accepted"] == 1
    assert first_body["duplicates"] == 0
    assert len(first_body["events"]) == 1
    assert first_body["events"][0]["sequence"] == 0

    replay = await post_events(client, settings, single)

    assert replay.status_code == 200
    replay_body = replay.json()
    assert replay_body["accepted"] == 0
    assert replay_body["duplicates"] == 1
    assert replay_body["events"][0]["id"] == first_body["events"][0]["id"]
    assert replay_body["chain"]["event_count"] == 1
    assert replay_body["chain"]["head_hash"] == first_body["chain"]["head_hash"]


async def test_unsigned_ingest_is_rejected(client: AsyncClient) -> None:
    response = await client.post(
        f"{API}/telemetry/events",
        json=event_payload("evt_unsigned"),
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "signature_required"
    assert body["error"]["message"] == "Signed telemetry is required."
    assert body["error"]["details"] == []
    assert await chain_event_count(client) == 0


async def test_signature_without_timestamp_is_rejected(
    client: AsyncClient, settings: Settings
) -> None:
    raw = encode(event_payload("evt_no_timestamp"))
    response = await client.post(
        f"{API}/telemetry/events",
        content=raw,
        headers={
            "Content-Type": "application/json",
            "X-VerdictPay-Signature": sign(settings, raw, str(int(time.time()))),
        },
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "signature_required"
    assert body["error"]["message"] == "Signed telemetry is required."
    assert await chain_event_count(client) == 0


async def test_tampered_body_is_rejected(client: AsyncClient, settings: Settings) -> None:
    signed_payload = event_payload("evt_tampered", units_consumed=1)
    tampered_payload = event_payload("evt_tampered", units_consumed=999_999)
    signed_raw = encode(signed_payload)
    timestamp = str(int(time.time()))

    response = await client.post(
        f"{API}/telemetry/events",
        content=encode(tampered_payload),
        headers={
            "Content-Type": "application/json",
            "X-VerdictPay-Timestamp": timestamp,
            "X-VerdictPay-Signature": sign(settings, signed_raw, timestamp),
        },
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "signature_invalid"
    assert body["error"]["message"] == "Signature could not be verified."
    assert body["error"]["details"] == [
        {"field": "X-VerdictPay-Signature", "message": "signature_mismatch"}
    ]
    assert await chain_event_count(client) == 0


async def test_stale_timestamp_is_rejected(client: AsyncClient, settings: Settings) -> None:
    stale = str(int(time.time()) - 10_000)

    response = await post_events(
        client,
        settings,
        event_payload("evt_stale"),
        timestamp=stale,
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "signature_invalid"
    assert body["error"]["details"] == [
        {"field": "X-VerdictPay-Signature", "message": "timestamp_outside_tolerance"}
    ]
    assert await chain_event_count(client) == 0


async def test_malformed_timestamp_is_rejected(client: AsyncClient, settings: Settings) -> None:
    response = await post_events(
        client,
        settings,
        event_payload("evt_malformed_timestamp"),
        timestamp="not-a-number",
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "signature_invalid"
    assert body["error"]["details"] == [
        {"field": "X-VerdictPay-Signature", "message": "malformed_timestamp"}
    ]
    assert await chain_event_count(client) == 0


async def test_signed_request_with_bad_api_key_is_unauthorized(
    client: AsyncClient, settings: Settings
) -> None:
    raw = encode(event_payload("evt_bad_key"))

    response = await client.post(
        f"{API}/telemetry/events",
        content=raw,
        headers={**signed_headers(settings, raw), "X-API-Key": "vp_wrong_key"},
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "unauthorized"
    assert body["error"]["message"] == "Invalid API key."


async def test_missing_api_key_returns_401_envelope(client: AsyncClient) -> None:
    response = await client.get(
        f"{API}/telemetry/chain/{PAYER_ID}/verify",
        headers={"X-API-Key": ""},
    )

    assert response.status_code == 401
    body = response.json()
    assert body["error"]["code"] == "unauthorized"
    assert body["error"]["message"] == "Provide X-API-Key or a Bearer token."
    assert body["error"]["details"] == []
    assert isinstance(body["error"]["request_id"], str)
    assert len(body["error"]["request_id"]) > 0


async def test_get_endpoints_only_require_the_api_key(client: AsyncClient) -> None:
    response = await client.get(f"{API}/telemetry/chain/{PAYER_ID}/verify")

    assert response.status_code == 200
    assert response.json()["payer_id"] == PAYER_ID


async def test_oversized_batch_returns_422_and_stores_nothing(
    client: AsyncClient, settings: Settings
) -> None:
    events = [event_payload(f"evt_bulk_{index:03d}") for index in range(501)]

    response = await post_events(client, settings, {"events": events})

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["message"] == "Request validation failed."
    assert len(body["error"]["details"]) > 0
    assert any("events" in detail["field"] for detail in body["error"]["details"])

    verify = await client.get(f"{API}/telemetry/chain/{PAYER_ID}/verify")
    assert verify.json()["event_count"] == 0
    assert verify.json()["head_hash"] == "0" * 64


async def test_timeline_summary_is_exact(client: AsyncClient, settings: Settings) -> None:
    events = [
        event_payload(
            "evt_tos",
            "TOS_ACCEPTED",
            tos_version="v2.4-2026-01",
            occurred_at="2025-03-01T12:00:00+00:00",
        ),
        event_payload("evt_login_one", "SESSION_AUTH", occurred_at="2025-03-01T12:01:00+00:00"),
        event_payload(
            "evt_login_two",
            "SESSION_AUTH",
            client_ip="198.51.100.9",
            device_fingerprint="fp_device_beta",
            occurred_at="2025-03-01T12:02:00+00:00",
        ),
        event_payload(
            "evt_asset",
            "ASSET_DELIVERED",
            client_ip="198.51.100.9",
            device_fingerprint="fp_device_beta",
            resource_id="q3_financial_model.xlsx",
            resource_sha256="a" * 64,
            occurred_at="2025-03-01T12:03:00+00:00",
        ),
        event_payload(
            "evt_usage",
            "USAGE_METERED",
            units_consumed=42000,
            occurred_at="2025-03-01T12:04:00+00:00",
        ),
    ]
    ingest = await post_events(client, settings, {"events": events})
    assert ingest.status_code == 200
    assert ingest.json()["accepted"] == 5

    response = await client.get(f"{API}/customers/{PAYER_ID}/timeline")

    assert response.status_code == 200
    body = response.json()
    assert body["payer_id"] == PAYER_ID
    assert [event["sequence"] for event in body["events"]] == [0, 1, 2, 3, 4]
    assert body["summary"] == {
        "first_seen": "2025-03-01T12:00:00Z",
        "last_seen": "2025-03-01T12:04:00Z",
        "distinct_ips": 2,
        "distinct_devices": 2,
        "total_units": 42000,
        "assets_delivered": 1,
        "login_count": 2,
        "tos_versions": ["v2.4-2026-01"],
    }
    assert body["chain"]["valid"] is True
    assert body["chain"]["event_count"] == 5
    assert body["chain"]["head_hash"] == body["events"][4]["chain_hash"]


async def test_timeline_for_unknown_payer_is_empty(client: AsyncClient) -> None:
    response = await client.get(f"{API}/customers/UNKNOWN_PAYER/timeline")

    assert response.status_code == 200
    body = response.json()
    assert body["payer_id"] == "UNKNOWN_PAYER"
    assert body["events"] == []
    assert body["summary"] == {
        "first_seen": None,
        "last_seen": None,
        "distinct_ips": 0,
        "distinct_devices": 0,
        "total_units": 0,
        "assets_delivered": 0,
        "login_count": 0,
        "tos_versions": [],
    }
    assert body["chain"]["valid"] is True
    assert body["chain"]["event_count"] == 0
    assert body["chain"]["head_hash"] == "0" * 64


async def test_invalid_event_payload_is_rejected(client: AsyncClient, settings: Settings) -> None:
    invalid = event_payload("evt_invalid", resource_sha256="not-a-sha256")

    response = await post_events(client, settings, invalid)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert any("resource_sha256" in detail["field"] for detail in body["error"]["details"])


async def test_invalid_json_body_is_rejected(client: AsyncClient, settings: Settings) -> None:
    raw = b'{"events": ['
    response = await client.post(
        f"{API}/telemetry/events",
        content=raw,
        headers=signed_headers(settings, raw),
    )

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["details"][0]["field"] == "body"


async def test_future_occurred_at_is_rejected_by_the_service(
    client: AsyncClient, settings: Settings
) -> None:
    future = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    attempted = event_payload("evt_future", occurred_at=future)

    response = await post_events(client, settings, attempted)

    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    assert body["error"]["message"] == "occurred_at is more than 5 minutes in the future."
    assert body["error"]["details"] == [
        {
            "field": "occurred_at",
            "message": "occurred_at must not be more than 5 minutes ahead of now.",
            "code": "future_timestamp",
        }
    ]

    verify = await client.get(f"{API}/telemetry/chain/{PAYER_ID}/verify")
    assert verify.json()["event_count"] == 0
