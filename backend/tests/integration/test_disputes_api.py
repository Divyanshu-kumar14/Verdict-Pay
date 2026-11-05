"""Dispute queue, case room, triage and action-guard contract tests."""

from __future__ import annotations

import asyncio


async def _open_dispute(client, *, payer_id: str = "YRZ829104KLA", order_id: str = "5O190127TN364715T") -> dict:
    response = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": payer_id, "order_id": order_id},
    )
    assert response.status_code == 200
    return response.json()["dispute"]


async def _seed_telemetry(client, payer_id: str = "YRZ829104KLA") -> None:
    response = await client.post(
        "/api/v1/sandbox/usage",
        json={"payer_id": payer_id, "order_id": "5O190127TN364715T"},
    )
    assert response.status_code == 200


async def test_list_pagination_meta_is_exact(client) -> None:
    for _ in range(3):
        await _open_dispute(client)

    page_one = (await client.get("/api/v1/disputes?page=1&per_page=2")).json()
    assert page_one["meta"] == {"total": 3, "page": 1, "per_page": 2, "total_pages": 2}
    assert [row["dispute_id"] for row in page_one["data"]] == ["PP-D-40003", "PP-D-40002"]

    page_two = (await client.get("/api/v1/disputes?page=2&per_page=2")).json()
    assert page_two["meta"] == {"total": 3, "page": 2, "per_page": 2, "total_pages": 2}
    assert [row["dispute_id"] for row in page_two["data"]] == ["PP-D-40001"]

    beyond = (await client.get("/api/v1/disputes?page=9&per_page=2")).json()
    assert beyond["data"] == []
    assert beyond["meta"]["total_pages"] == 2


async def test_list_filters_and_auth(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)

    by_stage = (await client.get("/api/v1/disputes?stage=INQUIRY")).json()
    assert by_stage["meta"]["total"] == 1
    assert by_stage["data"][0]["dispute_id"] == created["dispute_id"]

    by_claim = (await client.get("/api/v1/disputes?stage=CHARGEBACK")).json()
    assert by_claim["meta"]["total"] == 0

    by_action = (await client.get("/api/v1/disputes?recommended_action=DEFLECT_INQUIRY")).json()
    assert by_action["meta"]["total"] == 1

    by_monitor = (await client.get("/api/v1/disputes?recommended_action=MONITOR")).json()
    assert by_monitor["meta"]["total"] == 0

    unauthorized = await client.get("/api/v1/disputes", headers={"X-API-Key": ""})
    assert unauthorized.status_code == 401
    assert unauthorized.json()["error"]["code"] == "unauthorized"


async def test_detail_has_six_signals_and_hateoas_actions(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    response = await client.get(f"/api/v1/disputes/{created['dispute_id']}")
    assert response.status_code == 200
    detail = response.json()

    assert [signal["key"] for signal in detail["win_probability"]["signals"]] == [
        "tos_accepted",
        "ip_match",
        "asset_delivered",
        "usage_metered",
        "chain_verified",
        "ce3_historical_match",
    ]
    assert len(detail["facts"]["signals"]) == 6

    actions = {item["action"]: item for item in detail["allowed_actions"]}
    assert set(actions) == {"SEND_MESSAGE", "MAKE_OFFER", "ACCEPT_CLAIM", "PROVIDE_EVIDENCE"}
    assert actions["SEND_MESSAGE"]["allowed"] is True
    assert actions["MAKE_OFFER"]["allowed"] is True
    assert actions["ACCEPT_CLAIM"]["allowed"] is True
    assert actions["PROVIDE_EVIDENCE"]["allowed"] is False
    assert actions["PROVIDE_EVIDENCE"]["reason"] == "require-evidence_link_missing"
    assert actions["PROVIDE_EVIDENCE"]["fee_usd"] == "0.00"
    assert actions["ACCEPT_CLAIM"]["fee_usd"] == "0.00"
    assert actions["SEND_MESSAGE"]["paypal_link"].endswith("/send-message")


async def test_illegal_provide_evidence_in_inquiry_is_422(client) -> None:
    created = await _open_dispute(client)
    response = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/PROVIDE_EVIDENCE",
        json={},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "illegal_dispute_action"
    assert error["details"] == [
        {
            "action": "PROVIDE_EVIDENCE",
            "stage": "INQUIRY",
            "reason": "require-evidence_link_missing",
        }
    ]


async def test_unknown_action_value_is_422_validation(client) -> None:
    created = await _open_dispute(client)
    response = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/refund-all",
        json={},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


async def test_unknown_dispute_is_404(client) -> None:
    response = await client.get("/api/v1/disputes/PP-D-99999")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"

    action = await client.post(
        "/api/v1/disputes/PP-D-99999/actions/SEND_MESSAGE", json={}
    )
    assert action.status_code == 404
    assert action.json()["error"]["code"] == "not_found"


async def test_triage_endpoint_is_stable(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    first = (await client.post(f"/api/v1/disputes/{created['dispute_id']}/triage")).json()
    second = (await client.post(f"/api/v1/disputes/{created['dispute_id']}/triage")).json()

    assert first["dispute_id"] == created["dispute_id"]
    assert first["recommended_action"] == "DEFLECT_INQUIRY"
    assert first["win_probability"]["score"] == 0.95
    assert first["breakdown"]["ev_fight_usd"] == "-5.70"
    assert first["breakdown"] == second["breakdown"]
    assert first["win_probability"] == second["win_probability"]
    assert first["allowed_actions"] == second["allowed_actions"]
    assert first["rationale"] == second["rationale"]


async def test_send_message_action_persists_audit_row(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    response = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/SEND_MESSAGE",
        json={"idempotency_key": "msg-1"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "EXECUTED"
    assert body["action"] == "SEND_MESSAGE"
    assert body["case"]["status"] == "WAITING_FOR_SELLER_RESPONSE"
    assert body["upstream"]["dispute_id"] == created["dispute_id"]
    assert body["upstream"]["message_id"] == "MSG-001"
    assert body["upstream"]["message"].startswith("Hello, this message responds to dispute")
    assert "203.0.113.42" in body["upstream"]["message"]
    assert "42000 metered units" in body["upstream"]["message"]
    assert len(body["upstream"]["message"]) <= 2000

    detail = (await client.get(f"/api/v1/disputes/{created['dispute_id']}")).json()
    assert len(detail["actions"]) == 1
    assert detail["actions"][0]["action_id"] == body["action_id"]
    assert detail["actions"][0]["action"] == "SEND_MESSAGE"
    assert detail["actions"][0]["status"] == "EXECUTED"
    assert detail["actions"][0]["created_at"].endswith(("Z", "+00:00"))
    assert body["case"]["created_at"].endswith(("Z", "+00:00"))
    assert body["case"]["updated_at"].endswith(("Z", "+00:00"))


async def test_send_message_replay_is_idempotent(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    gateway = client.app.state.gateway
    first = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/SEND_MESSAGE",
        json={"idempotency_key": "msg-replay"},
    )
    sent_after_first = sum(1 for name, _ in gateway.calls if name == "send_message")
    second = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/SEND_MESSAGE",
        json={"idempotency_key": "msg-replay"},
    )
    sent_after_second = sum(1 for name, _ in gateway.calls if name == "send_message")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json()["action_id"] == second.json()["action_id"]
    assert sent_after_first == 1
    assert sent_after_second == 1


async def test_concurrent_same_idempotency_key_claims_once(client) -> None:
    """The key is claimed before dispatch: one gateway call, no 500, no 409 storm."""
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    gateway = client.app.state.gateway
    path = f"/api/v1/disputes/{created['dispute_id']}/actions/SEND_MESSAGE"

    first, second = await asyncio.gather(
        client.post(path, json={"idempotency_key": "qa-race-idem-1"}),
        client.post(path, json={"idempotency_key": "qa-race-idem-1"}),
    )
    codes = sorted([first.status_code, second.status_code])
    assert 500 not in codes
    assert codes in ([200, 200], [200, 409])

    winner = first if first.status_code == 200 else second
    loser = second if first.status_code == 200 else first
    assert winner.json()["status"] == "EXECUTED"
    if loser.status_code == 409:
        assert loser.json()["error"]["code"] == "action_in_progress"
        assert loser.json()["error"]["message"] == "This action is already being executed."
    else:
        assert loser.json()["action_id"] == winner.json()["action_id"]

    assert sum(1 for name, _ in gateway.calls if name == "send_message") == 1

    detail = (await client.get(f"/api/v1/disputes/{created['dispute_id']}")).json()
    assert len(detail["actions"]) == 1
    assert detail["actions"][0]["action_id"] == winner.json()["action_id"]
    assert detail["actions"][0]["status"] == "EXECUTED"

    # a brand-new key is a genuinely new action and does hit PayPal again
    follow_up = await client.post(path, json={"idempotency_key": "qa-race-idem-2"})
    assert follow_up.status_code == 200
    assert follow_up.json()["action_id"] != winner.json()["action_id"]
    assert follow_up.json()["upstream"]["message_id"] == "MSG-002"
    assert sum(1 for name, _ in gateway.calls if name == "send_message") == 2


async def test_make_offer_uses_configured_ratio(client) -> None:
    await _seed_telemetry(client)
    created = await _open_dispute(client)
    response = await client.post(
        f"/api/v1/disputes/{created['dispute_id']}/actions/MAKE_OFFER",
        json={"note": "goodwill"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "EXECUTED"
    assert body["upstream"]["offer_amount"] == {"currency_code": "USD", "value": "29.70"}
    assert body["case"]["status"] == "WAITING_FOR_SELLER_RESPONSE"
