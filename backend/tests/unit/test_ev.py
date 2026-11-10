"""Golden tests for the two-tier EV engine.

Fee law: in the HVD tier the $30 fee *replaces* $15 (a $100 loss is -$130,
never -$145) and is charged even on a win; in the standard tier a loss is
-(amount + $15) and a win costs $0. ACCEPT_CLAIM is fee-free in INQUIRY.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.disputes.ev import (
    EvInputs,
    compute_ev,
    is_hvd_countable,
    pick_best_action,
    ratio_relation,
    to_breakdown,
)
from app.domain.enums import DisputeStage, RecommendedAction

INR = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
NET_SALES = 1_000_000  # $10,000.00


def make(**overrides: object) -> EvInputs:
    base: dict[str, object] = {
        "amount_usd": Decimal("100.00"),
        "p_win": Decimal("0.5"),
        "stage": DisputeStage.CHARGEBACK,
        "reason_code": INR,
        "settled_txns_3m": 200,
        "net_sales_minor_3m": NET_SALES,
        "disputed_amount_minor_3m": 0,
    }
    base.update(overrides)
    return EvInputs(**base)  # type: ignore[arg-type]


HVD = {"disputed_amount_minor_3m": 20_000}  # 2.0% before this case
NEAR_CLIFF = {"disputed_amount_minor_3m": 14_000}  # 1.4%; +$100 -> 2.4%


@pytest.mark.parametrize(
    "p,expected_fight",
    [(Decimal("0"), Decimal("-130.00")), (Decimal("1"), Decimal("-30.00"))],
)
def test_hvd_fee_replaces_standard_fee(p: Decimal, expected_fight: Decimal) -> None:
    outcome = compute_ev(make(p_win=p, **HVD))
    assert outcome.high_volume is True
    assert outcome.fee_tier == Decimal("30.00")
    assert outcome.ev_fight == expected_fight
    assert outcome.ev_fight != Decimal("-145.00")


def test_hvd_accept_claim_costs_30_in_claim_stage() -> None:
    outcome = compute_ev(make(**HVD))
    assert outcome.accept_fee == Decimal("30.00")
    assert outcome.ev_settle == Decimal("-130.00")


@pytest.mark.parametrize(
    "p,expected_fight",
    [(Decimal("0"), Decimal("-115.00")), (Decimal("1"), Decimal("0.00"))],
)
def test_standard_tier_loss_and_free_win(p: Decimal, expected_fight: Decimal) -> None:
    outcome = compute_ev(make(p_win=p))
    assert outcome.high_volume is False
    assert outcome.ev_fight == expected_fight
    assert outcome.ev_settle == Decimal("-115.00")
    assert outcome.win_fee == Decimal("0.00")


@pytest.mark.parametrize("extra", [{}, HVD])
def test_accept_claim_is_fee_free_in_inquiry(extra: dict[str, int]) -> None:
    outcome = compute_ev(make(stage=DisputeStage.INQUIRY, **extra))
    assert outcome.accept_fee == Decimal("0.00")
    assert outcome.ev_settle == Decimal("-100.00")


def test_inquiry_is_not_added_to_the_ratio_but_fight_prices_escalation() -> None:
    outcome = compute_ev(make(stage=DisputeStage.INQUIRY, **NEAR_CLIFF))
    assert outcome.ratio_before_ppm == 14_000
    assert outcome.ratio_after_ppm == 24_000  # only the escalation projection
    assert outcome.high_volume is False  # an open inquiry does not move the tier
    assert outcome.crosses_cliff is True
    assert outcome.penalty_ratio == Decimal("45.00")  # (30 - 15) x 3
    # 0.5 x (-30) + 0.5 x (-(100 + 30) - 45) = -102.50
    assert outcome.ev_fight == Decimal("-102.50")
    assert outcome.ev_offer == Decimal("-30.00")
    assert outcome.best_action is RecommendedAction.MAKE_OFFER


def test_claim_stage_counts_the_claim_itself() -> None:
    outcome = compute_ev(make(**NEAR_CLIFF))
    assert outcome.crosses_cliff is True
    assert outcome.high_volume is True
    assert outcome.sla_days == 3


def test_ratio_is_dollar_weighted_not_count_weighted() -> None:
    # Same claim count, very different dollars: a $2,500 SNAD alone breaches.
    small = compute_ev(make(amount_usd=Decimal("12.00")))
    large = compute_ev(make(amount_usd=Decimal("2500.00")))
    assert small.ratio_after_ppm == 1_200
    assert large.ratio_after_ppm == 250_000
    assert small.high_volume is False and large.high_volume is True


@pytest.mark.parametrize(
    "txns,disputed,in_tier",
    [
        (101, 15_000, True),
        (101, 14_999, False),
        (100, 15_000, False),  # needs > 100 settled transactions
        (100, 900_000, False),
    ],
)
def test_hvd_boundaries_exact(txns: int, disputed: int, in_tier: bool) -> None:
    outcome = compute_ev(
        make(
            stage=DisputeStage.INQUIRY,
            settled_txns_3m=txns,
            disputed_amount_minor_3m=disputed,
        )
    )
    assert outcome.high_volume is in_tier


def test_card_rail_is_never_hvd_countable() -> None:
    assert is_hvd_countable(payment_rail="UNBRANDED_CARD", reason_code=INR) is False
    assert is_hvd_countable(payment_rail="PAYPAL_WALLET", reason_code="UNAUTHORIZED") is False
    outcome = compute_ev(make(payment_rail="UNBRANDED_CARD", **NEAR_CLIFF))
    assert outcome.hvd_countable is False
    assert outcome.ratio_after_ppm == outcome.ratio_before_ppm == 14_000
    assert outcome.crosses_cliff is False


def test_round_down_truncates_toward_zero() -> None:
    outcome = compute_ev(make(amount_usd=Decimal("10.00"), p_win=Decimal("0.3333")))
    # 0.6667 x -(10 + 15) = -16.6675 -> ROUND_DOWN -> -16.66 (half-up gave -16.67)
    assert outcome.ev_fight == Decimal("-16.66")


def test_no_negative_zero() -> None:
    outcome = compute_ev(make(amount_usd=Decimal("0.01"), stage=DisputeStage.INQUIRY))
    assert str(outcome.ev_offer) == "0.00"


def test_float_money_rejected() -> None:
    with pytest.raises(TypeError):
        compute_ev(make(amount_usd=25.0))


@pytest.mark.parametrize("p", [Decimal("-0.01"), Decimal("1.01"), float("nan")])
def test_invalid_probability_rejected(p: object) -> None:
    with pytest.raises(ValueError):
        compute_ev(make(p_win=p))


def test_float_probability_converted_exactly() -> None:
    assert (
        compute_ev(make(p_win=0.6375)).ev_fight
        == compute_ev(make(p_win=Decimal("0.6375"))).ev_fight
    )


def test_pick_best_action_tie_breaks() -> None:
    same = Decimal("-10.00")
    assert (
        pick_best_action(ev_fight=same, ev_settle=same, ev_offer=same)
        is RecommendedAction.PROVIDE_EVIDENCE
    )
    assert (
        pick_best_action(
            ev_fight=Decimal("-20"), ev_settle=same, ev_offer=same, accept_fee=Decimal("15")
        )
        is RecommendedAction.MAKE_OFFER
    )


def test_breakdown_contract_has_exact_ratios() -> None:
    inputs = make(**HVD)
    breakdown = to_breakdown(inputs, compute_ev(inputs))
    assert breakdown.ratio_before_ppm == 20_000
    assert breakdown.ratio_after_ppm == 30_000
    assert breakdown.ratio_threshold_ppm == 15_000
    assert breakdown.ratio_after_str == "0.030000"
    assert breakdown.ratio_relation == "at_or_above"
    assert breakdown.fee_tier_usd == Decimal("30.00")
    assert breakdown.fee_reimbursable_on_win is False
    assert breakdown.sla_response_days == 3
    assert breakdown.source_plane == "LIVE_PAYPAL_SANDBOX"


def test_compute_ev_is_pure() -> None:
    inputs = make(**NEAR_CLIFF)
    assert compute_ev(inputs) == compute_ev(inputs)


def test_ratio_relation_exact_boundary() -> None:
    assert ratio_relation(Decimal("0.015"), Decimal("0.015")) == "at_or_above"
    assert ratio_relation(Decimal("0.0149999"), Decimal("0.015")) == "below"
