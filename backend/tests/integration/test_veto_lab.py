"""Veto Lab end-to-end: three negative controls veto, hardened paths are allowed."""

from __future__ import annotations

import pytest

from app.errors import SentinelVetoError
from app.integrations.paypal.live import LivePayPalGateway
from app.main import create_app
from app.oracle import manifest as manifest_module
from app.sentinel import token as sentinel_token


async def test_veto_lab_runs_three_controls(client) -> None:
    response = await client.post("/api/v1/veto-lab/run")
    assert response.status_code == 200, response.text
    body = response.json()
    controls = {control["id"]: control for control in body["controls"]}
    assert set(controls) == {"naive_cliff", "toolkit_hazards", "llm_attack"}

    naive = controls["naive_cliff"]["cases"]
    assert naive[0]["sentinel"]["banner"] == "EXIT CODE 2 — VETO"
    assert "VETO_HVD_CLIFF_BREACH" in naive[0]["sentinel"]["veto_codes"]
    assert naive[1]["sentinel"]["veto_codes"] == ["VETO_VAMP_CLIFF_BREACH"]
    for case in naive:
        assert case["hardened"]["banner"] == "EXIT CODE 0 — ALLOW (DRY RUN · TOKEN ISSUED)"
        assert len(case["hardened"]["hmac_approval_token"]["sig_hmac_sha256"]) == 64

    toolkit = {case["id"]: case for case in controls["toolkit_hazards"]["cases"]}
    assert toolkit["acl_bypass"]["unguarded"]["executed"] is True
    assert "VETO_TOOLKIT_ACL_BYPASS" in toolkit["acl_bypass"]["sentinel"]["veto_codes"]
    assert "VETO_PATH_TRAVERSAL_BLOCKED" in toolkit["path_traversal"]["sentinel"]["veto_codes"]
    assert "VETO_PATH_TRAVERSAL_BLOCKED" in toolkit["query_leakage"]["sentinel"]["veto_codes"]
    assert controls["toolkit_hazards"]["stale_oauth"]["refreshed"] is False

    llm = controls["llm_attack"]
    assert llm["worker"]["credential_env_leaks"] == []
    assert llm["worker"]["source"] == "scripted_no_llm_key"  # tests never call a live model
    assert {"VETO_PROMPT_INJECTION_BLOCKED", "VETO_CE3_WINDOW_OUT_OF_RANGE"} <= set(
        llm["sentinel"]["veto_codes"]
    )
    assert llm["hardened"]["exit_code"] == 0
    assert body["paypal_probe"]["paypal_debug_id"] == "fake-debug-id"

    chain = await client.get("/api/v1/telemetry/chain/SENTINEL-AUDIT/verify")
    assert chain.json()["valid"] is True
    assert chain.json()["event_count"] >= 9


async def test_sentinel_endpoint_vetoes_untrusted_proposal(client) -> None:
    response = await client.post(
        "/api/v1/veto-lab/sentinel",
        json={
            "dispute_id": "../../x",
            "proposed_action": "ACCEPT_CLAIM",
            "dispute_amount_minor": 1,
        },
    )
    assert response.status_code == 200
    assert response.json()["exit_code"] == 2


async def test_veto_lab_tokens_can_never_authorise_a_live_write(client, settings) -> None:
    """Regression: the public lab endpoints must not be an ApprovalToken oracle."""
    clean = {
        "proposal_id": "lab-preview-1",
        "dispute_id": "PP-D-LAB-PREVIEW",
        "payment_rail": "PAYPAL_WALLET",
        "dispute_channel": "INTERNAL",
        "dispute_life_cycle_stage": "INQUIRY",
        "reason": "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
        "proposed_action": "SEND_MESSAGE",
        "dispute_amount_minor": 4_900,
        "currency": "USD",
        "hateoas_rels": ["send-message", "make-offer"],
    }
    response = await client.post("/api/v1/veto-lab/sentinel", json=clean)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["exit_code"] == 0
    preview_token = body["hmac_approval_token"]
    assert preview_token["scope"] == sentinel_token.SCOPE_PREVIEW

    # The lab token fails verification even with the real signing secret.
    with pytest.raises(sentinel_token.ApprovalError):
        sentinel_token.verify(
            preview_token,
            secret=settings.verdictpay_signing_secret,
            action="SEND_MESSAGE",
            dispute_id="PP-D-LAB-PREVIEW",
        )

    # And the gateway refuses the write before it ever reaches the network.
    live = LivePayPalGateway(settings)
    reset = sentinel_token.current_approval.set(preview_token)
    try:
        with pytest.raises(SentinelVetoError) as raised:
            await live.send_message("PP-D-LAB-PREVIEW", "hello")
    finally:
        sentinel_token.current_approval.reset(reset)
        await live.close()
    assert raised.value.details[0]["veto_code"] == "VETO_MISSING_APPROVAL_TOKEN"

    # The same holds for tokens the full lab run hands out for its hardened paths.
    run = await client.post("/api/v1/veto-lab/run")
    assert run.status_code == 200, run.text
    hardened_tokens = [
        case["hardened"]["hmac_approval_token"]
        for control in run.json()["controls"]
        for case in control.get("cases") or []
        if case.get("hardened", {}).get("hmac_approval_token")
    ]
    assert hardened_tokens
    for hardened in hardened_tokens:
        assert hardened["scope"] == sentinel_token.SCOPE_PREVIEW
        with pytest.raises(sentinel_token.ApprovalError):
            sentinel_token.verify(
                hardened,
                secret=settings.verdictpay_signing_secret,
                action=hardened["action"],
                dispute_id=hardened["dispute_id"],
            )


async def test_dispute_action_is_audited_and_tokened(client) -> None:
    opened = await client.post(
        "/api/v1/sandbox/dispute",
        json={"payer_id": "YRZ829104KLA", "order_id": "5O190127TN364715T"},
    )
    dispute_id = opened.json()["dispute"]["dispute_id"]
    response = await client.post(
        f"/api/v1/disputes/{dispute_id}/actions/SEND_MESSAGE", json={"note": "Hello"}
    )
    assert response.status_code == 200, response.text
    chain = await client.get("/api/v1/telemetry/chain/SENTINEL-AUDIT/verify")
    assert chain.json()["event_count"] == 1


def test_boot_fails_closed_on_tampered_manifest(
    settings, monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    bad = tmp_path / "rules.json"
    bad.write_text('{"hvd": {"threshold_ppm": 1}}')
    monkeypatch.setattr(manifest_module, "MANIFEST_PATH", bad)
    monkeypatch.setattr(manifest_module, "_CACHE", {})
    monkeypatch.setattr(manifest_module, "get_manifest", lambda: manifest_module.load_manifest(bad))
    import app.main as main_module

    monkeypatch.setattr(main_module, "get_manifest", manifest_module.get_manifest)
    with pytest.raises(SystemExit) as raised:
        create_app(settings)
    assert raised.value.code == 2
