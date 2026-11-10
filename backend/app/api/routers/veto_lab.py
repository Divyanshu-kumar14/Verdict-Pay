"""Veto Lab: three executable negative controls, side by side.

POST /veto-lab/run executes, live:

1. ``naive_cliff`` — a float, count-only triage candidate escalates into the
   PayPal HVD (dollar) and Visa VAMP (count) cliffs; the Sentinel vetoes.
2. ``toolkit_hazards`` — the recorded run of ``tools/toolkit-probe`` against the
   real ``@paypal/agent-toolkit`` code (ACL bypass, ``../`` traversal, query
   leakage) next to the same calls evaluated by the Sentinel now.
3. ``llm_attack`` — an uncredentialed worker subprocess asks a live LLM to act
   on a hostile buyer thread; the Sentinel vetoes the model's proposal.

Each control also runs the hardened alternative, which the Sentinel allows
(exit code 0, signed ApprovalToken). Every verdict is audited on the
SENTINEL-AUDIT chain. Lab disputes are synthetic (``PP-D-LAB-*``) and no
PayPal *write* is made; the only PayPal call is a read whose ``debug_id``
proves the sandbox connection is live.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Request

from app.api.deps import MerchantDep, SessionDep, SettingsDep
from app.errors import UpstreamError
from app.oracle.manifest import get_manifest
from app.sentinel import bridge, candidate_naive, token

router = APIRouter(tags=["veto-lab"])

FIXTURE = Path(__file__).resolve().parents[2] / "sentinel" / "fixtures" / "toolkit_probe.json"
WORKER = Path(__file__).resolve().parents[2] / "worker" / "live_llm_attack.py"
LLM_CACHE_SECONDS = 600
_llm_cache: dict[str, tuple[float, dict[str, Any]]] = {}
TOOL_TO_ACTION = {
    "accept_dispute_claim": "ACCEPT_CLAIM",
    "provide_evidence": "PROVIDE_EVIDENCE",
    "make_offer": "MAKE_OFFER",
    "send_message": "SEND_MESSAGE",
    "escalate": "ESCALATE",
    "get_dispute": "GET_DISPUTE",
}
CARD = "cred-lab-visa-4242"
ANCHORS = {
    "ip_hash": "ip-lab-1",
    "device_id_hash": "dev-lab-1",
    "account_login_id_hash": "login-lab-1",
    "shipping_address_hash": "ship-lab-1",
}


def _lab_orders(now: datetime) -> dict[str, dict[str, Any]]:
    """O-119D settles 119d 23h 59m 59s before the dispute: one second too recent."""
    return {
        "O-119D": {
            "order_id": "O-119D",
            "settled_at": (now - timedelta(days=120) + timedelta(seconds=1)).isoformat(),
            "payment_credential_hash": CARD,
            **ANCHORS,
        },
        "O-200D": {
            "order_id": "O-200D",
            "settled_at": (now - timedelta(days=200)).isoformat(),
            "payment_credential_hash": CARD,
            **ANCHORS,
        },
    }


async def _judge(
    session: Any, settings: Any, merchant_id: str, proposal: dict[str, Any]
) -> dict[str, Any]:
    exit_code, verdict = await bridge.evaluate(proposal)
    audit = await bridge.record_verdict(session, merchant_id=merchant_id, verdict=verdict)
    if exit_code == 0:
        # A preview token: verifiable as lab evidence, never redeemable by the
        # gateway, so this public endpoint cannot act as a signing oracle.
        verdict["hmac_approval_token"] = token.issue(
            secret=settings.verdictpay_signing_secret,
            proposal_id=str(proposal.get("proposal_id")),
            action=str(proposal.get("proposed_action")),
            dispute_id=str(proposal.get("dispute_id")),
            manifest_sha256=str(verdict.get("manifest_sha256")),
            scope=token.SCOPE_PREVIEW,
        )
    verdict["banner"] = (
        "EXIT CODE 0 — ALLOW (DRY RUN · TOKEN ISSUED)" if exit_code == 0 else "EXIT CODE 2 — VETO"
    )
    verdict["audit_id"] = audit.id
    verdict["chain_hash"] = audit.chain_hash
    return verdict


def _hardened(proposal: dict[str, Any], **changes: Any) -> dict[str, Any]:
    safe = dict(proposal)
    safe.pop("naive_reasoning", None)
    safe.update(changes)
    safe["proposal_id"] = str(uuid.uuid4())
    safe["candidate_mode"] = "HARDENED"
    return safe


def _run_worker(settings: Any) -> dict[str, Any]:
    env = {}
    if settings.ai_enabled and settings.gemini_api_key:
        env = {"LLM_API_KEY": settings.gemini_api_key, "LLM_MODEL": settings.gemini_model}
    try:
        completed = subprocess.run(
            [sys.executable, "-I", "-B", str(WORKER)],
            capture_output=True,
            env=env,
            cwd="/",
            timeout=30,
            check=False,
        )
        result = json.loads(completed.stdout.decode("utf-8") or "{}")
    except (subprocess.TimeoutExpired, json.JSONDecodeError, UnicodeDecodeError):
        result = {}
    if not isinstance(result, dict) or "proposal" not in result:
        from app.worker import live_llm_attack

        result = {
            "thread": live_llm_attack.THREAD,
            "source": "scripted_worker_failed",
            "proposal": live_llm_attack.SCRIPTED,
            "degraded": True,
        }
    return result


async def _llm_result(settings: Any) -> dict[str, Any]:
    cached = _llm_cache.get("attack")
    if cached and time.monotonic() - cached[0] < LLM_CACHE_SECONDS:
        return {**cached[1], "cached": True}
    result = await asyncio.to_thread(_run_worker, settings)
    # A degraded run is a failure, not a result: caching it for ten minutes
    # would keep serving "no live model" long after the model came back.
    if not result.get("degraded"):
        _llm_cache["attack"] = (time.monotonic(), result)
    return {**result, "cached": False}


async def _paypal_probe(request: Request) -> dict[str, Any]:
    gateway = request.app.state.gateway
    started = time.perf_counter()
    try:
        response = await gateway.probe()
    except UpstreamError as exc:
        debug = next(
            (d.get("message") for d in exc.details if d.get("field") == "paypal_debug_id"), None
        )
        return {"ok": False, "http_status": exc.upstream_status, "paypal_debug_id": debug}
    except Exception as exc:  # unconfigured gateway, network
        return {"ok": False, "error": type(exc).__name__}
    return {
        "ok": True,
        "source_plane": "LIVE_PAYPAL_SANDBOX",
        "badge": "[LIVE PAYPAL SANDBOX]",
        "endpoint": "GET /v1/customer/disputes?page_size=1",
        "http_status": response.status_code,
        "paypal_debug_id": response.request_id,
        "latency_ms": round((time.perf_counter() - started) * 1000),
    }


@router.post("/veto-lab/run")
async def run_veto_lab(
    request: Request, session: SessionDep, merchant: MerchantDep, settings: SettingsDep
) -> dict[str, Any]:
    """Run all three negative controls and their hardened alternatives."""
    now = datetime.now(UTC).replace(microsecond=0)
    judge = lambda proposal: _judge(session, settings, merchant.id, proposal)  # noqa: E731

    # 1. naive float / count triage --------------------------------------------
    naive_hvd = candidate_naive.naive_hvd_proposal()
    naive_vamp = candidate_naive.naive_vamp_proposal()
    naive = {
        "id": "naive_cliff",
        "title": "Float, count-only triage vs the two 1.5% cliffs",
        "source_planes": {
            "hvd": "[LIVE PAYPAL SANDBOX] policy math on a demo portfolio",
            "vamp": "[VISA-TC40 / ACQUIRER-FEED SIMULATION]",
        },
        "cases": [
            {
                "axis": "PayPal HVD (dollar-weighted)",
                "unguarded": {"proposal": naive_hvd, "reasoning": naive_hvd["naive_reasoning"]},
                "sentinel": await judge(naive_hvd),
                "hardened": await judge(_hardened(naive_hvd, proposed_action="MAKE_OFFER")),
            },
            {
                "axis": "Visa VAMP (count-weighted, >= 1,500 events)",
                "source_plane": "SIMULATED_CARD_NETWORK_FEED",
                "unguarded": {"proposal": naive_vamp, "reasoning": naive_vamp["naive_reasoning"]},
                "sentinel": await judge(naive_vamp),
                "hardened": await judge(_hardened(naive_vamp, proposed_action="MAKE_OFFER")),
            },
        ],
    }

    # 2. agent-toolkit hazards ---------------------------------------------------
    try:
        recorded = json.loads(FIXTURE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        recorded = {"results": [], "error": "toolkit probe fixture missing"}
    toolkit_cases = []
    for item in recorded.get("results", []):
        args = item.get("arguments") or {}
        proposal = bridge.build_proposal(
            dispute_id=str(args.get("dispute_id") or ""),
            action=TOOL_TO_ACTION.get(str(item.get("tool") or ""), "SEND_MESSAGE"),
            candidate_mode="TOOLKIT_RAW",
            stage="CHARGEBACK",
            channel="INTERNAL",
            reason_code="MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            payment_rail="PAYPAL_WALLET",
            external_reason_code=None,
            amount_minor=4_900,
            currency="USD",
            hateoas_rels=["accept-claim", "send-message"],
            extra={
                "requested_tool": item.get("tool"),
                "tool_acl": recorded.get("exposed_tools") or ["list_disputes"],
            },
        )
        toolkit_cases.append(
            {
                "id": item.get("id"),
                "title": item.get("title"),
                "unguarded": item.get("unguarded"),
                "shield": item.get("shielded"),
                "sentinel": await judge(proposal),
            }
        )
    toolkit = {
        "id": "toolkit_hazards",
        "title": f"{recorded.get('toolkit', '@paypal/agent-toolkit')} dispute tools",
        "recorded_at": recorded.get("generated_at"),
        "network": recorded.get("network"),
        "three_action_limit": recorded.get("three_action_limit"),
        "stale_oauth": recorded.get("stale_oauth"),
        "cases": toolkit_cases,
    }

    # 3. live LLM attack ---------------------------------------------------------
    worker = await _llm_result(settings)
    model_out = worker.get("proposal") if isinstance(worker.get("proposal"), dict) else {}
    cited = [str(item) for item in model_out.get("ce3_prior_order_ids") or []]
    orders = _lab_orders(now)
    tool = str(model_out.get("tool") or "")
    attack_proposal = bridge.build_proposal(
        dispute_id=str(model_out.get("dispute_id") or "PP-D-LAB-ATTACK")[:80],
        action=TOOL_TO_ACTION.get(tool, tool.upper() or "UNKNOWN"),
        stage="CHARGEBACK",
        channel="EXTERNAL",
        reason_code="UNAUTHORISED",
        payment_rail="UNBRANDED_CARD",
        external_reason_code="10.4",
        amount_minor=4_900,
        currency="USD",
        hateoas_rels=["accept-claim", "provide-evidence", "make-offer", "send-message"],
        untrusted_text="\n".join(str(m.get("content")) for m in worker.get("thread") or []),
        candidate_mode="LLM_UNGUARDED",
        extra={
            "claimed_ce3_manifest": {
                "disputed_order": {
                    "order_id": "O-DISPUTED",
                    "settled_at": now.isoformat(),
                    "payment_credential_hash": CARD,
                    "payment_rail": "UNBRANDED_CARD",
                    **ANCHORS,
                },
                "history": [orders[order] for order in cited if order in orders],
            }
            if cited
            else None
        },
    )
    hardened_attack = _hardened(
        attack_proposal,
        dispute_id="PP-D-LAB-ATTACK",
        proposed_action="SEND_MESSAGE",
        untrusted_text=None,
        claimed_ce3_manifest=None,
    )
    llm = {
        "id": "llm_attack",
        "title": "Live LLM on a hostile buyer thread (injection + Day-119 CE 3.0 split)",
        "worker": {
            "source": worker.get("source"),
            "model": worker.get("model"),
            "degraded": worker.get("degraded", False),
            "degraded_reason": worker.get("degraded_reason"),
            "cached": worker.get("cached", False),
            "env_keys": worker.get("env_keys"),
            "credential_env_leaks": worker.get("credential_env_leaks"),
        },
        "thread": worker.get("thread"),
        "unguarded": {"proposal": model_out},
        "sentinel": await judge(attack_proposal),
        "hardened": await judge(hardened_attack),
    }

    await session.commit()
    return {
        "generated_at": now.isoformat(),
        "rules_manifest_sha256": get_manifest().sha256,
        "paypal_probe": await _paypal_probe(request),
        "controls": [naive, toolkit, llm],
    }


@router.post("/veto-lab/sentinel")
async def sentinel_check(
    session: SessionDep,
    merchant: MerchantDep,
    settings: SettingsDep,
    proposal: dict[str, Any] = Body(...),
) -> dict[str, Any]:
    """Evaluate one untrusted proposal (used by CliffGuardToolkitShield)."""
    verdict = await _judge(session, settings, merchant.id, proposal)
    await session.commit()
    return verdict
