"""Policy recommendation vs lowest modelled loss (the P3 divergence defect).

The comparison exists because one sentence used to do two jobs: "recommends X
because it has the highest expected value" is false whenever the policy ladder
prefers a cheaper-by-policy action that is not the cheapest modelled loss.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.api import schemas
from app.domain.disputes.decision import compare, label_for, policy_reason_from
from app.domain.disputes.ev import EvInputs, compute_ev, to_breakdown
from app.domain.disputes.state_machine import expected_rels, to_allowed_actions
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage, RecommendedAction


def _breakdown(**overrides: object) -> schemas.EvBreakdown:
    """A chargeback-shaped breakdown; the engine computes the real values."""
    base: dict[str, object] = {
        "amount_usd": Decimal("99.00"),
        "p_win": Decimal("0.7"),
        "stage": DisputeStage.CHARGEBACK,
        # HVD tier: $200 disputed / $10,000 net sales over 200 settled sales.
        "settled_txns_3m": 200,
        "net_sales_minor_3m": 1_000_000,
        "disputed_amount_minor_3m": 20_000,
    }
    base.update(overrides)
    inputs = EvInputs(**base)  # type: ignore[arg-type]
    return to_breakdown(inputs, compute_ev(inputs))


def _allowed(
    stage: DisputeStage = DisputeStage.CHARGEBACK,
    channel: DisputeChannel = DisputeChannel.INTERNAL,
    links: dict[str, str] | None = None,
) -> list[schemas.AllowedAction]:
    return to_allowed_actions(
        stage=stage,
        channel=channel,
        links=links if links is not None else expected_rels(stage),
    )


def _option(
    comparison: schemas.DecisionComparison, action: RecommendedAction
) -> schemas.DecisionOption:
    return next(row for row in comparison.options if row.action is action)


# --------------------------------------------------------------------- agree case
def test_agree_when_policy_matches_cheapest_modelled_loss() -> None:
    breakdown = _breakdown()
    policy = breakdown.best_action

    comparison = compare(
        breakdown=breakdown,
        policy_action=policy,
        allowed_actions=_allowed(),
    )

    assert comparison.agree is True
    assert comparison.policy_action is policy
    assert comparison.best_financial_action is policy
    assert comparison.divergence_explanation is None
    assert comparison.policy_label == comparison.best_financial_label
    assert len(comparison.options) == 3

    chosen = _option(comparison, policy)
    assert chosen.is_policy_choice is True
    assert chosen.is_best_financial is True
    others = [row for row in comparison.options if row.action is not policy]
    assert all(row.is_policy_choice is False for row in others)
    assert all(row.is_best_financial is False for row in others)


def test_options_carry_the_real_engine_values() -> None:
    breakdown = _breakdown()
    comparison = compare(
        breakdown=breakdown,
        policy_action=breakdown.best_action,
        allowed_actions=_allowed(),
    )

    assert [row.action for row in comparison.options] == [
        RecommendedAction.PROVIDE_EVIDENCE,
        RecommendedAction.ACCEPT_CLAIM,
        RecommendedAction.MAKE_OFFER,
    ]
    assert _option(comparison, RecommendedAction.PROVIDE_EVIDENCE).value_usd == (
        breakdown.ev_fight_usd
    )
    assert _option(comparison, RecommendedAction.ACCEPT_CLAIM).value_usd == (
        breakdown.ev_settle_usd
    )
    assert _option(comparison, RecommendedAction.MAKE_OFFER).value_usd == (breakdown.ev_offer_usd)
    assert {row.action: row.label for row in comparison.options} == {
        RecommendedAction.PROVIDE_EVIDENCE: "Fight",
        RecommendedAction.ACCEPT_CLAIM: "Settle",
        RecommendedAction.MAKE_OFFER: "Make offer",
    }


# ------------------------------------------------- the documented P3 divergence
def test_deflect_inquiry_policy_versus_cheapest_offer() -> None:
    """DEFLECT_INQUIRY is policy; MAKE_OFFER carries the lowest modelled loss."""
    breakdown = schemas.EvBreakdown(
        **{
            **_breakdown(stage=DisputeStage.INQUIRY).model_dump(),
            # Force the divergence the defect report describes: the offer is the
            # cheapest modelled outcome while policy deflects the inquiry.
            "ev_fight_usd": Decimal("-120.00"),
            "ev_settle_usd": Decimal("-99.00"),
            "ev_offer_usd": Decimal("-29.70"),
            "best_action": RecommendedAction.MAKE_OFFER,
        }
    )

    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.DEFLECT_INQUIRY,
        allowed_actions=_allowed(stage=DisputeStage.INQUIRY),
        policy_reason=(
            "triage rule inquiry_deflection; stage=INQUIRY channel=INTERNAL; "
            "p_win=0.7200 completeness=0.8000"
        ),
    )

    assert comparison.agree is False
    assert comparison.policy_action is RecommendedAction.DEFLECT_INQUIRY
    assert comparison.policy_label == "Deflect inquiry"
    assert comparison.best_financial_action is RecommendedAction.MAKE_OFFER
    assert comparison.best_financial_label == "Make offer"
    assert comparison.divergence_explanation is not None

    explanation = comparison.divergence_explanation
    # Names both actions and why policy picked its one.
    assert "Deflect inquiry" in explanation
    assert "Make offer" in explanation
    assert "inquiry_deflection" in explanation
    assert "stage_channel" in explanation or "stage=INQUIRY" in explanation
    # States the dollar gap between the policy action and the cheapest loss.
    assert "$120.00" in explanation
    assert "$29.70" in explanation
    assert "$90.30" in explanation
    # And says outright that policy may prefer a non-cheapest action.
    assert "relationship" in explanation
    assert "cheapest modelled loss" in explanation

    # The policy action is not one of the three priced rows, so no row claims it.
    assert all(row.is_policy_choice is False for row in comparison.options)
    assert all(row.is_best_financial is False for row in comparison.options) or (
        _option(comparison, RecommendedAction.MAKE_OFFER).is_best_financial is True
    )


def test_divergence_between_two_priced_actions_reports_the_gap() -> None:
    """PROVIDE_EVIDENCE policy while MAKE_OFFER is cheaper by a known amount."""
    breakdown = schemas.EvBreakdown(
        **{
            **_breakdown().model_dump(),
            "ev_fight_usd": Decimal("-90.00"),
            "ev_settle_usd": Decimal("-114.00"),
            "ev_offer_usd": Decimal("-29.70"),
            "best_action": RecommendedAction.MAKE_OFFER,
        }
    )

    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.PROVIDE_EVIDENCE,
        allowed_actions=_allowed(),
    )

    assert comparison.agree is False
    explanation = comparison.divergence_explanation or ""
    assert "Fight (provide evidence)" in explanation
    assert "$60.30" in explanation  # 90.00 - 29.70
    assert "more than" in explanation


# ------------------------------------------------------ PayPal action availability
def test_unavailable_paypal_action_marks_row_unavailable_with_a_reason() -> None:
    """In INQUIRY without the require-evidence rel, fighting is not offerable."""
    breakdown = _breakdown()
    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.DEFLECT_INQUIRY,
        allowed_actions=_allowed(stage=DisputeStage.INQUIRY),
    )

    fight = _option(comparison, RecommendedAction.PROVIDE_EVIDENCE)
    assert fight.paypal_action_available is False
    assert fight.paypal_action_reason
    assert "require-evidence" in fight.paypal_action_reason

    # Settling is legal in INQUIRY, so that row stays available.
    settle = _option(comparison, RecommendedAction.ACCEPT_CLAIM)
    assert settle.paypal_action_available is True
    assert settle.paypal_action_reason is None


def test_available_paypal_action_uses_the_triage_mapping() -> None:
    """The recommendation -> DisputeAction mapping is triage's, not a copy."""
    breakdown = _breakdown()
    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.MAKE_OFFER,
        allowed_actions=_allowed(),
    )

    offer = _option(comparison, RecommendedAction.MAKE_OFFER)
    assert offer.is_policy_choice is True
    assert offer.paypal_action_available is True
    assert DisputeAction.MAKE_OFFER.value == "MAKE_OFFER"


def test_resolved_stage_marks_every_row_unavailable() -> None:
    breakdown = _breakdown()
    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.MONITOR,
        allowed_actions=_allowed(stage=DisputeStage.RESOLVED),
    )

    assert all(row.paypal_action_available is False for row in comparison.options)
    assert all(row.paypal_action_reason for row in comparison.options)
    # MONITOR needs no PayPal action and never references an EV value.
    assert comparison.policy_label == "Monitor"
    assert comparison.agree is False


# ------------------------------------------- never claim "highest expected value"
def test_divergent_explanation_never_claims_highest_expected_value() -> None:
    breakdown = schemas.EvBreakdown(
        **{
            **_breakdown().model_dump(),
            "ev_fight_usd": Decimal("-120.00"),
            "ev_settle_usd": Decimal("-99.00"),
            "ev_offer_usd": Decimal("-29.70"),
            "best_action": RecommendedAction.MAKE_OFFER,
        }
    )
    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.DEFLECT_INQUIRY,
        allowed_actions=_allowed(stage=DisputeStage.INQUIRY),
    )

    explanation = (comparison.divergence_explanation or "").lower()
    banned = (
        "highest expected value",
        "best expected value",
        "because it has the highest",
        "most profitable",
        "optimal",
    )
    for phrase in banned:
        assert phrase not in explanation, phrase

    # It must state the opposite: the cheapest loss belongs to another action.
    assert "lowest modelled loss" in explanation
    assert "not the cheapest" in explanation or "policy preference" in explanation


@pytest.mark.parametrize(
    ("policy_action", "expected_label"),
    [
        (RecommendedAction.DEFLECT_INQUIRY, "Deflect inquiry"),
        (RecommendedAction.PROVIDE_EVIDENCE, "Fight (provide evidence)"),
        (RecommendedAction.ACCEPT_CLAIM, "Settle (accept claim)"),
        (RecommendedAction.MAKE_OFFER, "Make offer"),
        (RecommendedAction.MONITOR, "Monitor"),
    ],
)
def test_every_recommendation_has_a_human_label(
    policy_action: RecommendedAction, expected_label: str
) -> None:
    assert label_for(policy_action) == expected_label


# ------------------------------------------------------------- purity/determinism
def test_compare_is_pure_and_deterministic() -> None:
    breakdown = _breakdown()
    first = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.ACCEPT_CLAIM,
        allowed_actions=_allowed(),
    )
    second = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.ACCEPT_CLAIM,
        allowed_actions=_allowed(),
    )
    assert first.model_dump() == second.model_dump()

    # The breakdown itself is never mutated by the comparison.
    snapshot = breakdown.model_dump()
    compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.MAKE_OFFER,
        allowed_actions=_allowed(),
    )
    assert breakdown.model_dump() == snapshot


def test_compare_rejects_a_non_breakdown() -> None:
    with pytest.raises(TypeError):
        compare(
            breakdown={"ev_fight_usd": Decimal("0.00")},  # type: ignore[arg-type]
            policy_action=RecommendedAction.MONITOR,
            allowed_actions=_allowed(),
        )


def test_policy_reason_from_condenses_the_triage_rationale() -> None:
    rationale = [
        schemas.RationaleItem(
            key="stage_channel",
            label="Dispute posture",
            detail="stage=INQUIRY channel=INTERNAL reason_code=OTHER amount_usd=99.00",
        ),
        schemas.RationaleItem(
            key="win_probability",
            label="Win probability",
            detail="p_win=0.7200 completeness=0.8000 reason_multiplier=1.0000",
        ),
        schemas.RationaleItem(
            key="decision",
            label="Recommended action",
            detail="rule=inquiry_deflection recommended=DEFLECT_INQUIRY",
        ),
    ]

    reason = policy_reason_from(rationale)
    assert "inquiry_deflection" in reason
    assert "stage=INQUIRY" in reason
    assert "p_win=0.7200" in reason
    assert len(reason) <= 400

    stored = [item.model_dump(mode="json") for item in rationale]
    assert policy_reason_from(stored) == reason
    assert policy_reason_from([]) == ""


def test_divergence_says_so_when_the_cheapest_row_is_not_available() -> None:
    """A ranking that names an illegal action must admit it cannot be acted on."""
    breakdown = schemas.EvBreakdown(
        **{
            **_breakdown().model_dump(),
            "ev_fight_usd": Decimal("-5.70"),
            "ev_settle_usd": Decimal("-99.00"),
            "ev_offer_usd": Decimal("-29.70"),
            "best_action": RecommendedAction.PROVIDE_EVIDENCE,
        }
    )
    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.DEFLECT_INQUIRY,
        allowed_actions=_allowed(stage=DisputeStage.INQUIRY),
    )

    fight = _option(comparison, RecommendedAction.PROVIDE_EVIDENCE)
    assert fight.is_best_financial is True
    assert fight.paypal_action_available is False

    explanation = comparison.divergence_explanation or ""
    assert "cheapest modelled loss but PayPal does not offer" in explanation
    assert "require-evidence" in explanation


# --------------------------------- real-engine policy vs cheapest regressions
def test_real_engine_policy_vs_cheapest_divergence_uses_engine_values() -> None:
    """End-to-end on real engine numbers: policy fight vs cheapest offer.

    The frozen engine prices fight/settle/offer; the comparison must keep the
    policy judgement ("fight per the ladder") distinct from the financial
    ranking ("offer is the cheapest modelled loss") with the exact dollar gap.
    """
    breakdown = _breakdown()  # engine best_action is MAKE_OFFER (-29.70)
    assert breakdown.best_action is RecommendedAction.MAKE_OFFER
    assert breakdown.ev_offer_usd == Decimal("-29.70")

    comparison = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.PROVIDE_EVIDENCE,
        allowed_actions=_allowed(),
    )

    assert comparison.agree is False
    assert comparison.policy_action is RecommendedAction.PROVIDE_EVIDENCE
    assert comparison.best_financial_action is RecommendedAction.MAKE_OFFER
    assert comparison.divergence_explanation is not None
    explanation = comparison.divergence_explanation
    # Names both actions, states the exact $30.00 gap, and keeps the concepts
    # separate: policy preference vs lowest modelled loss.
    assert "Fight (provide evidence)" in explanation
    assert "Make offer" in explanation
    assert "$30.00" in explanation  # 59.70 - 29.70 ($30 replaces $15)
    assert "lowest modelled loss" in explanation
    assert "policy preference" in explanation or "not the cheapest" in explanation
    for banned in ("highest expected value", "most profitable", "optimal"):
        assert banned not in explanation.lower()

    fight = _option(comparison, RecommendedAction.PROVIDE_EVIDENCE)
    offer = _option(comparison, RecommendedAction.MAKE_OFFER)
    assert fight.is_policy_choice is True
    assert fight.is_best_financial is False
    assert offer.is_policy_choice is False
    assert offer.is_best_financial is True


def test_real_engine_agree_only_when_policy_is_the_cheapest_row() -> None:
    """agree is true iff the policy action is literally the cheapest EV row."""
    breakdown = _breakdown()
    agree = compare(
        breakdown=breakdown,
        policy_action=breakdown.best_action,
        allowed_actions=_allowed(),
    )
    assert agree.agree is True
    assert agree.divergence_explanation is None

    disagree = compare(
        breakdown=breakdown,
        policy_action=RecommendedAction.ACCEPT_CLAIM,
        allowed_actions=_allowed(),
    )
    assert disagree.agree is False
    assert disagree.divergence_explanation is not None
    # The $99.30 gap between settle (-129.00) and offer (-29.70) is stated.
    assert "$99.30" in disagree.divergence_explanation
