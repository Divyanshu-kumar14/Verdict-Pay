"""Proves the AI narrative is wired end to end and labelled honestly.

No real model is called: a fake OpenAI-compatible endpoint returns fact-safe
prose. The dossier footer must say "ai:<model>" when the model answered and
"template" when it failed.
"""

from __future__ import annotations

from io import BytesIO

import httpx
import pytest
import respx
from httpx import ASGITransport, AsyncClient
from pypdf import PdfReader

from app.config import Settings
from app.main import create_app

MODEL = "test-model"
ENDPOINT = "http://fake-llm/v1/chat/completions"
AI_PROSE = (
    "Aurora Analytics delivered the purchased digital asset and the buyer consumed the "
    "metered service after accepting the Terms of Service."
)


def _settings(tmp_path, *, local_llm: bool) -> Settings:
    return Settings(
        app_env="test",
        database_url=f"sqlite+aiosqlite:///{tmp_path / 'aiflow.db'}",
        paypal_mode="PAYPAL_SANDBOX",
        llm_mode="openai" if local_llm else "template",
        llm_base_url="http://fake-llm/v1" if local_llm else "",
        llm_model=MODEL,
        openai_api_key="",
        verdictpay_api_key="ai_flow_key",
        rate_limit_per_minute=10_000,
    )


async def _open_case(client: AsyncClient) -> str:
    checkout = await client.post(
        "/api/v1/sandbox/checkout", json={"plan": "pro", "payer_id": "YRZ829104KLA"}
    )
    order = checkout.json()
    await client.post(
        "/api/v1/sandbox/usage",
        json={
            "payer_id": order["payer_id"],
            "order_id": order["order_id"],
            "subscription_id": order["subscription_id"],
            "logins": 15,
            "tokens": 42_000,
        },
    )
    dispute = await client.post(
        "/api/v1/sandbox/dispute",
        json={
            "payer_id": order["payer_id"],
            "order_id": order["order_id"],
            "reason_code": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
            "stage": "CHARGEBACK",
            "channel": "INTERNAL",
            "amount_usd": "99.00",
        },
    )
    return dispute.json()["dispute"]["dispute_id"]


async def _dossier_text(client: AsyncClient, dispute_id: str) -> str:
    response = await client.get(f"/api/v1/disputes/{dispute_id}/dossier.pdf")
    assert response.status_code == 200
    reader = PdfReader(BytesIO(response.content))
    raw = "\n".join(page.extract_text() or "" for page in reader.pages)
    return " ".join(raw.split())


@pytest.mark.asyncio
@respx.mock
async def test_ai_generated_narrative_is_labelled_in_the_dossier(tmp_path) -> None:
    route = respx.post(ENDPOINT).mock(
        return_value=httpx.Response(200, json={"choices": [{"message": {"content": AI_PROSE}}]})
    )
    app = create_app(_settings(tmp_path, local_llm=True))
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.headers["X-API-Key"] = "ai_flow_key"
            dispute_id = await _open_case(client)
            action = await client.post(f"/api/v1/disputes/{dispute_id}/actions/PROVIDE_EVIDENCE", json={"note": "ai flow"})
            assert action.status_code in {200, 202}
            text = await _dossier_text(client, dispute_id)

    assert route.called
    assert f"Narrative source: ai:{MODEL}" in text
    assert "validated against the fact pack" in text


@pytest.mark.asyncio
@respx.mock
async def test_model_failure_falls_back_and_is_labelled_as_template(tmp_path) -> None:
    respx.post(ENDPOINT).mock(return_value=httpx.Response(500, json={"error": "boom"}))
    app = create_app(_settings(tmp_path, local_llm=True))
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.headers["X-API-Key"] = "ai_flow_key"
            dispute_id = await _open_case(client)
            await client.post(f"/api/v1/disputes/{dispute_id}/actions/PROVIDE_EVIDENCE", json={"note": "ai flow"})
            text = await _dossier_text(client, dispute_id)

    assert "Narrative source: template" in text


@pytest.mark.asyncio
async def test_template_mode_is_labelled_template(tmp_path) -> None:
    app = create_app(_settings(tmp_path, local_llm=False))
    async with app.router.lifespan_context(app):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            client.headers["X-API-Key"] = "ai_flow_key"
            dispute_id = await _open_case(client)
            await client.post(f"/api/v1/disputes/{dispute_id}/actions/PROVIDE_EVIDENCE", json={"note": "ai flow"})
            text = await _dossier_text(client, dispute_id)

    assert "Narrative source: template" in text