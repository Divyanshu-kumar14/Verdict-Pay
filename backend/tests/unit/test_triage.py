"""First-match triage policy tests with exact numbers (plan section 5)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.disputes.ev import EvInputs, compute_ev
from app.domain.disputes.state_machine import expected_rels
from app.domain.disputes.triage import (
    TriageDecision,
    TriageInput,
    decide,
    degrade_to_legal,
)
from app.domain.disputes.win_probability import SignalSet, completeness, score_win_probability
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage, RecommendedAction

REASON = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"

FOUR_SIGNALS = SignalSet(
    tos_accepted=True,
    ip_match=True,
    asset_delivered=True,
    chain_verified=True,
)
THREE_SIGNALS = SignalSet(tos_accepted=True, asset_delivered=True, chain_verified=True)


def _triage(
    *,
    stage: DisputeStage,
    channel: DisputeChannel = DisputeChannel.INTERNAL,
    signals: SignalSet = FOUR_SIGNALS,
    amount: str = "99.00",
    p_win: float = 0.65,
    high_volume: bool = True,
    links: dict[str, str] | None = None,
) -> TriageInput:
    # HVD tier: $200 disputed over $10,000 net sales (2.0%) and 500 sales.
    ev = compute_ev(
        EvInputs(
            amount_usd=Decimal(amount),
            p_win=p_win,
            stage=stage,
            reason_code=REASON,
            settled_txns_3m=500,
            net_sales_minor_3m=1_000_000,
            disputed_amount_minor_3m=20_000 if high_volume else 0,
        )
    )
    return TriageInput(
        stage=stage,
        channel=channel,
        reason_code=REASON,
        win=score_win_probability(signals, REASON),
        completeness=completeness(signals),
        ev=ev,
        links=links if links is not None else expected_rels(stage),
        amount_usd=Decimal(amount),
    )


def test_branch_a_inquiry_deflection() -> None:
    inputs = _triage(stage=DisputeStage.INQUIRY)
    assert inputs.win.score == 0.65
    assert inputs.completeness == Decimal("0.6666")
    # 0.65 x (-30) + 0.35 x -(99 + 30): the $30 HVD fee replaces $15.
    assert inputs.ev.ev_fight == Decimal("-64.65")
    decision = decide(inputs)
    assert decision.action is RecommendedAction.DEFLECT_INQUIRY
    assert decision.rationale[-1].detail == ("rule=inquiry_deflection recommended=DEFLECT_INQUIRY")
    assert len(decision.rationale) == 5


def test_branch_a_requires_internal_channel() -> None:
    decision = decide(_triage(stage=DisputeStage.INQUIRY, channel=DisputeChannel.EXTERNAL))
    assert decision.action is RecommendedAction.MAKE_OFFER


def test_branch_b_offer_beats_fight() -> None:
    inputs = _triage(stage=DisputeStage.INQUIRY, signals=THREE_SIGNALS, p_win=0.53)
    assert inputs.win.score == 0.53
    assert inputs.completeness == 0.5
    assert inputs.ev.ev_offer == Decimal("-29.70")
    assert inputs.ev.ev_fight == Decimal("-76.53")
    decision = decide(inputs)
    assert decision.action is RecommendedAction.MAKE_OFFER
    assert decision.rationale[-1].detail == (
        "rule=inquiry_offer_beats_fight recommended=MAKE_OFFER"
    )


def test_branch_c_inquiry_default_deflection() -> None:
    inputs = _triage(
        stage=DisputeStage.INQUIRY,
        signals=THREE_SIGNALS,
        amount="200.00",
        p_win=1.0,
    )
    assert inputs.ev.ev_offer == Decimal("-60.00")
    assert inputs.ev.ev_fight == Decimal("-30.00")
    decision = decide(inputs)
    assert decision.action is RecommendedAction.DEFLECT_INQUIRY
    assert decision.rationale[-1].detail == (
        "rule=inquiry_deflection_default recommended=DEFLECT_INQUIRY"
    )


def test_branch_d_chargeback_provide_evidence() -> None:
    inputs = _triage(
        stage=DisputeStage.CHARGEBACK,
        amount="100.00",
        p_win=0.7,
    )
    assert inputs.ev.ev_fight == Decimal("-60.00")
    assert inputs.ev.ev_settle == Decimal("-130.00")
    decision = decide(inputs)
    assert decision.action is RecommendedAction.PROVIDE_EVIDENCE
    assert decision.rationale[-1].detail == (
        "rule=claim_evidence_positive_ev recommended=PROVIDE_EVIDENCE"
    )
    allowed = {item.action: item for item in decision.allowed_actions}
    assert allowed[DisputeAction.PROVIDE_EVIDENCE].allowed is True


def test_branch_e_chargeback_accept_claim() -> None:
    inputs = _triage(
        stage=DisputeStage.CHARGEBACK,
        amount="25.00",
        p_win=0.0,
        signals=THREE_SIGNALS,
        high_volume=False,
    )
    # With no fight cost, settling only ties fighting at p=0: -(25 + 15).
    assert inputs.ev.ev_fight == Decimal("-40.00")
    assert inputs.ev.ev_settle == Decimal("-40.00")
    decision = decide(inputs)
    assert decision.action is RecommendedAction.ACCEPT_CLAIM
    assert decision.rationale[-1].detail == ("rule=claim_settle_cheaper recommended=ACCEPT_CLAIM")


def test_branch_f_pre_arbitration_monitor() -> None:
    # EV p_win is deliberately independent of the signal score here: the policy
    # guard under test is "evidence only when the win score is at least 0.35".
    inputs = _triage(
        stage=DisputeStage.PRE_ARBITRATION,
        amount="100.00",
        p_win=0.3,
        signals=SignalSet(tos_accepted=True),
    )
    assert inputs.ev.ev_fight == Decimal("-100.00")
    assert inputs.ev.ev_settle == Decimal("-130.00")
    assert inputs.win.score == 0.25
    decision = decide(inputs)
    assert decision.action is RecommendedAction.MONITOR
    assert decision.rationale[-1].detail == "rule=monitor recommended=MONITOR"


def test_rationale_contains_concrete_numbers() -> None:
    decision = decide(_triage(stage=DisputeStage.INQUIRY))
    assert isinstance(decision, TriageDecision)
    details = {item.key: item.detail for item in decision.rationale}
    assert details["stage_channel"] == (
        "stage=INQUIRY channel=INTERNAL reason_code="
        "MERCHANDISE_OR_SERVICE_NOT_RECEIVED amount_usd=99.00 currency=USD"
    )
    assert details["win_probability"] == (
        "p_win=0.6500 completeness=0.6666 reason_multiplier=1.0000"
    )
    assert details["expected_value"] == (
        "ev_fight=-64.65 ev_settle=-99.00 ev_offer=-29.70 best_financial_action=MAKE_OFFER"
    )
    assert details["fee_cliff"] == (
        "crosses_cliff=false penalty_ratio_usd=0.00 hvd_ratio_before_ppm=20000 "
        "hvd_ratio_if_claim_ppm=29900 threshold_ppm=15000 fee_tier_usd=30.00 sla_days=3"
    )
    assert len(decision.rationale) >= 3


def test_allowed_actions_include_illegal_evidence_with_reason() -> None:
    decision = decide(_triage(stage=DisputeStage.INQUIRY))
    allowed = {item.action: item for item in decision.allowed_actions}
    assert allowed[DisputeAction.PROVIDE_EVIDENCE].allowed is False
    assert allowed[DisputeAction.PROVIDE_EVIDENCE].reason == "require-evidence_link_missing"
    assert allowed[DisputeAction.SEND_MESSAGE].allowed is True
    assert allowed[DisputeAction.SEND_MESSAGE].fee_usd == 0


def test_evidence_link_makes_inquiry_evidence_legal() -> None:
    decision = decide(
        _triage(
            stage=DisputeStage.INQUIRY,
            links={"require-evidence": "https://api.paypal.com/v1/evidence"},
        )
    )
    allowed = {item.action: item for item in decision.allowed_actions}
    assert allowed[DisputeAction.PROVIDE_EVIDENCE].allowed is True
    assert allowed[DisputeAction.PROVIDE_EVIDENCE].paypal_link == (
        "https://api.paypal.com/v1/evidence"
    )


@pytest.mark.parametrize(
    "preferred,stage,expected",
    [
        (
            RecommendedAction.DEFLECT_INQUIRY,
            DisputeStage.PRE_ARBITRATION,
            RecommendedAction.ACCEPT_CLAIM,
        ),
        (RecommendedAction.MAKE_OFFER, DisputeStage.INQUIRY, RecommendedAction.MAKE_OFFER),
        (
            RecommendedAction.PROVIDE_EVIDENCE,
            DisputeStage.INQUIRY,
            RecommendedAction.DEFLECT_INQUIRY,
        ),
        (RecommendedAction.MAKE_OFFER, DisputeStage.RESOLVED, RecommendedAction.MONITOR),
        (RecommendedAction.PROVIDE_EVIDENCE, DisputeStage.CLOSED, RecommendedAction.MONITOR),
        (RecommendedAction.MONITOR, DisputeStage.CHARGEBACK, RecommendedAction.MONITOR),
    ],
)
def test_degrade_to_legal(
    preferred: RecommendedAction, stage: DisputeStage, expected: RecommendedAction
) -> None:
    assert (
        degrade_to_legal(
            preferred,
            stage=stage,
            channel=DisputeChannel.INTERNAL,
            links=expected_rels(stage),
        )
        is expected
    )


def test_invalid_completeness_rejected() -> None:
    inputs = _triage(stage=DisputeStage.INQUIRY)
    broken = TriageInput(
        stage=inputs.stage,
        channel=inputs.channel,
        reason_code=inputs.reason_code,
        win=inputs.win,
        completeness=1.5,
        ev=inputs.ev,
        links=inputs.links,
        amount_usd=inputs.amount_usd,
    )
    with pytest.raises(ValueError, match="completeness"):
        decide(broken)
