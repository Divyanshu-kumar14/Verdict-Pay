"""Deterministic Sentinel gate: one untrusted TriageProposal in, one verdict out.

Stdlib only; runs inside the isolated subprocess (see ``sandbox_runner``). The
gate never signs anything: it returns ``ALLOW`` (exit 0) or ``VETO`` (exit 2)
and the trusted parent process issues the HMAC ApprovalToken for an ALLOW.

Checks, in order (every failing check adds its code; any code means VETO):

1. policy manifest integrity (fail closed)
2. PayPal id alphabet (``^[A-Za-z0-9-]+$``), money as ints
3. prompt-injection markers in untrusted text / AI forensics
4. toolkit ACL (only the six Disputes actions this product implements)
5. HATEOAS: stage table AND live ``links[].rel``
6. evidence file constraints and corroborated tracking / refund references
7. claimed Visa CE 3.0 proof, recomputed by the oracle
8. two-axis cliff: escalations that tip HVD (dollars) or VAMP (counts)
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from app.oracle import ce3_matcher, hateoas
from app.oracle.cliff_engine import hvd_state, vamp_state
from app.oracle.manifest import ManifestError, RulesManifest, load_manifest
from app.oracle.money import from_minor, money_round_down

DISPUTE_ID_RE = re.compile(r"^[A-Za-z0-9-]{3,64}$")
ALLOWED_TOOLS = frozenset(hateoas.ACTION_RELS)
ESCALATING_INQUIRY_ACTIONS = frozenset({"ESCALATE", "PROVIDE_EVIDENCE"})
EVIDENCE_EXTENSIONS = (".jpg", ".jpeg", ".gif", ".png", ".pdf")
MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_BATCH_BYTES = 50 * 1024 * 1024
INJECTION_MARKERS = (
    "ignore previous",
    "ignore all previous",
    "ignore instructions",
    "disregard",
    "system override",
    "system prompt",
    "you are now",
    "new instructions",
    "category=",
    "accept claim",
    "accept_claim",
    "accept_dispute_claim",
    "</claim>",
    "developer mode",
    "../",
)

EXIT_ALLOW = 0
EXIT_VETO = 2


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment.replace(tzinfo=UTC) if moment.tzinfo is None else moment.astimezone(UTC)


def _order(raw: Any) -> ce3_matcher.Ce3Order | None:
    if not isinstance(raw, dict):
        return None
    settled = _parse_time(raw.get("settled_at"))
    if settled is None or not isinstance(raw.get("order_id"), str):
        return None
    return ce3_matcher.Ce3Order(
        order_id=raw["order_id"],
        payment_credential_hash=str(raw.get("payment_credential_hash") or ""),
        settled_at=settled,
        ip_hash=raw.get("ip_hash"),
        device_id_hash=raw.get("device_id_hash"),
        account_login_id_hash=raw.get("account_login_id_hash"),
        shipping_address_hash=raw.get("shipping_address_hash"),
        payment_rail=str(raw.get("payment_rail") or "UNBRANDED_CARD"),
        has_prior_dispute=bool(raw.get("has_prior_dispute")),
        has_tc40=bool(raw.get("has_tc40")),
    )


def _injection(proposal: dict[str, Any]) -> str | None:
    forensics = proposal.get("ai_forensics") or {}
    if isinstance(forensics, dict) and forensics.get("injection_detected") is True:
        return "ai_forensics.injection_detected"
    texts = [proposal.get("untrusted_text")]
    offer = proposal.get("offer_payload") or {}
    if isinstance(offer, dict):
        texts.append(offer.get("note"))
    for text in texts:
        lowered = text.lower() if isinstance(text, str) else ""
        for marker in INJECTION_MARKERS:
            if marker in lowered:
                return marker
    return None


def _evidence(proposal: dict[str, Any], codes: list[str], reasons: list[str]) -> None:
    payload = proposal.get("evidence_payload")
    if not isinstance(payload, dict):
        return
    total = 0
    for attachment in payload.get("attachments") or []:
        if not isinstance(attachment, dict):
            continue
        name = str(attachment.get("name") or "").lower()
        size = _int(attachment.get("size_bytes")) or 0
        total += size
        if "/" in name or "\\" in name or ".." in name:
            codes.append("VETO_PATH_TRAVERSAL_BLOCKED")
            reasons.append(f"attachment name {name!r} contains a path")
        if not name.endswith(EVIDENCE_EXTENSIONS) or size >= MAX_FILE_BYTES:
            codes.append("VETO_EVIDENCE_FILE_CONSTRAINT")
            reasons.append(f"attachment {name!r}: type or size not accepted by PayPal")
    if total > MAX_BATCH_BYTES:
        codes.append("VETO_EVIDENCE_FILE_CONSTRAINT")
        reasons.append("attachments exceed the 50 MB batch limit")
    known_tracking = set(payload.get("known_tracking_numbers") or [])
    known_refunds = set(payload.get("known_refund_ids") or [])
    for evidence in payload.get("evidences") or []:
        if not isinstance(evidence, dict):
            continue
        tracking = evidence.get("tracking_number")
        if tracking and tracking not in known_tracking:
            codes.append("VETO_HALLUCINATED_EVIDENCE_REF")
            reasons.append(f"tracking number {tracking!r} not found in Orders/Trackers ledger")
        for refund in evidence.get("refund_ids") or []:
            if refund not in known_refunds:
                codes.append("VETO_HALLUCINATED_EVIDENCE_REF")
                reasons.append(f"refund id {refund!r} not found in the captures ledger")


def _cliffs(
    proposal: dict[str, Any],
    manifest: RulesManifest,
    codes: list[str],
    reasons: list[str],
) -> dict[str, Any] | None:
    portfolio = proposal.get("portfolio")
    if not isinstance(portfolio, dict):
        return None
    stage = proposal.get("dispute_life_cycle_stage")
    action = proposal.get("proposed_action")
    rail = proposal.get("payment_rail")
    amount = _int(proposal.get("dispute_amount_minor")) or 0
    escalates = stage == "INQUIRY" and action in ESCALATING_INQUIRY_ACTIONS
    analysis: dict[str, Any] = {"escalates": escalates}

    hvd_in = portfolio.get("hvd")
    if rail == "PAYPAL_WALLET" and isinstance(hvd_in, dict):
        hvd_rules = manifest.section("hvd")
        countable = proposal.get("reason") in set(hvd_rules["countable_reasons"])
        before = hvd_state(
            settled_txns_3m=_int(hvd_in.get("settled_txns_3m")) or 0,
            net_sales_minor_3m=_int(hvd_in.get("net_sales_minor_3m")) or 0,
            disputed_amount_minor_3m=_int(hvd_in.get("disputed_amount_minor_3m")) or 0,
            manifest=manifest,
        )
        after = hvd_state(
            settled_txns_3m=before.settled_txns_3m,
            net_sales_minor_3m=before.net_sales_amount_minor_3m,
            disputed_amount_minor_3m=before.disputed_amount_minor_3m
            + (amount if (escalates and countable) else 0),
            manifest=manifest,
        )
        analysis["hvd_before_ppm"] = before.ratio_ppm
        analysis["hvd_after_ppm"] = after.ratio_ppm
        if not before.in_tier and after.in_tier:
            codes.append("VETO_HVD_CLIFF_BREACH")
            reasons.append(
                f"escalating this {stage} moves the PayPal HVD ratio from "
                f"{before.ratio_str} to {after.ratio_str} (>= {before.threshold_ppm} ppm): "
                "the $30 non-reimbursable tier"
            )
            offer_minor = _int((proposal.get("offer_payload") or {}).get("offer_amount_minor"))
            fee_delta = int(hvd_rules["hvd_fee_minor"]) - int(hvd_rules["standard_fee_minor"])
            fight_minor = -(amount + int(hvd_rules["hvd_fee_minor"]))
            penalty = fee_delta * 3
            offer_ev = -(offer_minor if offer_minor is not None else amount * 3 // 10)
            analysis.update(
                fight_ev_minor=fight_minor - penalty,
                offer_ev_minor=offer_ev,
                cliff_penalty_minor=penalty,
            )
            if "make-offer" in set(proposal.get("hateoas_rels") or []) and offer_ev > (
                fight_minor - penalty
            ):
                codes.append("VETO_PORTFOLIO_CLIFF_BREACH_EV_DOMINATED")
                reasons.append(
                    f"an amicable MAKE_OFFER (EV {money_round_down(from_minor(offer_ev))}) "
                    "dominates escalating into the cliff"
                )
                analysis["recommended_action"] = "MAKE_OFFER"

    vamp_in = portfolio.get("vamp")
    if rail == "UNBRANDED_CARD" and isinstance(vamp_in, dict):
        adds = 1 if (escalates or action == "ACCEPT_CLAIM") else 0
        base = {
            "tc05_settled_cnp": _int(vamp_in.get("tc05_settled_cnp")) or 0,
            "tc40_fraud_count": _int(vamp_in.get("tc40_fraud_count")) or 0,
            "tc15_dispute_count": _int(vamp_in.get("tc15_dispute_count")) or 0,
        }
        before_v = vamp_state(**base, manifest=manifest)
        after_v = vamp_state(
            **{**base, "tc15_dispute_count": base["tc15_dispute_count"] + adds},
            manifest=manifest,
        )
        analysis["vamp_before_ppm"] = before_v.ratio_ppm
        analysis["vamp_after_ppm"] = after_v.ratio_ppm
        if not before_v.excessive_enforcement_active and after_v.excessive_enforcement_active:
            codes.append("VETO_VAMP_CLIFF_BREACH")
            reasons.append(
                f"one more TC15 moves Visa VAMP to {after_v.ratio_str} with "
                f"{after_v.combined_events} events (>= 1500): $8/event enforcement "
                f"({after_v.projected_vamp_fines_str} USD)"
            )
    return analysis


def evaluate(proposal: Any, *, manifest: RulesManifest | None = None) -> dict[str, Any]:
    """Return the verdict dict (``exit_code`` 0 = ALLOW, 2 = VETO)."""
    codes: list[str] = []
    reasons: list[str] = []
    try:
        rules = manifest or load_manifest()
        manifest_sha = rules.sha256
    except ManifestError as exc:
        return _verdict(
            proposal, ["VETO_FAIL_CLOSED_ORACLE_MISSING"], [str(exc)], "0" * 64, None, None
        )
    if not isinstance(proposal, dict):
        return _verdict({}, ["VETO_SCHEMA_INVALID"], ["proposal must be an object"],
                        manifest_sha, None, None)

    dispute_id = proposal.get("dispute_id")
    if not isinstance(dispute_id, str) or not DISPUTE_ID_RE.match(dispute_id):
        codes.append("VETO_PAYPAL_ID_PATH_TRAVERSAL")
        reasons.append("dispute_id must match ^[A-Za-z0-9-]+$")
    action = proposal.get("proposed_action")
    stage = proposal.get("dispute_life_cycle_stage")
    if _int(proposal.get("dispute_amount_minor")) is None:
        codes.append("VETO_SCHEMA_INVALID")
        reasons.append("dispute_amount_minor must be an integer of minor units")

    requested_tool = proposal.get("requested_tool", action)
    if requested_tool not in ALLOWED_TOOLS or action not in ALLOWED_TOOLS:
        codes.append("VETO_TOOLKIT_ACL_BYPASS")
        reasons.append(f"tool {requested_tool!r} is not on the Disputes action allow-list")

    marker = _injection(proposal)
    if marker is not None:
        codes.append("VETO_PROMPT_INJECTION_BLOCKED")
        reasons.append(f"untrusted text carries an instruction marker ({marker!r})")

    rels = frozenset(str(rel) for rel in proposal.get("hateoas_rels") or [])
    if action in ALLOWED_TOOLS and not hateoas.is_legal(str(stage), str(action), rels):
        codes.append("VETO_ILLEGAL_HATEOAS_TRANSITION")
        reasons.append(f"{action} is not offered by PayPal links[] at stage {stage}")

    _evidence(proposal, codes, reasons)

    ce3_proof = None
    claimed = proposal.get("claimed_ce3_manifest")
    if isinstance(claimed, dict):
        disputed = _order(claimed.get("disputed_order"))
        history = [o for o in (_order(item) for item in claimed.get("history") or []) if o]
        if disputed is None:
            codes.append("VETO_CE3_INSUFFICIENT_PRIOR_TXNS")
            reasons.append("claimed CE 3.0 proof has no disputed order")
        else:
            result = ce3_matcher.match(
                disputed,
                history,
                external_reason_code=proposal.get("external_reason_code"),
                reason_code=str(proposal.get("reason") or ""),
                manifest=rules,
            )
            ce3_proof = result.as_dict()
            if not result.verified and result.veto_code:
                codes.append(result.veto_code)
                reasons.append(f"CE 3.0 proof recomputed by the oracle: {result.veto_code}")

    analysis = _cliffs(proposal, rules, codes, reasons)
    return _verdict(proposal, codes, reasons, manifest_sha, analysis, ce3_proof)


def _verdict(
    proposal: Any,
    codes: list[str],
    reasons: list[str],
    manifest_sha: str,
    analysis: dict[str, Any] | None,
    ce3_proof: dict[str, Any] | None,
) -> dict[str, Any]:
    unique = list(dict.fromkeys(codes))
    source = proposal if isinstance(proposal, dict) else {}
    return {
        "verdict": "VETO" if unique else "ALLOW",
        "exit_code": EXIT_VETO if unique else EXIT_ALLOW,
        "veto_codes": unique,
        "reasons": reasons,
        "proposal_id": str(source.get("proposal_id") or ""),
        "dispute_id": str(source.get("dispute_id") or "")[:64],
        "proposed_action": str(source.get("proposed_action") or ""),
        "candidate_mode": str(source.get("candidate_mode") or "HARDENED"),
        "manifest_sha256": manifest_sha,
        "portfolio_ev_analysis": analysis,
        "ce3_proof": ce3_proof,
        "hmac_approval_token": None,
    }
