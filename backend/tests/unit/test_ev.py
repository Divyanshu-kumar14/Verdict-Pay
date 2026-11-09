"""Exact-value tests for the deterministic EV engine (plan section 5)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.disputes.ev import (
    EvInputs,
    compute_ev,
    effective_high_volume_fee,
    pick_best_action,
    ratio_relation,
    to_breakdown,
)
from app.domain.enums import RecommendedAction


def _inputs(**overrides: object) -> EvInputs:
    base: dict[str, object] = {
        "amount_usd": Decimal("25.00"),
        "p_win": 0.7,
        "sales_3mo": 200,
        "disputes_3mo": 1,
        "high_volume": True,
        "claim_fee_attached": True,
    }
    base.update(overrides)
    return EvInputs(**base)  # type: ignore[arg-type]


def _money(value: Decimal) -> str:
    return str(value)


# amount, p, sales, disputes, high_volume, claim_fee,
#   fight, settle, offer, penalty, ratio_before, ratio_after, crosses, best
VECTORS = [
    pytest.param(
        Decimal("25.00"), 0.7, 200, 1, True, True,
        "-42.00", "-40.00", "-7.50", "0.00", 0.005, 0.01, False,
        RecommendedAction.MAKE_OFFER,
        id="plan-example-no-cliff",
    ),
    pytest.param(
        Decimal("25.00"), 0.7, 100, 1, True, True,
        "-69.00", "-40.00", "-7.50", "90.00", 0.01, 0.02, True,
        RecommendedAction.MAKE_OFFER,
        id="crosses-fee-cliff",
    ),
    pytest.param(
        Decimal("25.00"), 0.7, 100, 2, True, True,
        "-42.00", "-40.00", "-7.50", "0.00", 0.02, 0.03, False,
        RecommendedAction.MAKE_OFFER,
        id="already-above-threshold-no-cliff-penalty",
    ),
    pytest.param(
        Decimal("99.00"), 0.6, 10, 0, False, True,
        "-45.60", "-114.00", "-29.70", "0.00", 0.0, 0.1, False,
        RecommendedAction.MAKE_OFFER,
        id="non-high-volume-pays-no-fee",
    ),
    pytest.param(
        Decimal("99.00"), 0.55, 500, 0, False, False,
        "-51.30", "-99.00", "-29.70", "0.00", 0.0, 0.002, False,
        RecommendedAction.MAKE_OFFER,
        id="inquiry-no-claim-fee",
    ),
    pytest.param(
        Decimal("10.00"), 0.9, 0, 0, True, False,
        "-41.50", "-10.00", "-3.00", "90.00", 0.0, 1.0, True,
        RecommendedAction.MAKE_OFFER,
        id="zero-sales-uses-max-one",
    ),
    pytest.param(
        Decimal("33.333"), 0.3333, 400, 0, False, False,
        "-32.22", "-33.33", "-10.00", "0.00", 0.0, 0.0025, False,
        RecommendedAction.MAKE_OFFER,
        id="quantization-round-half-up",
    ),
]


@pytest.mark.parametrize(
    (
        "amount,p_win,sales_3mo,disputes_3mo,high_volume,claim_fee,ev_fight,"
        "ev_settle,ev_offer,penalty,ratio_before,ratio_after,crosses,best"
    ),
    VECTORS,
)
def test_compute_ev_exact(
    amount: Decimal,
    p_win: float,
    sales_3mo: int,
    disputes_3mo: int,
    high_volume: bool,
    claim_fee: bool,
    ev_fight: str,
    ev_settle: str,
    ev_offer: str,
    penalty: str,
    ratio_before: float,
    ratio_after: float,
    crosses: bool,
    best: RecommendedAction,
) -> None:
    outcome = compute_ev(
        EvInputs(
            amount_usd=amount,
            p_win=p_win,
            sales_3mo=sales_3mo,
            disputes_3mo=disputes_3mo,
            high_volume=high_volume,
            claim_fee_attached=claim_fee,
        )
    )
    assert _money(outcome.ev_fight) == ev_fight
    assert _money(outcome.ev_settle) == ev_settle
    assert _money(outcome.ev_offer) == ev_offer
    assert _money(outcome.penalty_ratio) == penalty
    assert outcome.ratio_before == ratio_before
    assert outcome.ratio_after == ratio_after
    assert outcome.crosses_cliff is crosses
    assert outcome.best_action is best


def test_round_half_up_on_exact_half_cent() -> None:
    outcome = compute_ev(
        _inputs(
            amount_usd=Decimal("0.01"),
            p_win=0.5,
            sales_3mo=500,
            disputes_3mo=0,
            high_volume=False,
            claim_fee_attached=False,
        )
    )
    # 0.5 * (-0.01 - 15.00) = -7.505 -> ROUND_HALF_UP -> -7.51
    assert _money(outcome.ev_fight) == "-7.51"
    assert _money(outcome.ev_offer) == "0.00"


def test_effective_high_volume_fee() -> None:
    assert _money(effective_high_volume_fee(_inputs(high_volume=True))) == "30.00"
    assert _money(effective_high_volume_fee(_inputs(high_volume=False))) == "0.00"


def test_fee_cliff_requires_crossing_from_below() -> None:
    already_above = compute_ev(_inputs(sales_3mo=100, disputes_3mo=2))
    crossing = compute_ev(_inputs(sales_3mo=100, disputes_3mo=1))
    assert already_above.crosses_cliff is False
    assert _money(already_above.penalty_ratio) == "0.00"
    assert crossing.crosses_cliff is True
    assert _money(crossing.penalty_ratio) == "90.00"
    assert any("fee_cliff: crossing" in note for note in crossing.formula_notes)


def test_formula_notes_are_deterministic_and_explain_numbers() -> None:
    inputs = _inputs(sales_3mo=100, disputes_3mo=1)
    first = compute_ev(inputs)
    second = compute_ev(inputs)
    assert first.formula_notes == second.formula_notes
    joined = " ".join(first.formula_notes)
    assert "ratio_before=0.0100" in joined
    assert "ratio_after=0.0200" in joined
    assert "penalty_ratio=90.00" in joined
    assert "ev_fight=-69.00" in joined
    assert "ev_settle=-40.00" in joined
    assert "ev_offer=-7.50" in joined
    assert first.formula_notes[-1] == "best_action=MAKE_OFFER (highest EV, then cheaper fee)"
    assert all(note.isascii() for note in first.formula_notes)


def test_tie_prefers_earlier_action_when_fees_match() -> None:
    # p=1.0, A=100: ev_fight == ev_offer == -30.00, both carry a zero fee.
    outcome = compute_ev(
        _inputs(
            amount_usd=Decimal("100.00"),
            p_win=1.0,
            sales_3mo=500,
            disputes_3mo=0,
            high_volume=True,
            claim_fee_attached=True,
        )
    )
    assert _money(outcome.ev_fight) == "-30.00"
    assert _money(outcome.ev_offer) == "-30.00"
    assert outcome.best_action is RecommendedAction.PROVIDE_EVIDENCE


def test_pick_best_action_fee_tie_break() -> None:
    chosen = pick_best_action(
        ev_fight=Decimal("-60.00"),
        ev_settle=Decimal("-60.00"),
        ev_offer=Decimal("-100.00"),
        claim_fee_attached=True,
    )
    assert chosen is RecommendedAction.PROVIDE_EVIDENCE
    cheaper = pick_best_action(
        ev_fight=Decimal("-100.00"),
        ev_settle=Decimal("-60.00"),
        ev_offer=Decimal("-60.00"),
        claim_fee_attached=True,
    )
    assert cheaper is RecommendedAction.MAKE_OFFER


def test_compute_ev_is_pure() -> None:
    inputs = _inputs()
    assert compute_ev(inputs) == compute_ev(inputs)


def test_to_breakdown_exact_contract() -> None:
    inputs = _inputs()
    outcome = compute_ev(inputs)
    breakdown = to_breakdown(inputs, outcome)
    assert breakdown.amount_usd == Decimal("25.00")
    assert breakdown.high_volume is True
    assert breakdown.high_volume_fee_usd == Decimal("30.00")
    assert breakdown.standard_fee_usd == Decimal("15.00")
    assert breakdown.penalty_ratio_usd == Decimal("0.00")
    assert breakdown.ratio_before == 0.005
    assert breakdown.ratio_after == 0.01
    assert breakdown.crosses_cliff is False
    assert breakdown.p_win == 0.7
    assert breakdown.offer_ratio == 0.3
    assert breakdown.ev_fight_usd == Decimal("-42.00")
    assert breakdown.ev_settle_usd == Decimal("-40.00")
    assert breakdown.ev_offer_usd == Decimal("-7.50")
    assert breakdown.best_action is RecommendedAction.MAKE_OFFER
    assert breakdown.formula_notes == list(outcome.formula_notes)


def test_to_breakdown_reports_zero_fee_for_non_high_volume() -> None:
    inputs = _inputs(high_volume=False)
    breakdown = to_breakdown(inputs, compute_ev(inputs))
    assert breakdown.high_volume is False
    assert breakdown.high_volume_fee_usd == Decimal("0.00")


def test_invalid_probability_rejected() -> None:
    with pytest.raises(ValueError, match="p_win"):
        compute_ev(_inputs(p_win=1.5))


def test_float_money_rejected() -> None:
    with pytest.raises(TypeError, match="amount_usd"):
        compute_ev(EvInputs(amount_usd=25.0, p_win=0.7, sales_3mo=200, disputes_3mo=1))  # type: ignore[arg-type]


# --------------------------------------------------------------- threshold relation
def test_ratio_relation_reports_already_above_threshold_not_below() -> None:
    """Regression for the live defect: 3.00% was described as below 1.50%.

    150 disputes over 5,000 sales is 3.00%, twice the 1.5% line. ``crosses_cliff``
    is false — not because the merchant is under the line, but because they were
    already over it — so the breakdown must state the relation explicitly.
    """
    inputs = EvInputs(
        amount_usd=Decimal("99.00"),
        p_win=0.42,
        sales_3mo=5000,
        disputes_3mo=149,
    )

    breakdown = to_breakdown(inputs, compute_ev(inputs))

    assert breakdown.ratio_after == pytest.approx(0.03)
    assert breakdown.ratio_threshold == pytest.approx(0.015)
    assert breakdown.ratio_relation == "at_or_above"
    assert breakdown.threshold_crossed_now is False
    assert breakdown.crosses_cliff is False
    # No new cliff penalty, yet the high-volume regime is already in force.
    assert breakdown.penalty_ratio_usd == Decimal("0.00")
    assert breakdown.high_volume_fee_usd == Decimal("30.00")


def test_ratio_relation_reports_below_when_under_the_line() -> None:
    inputs = EvInputs(amount_usd=Decimal("99.00"), p_win=0.5, sales_3mo=5000, disputes_3mo=10)

    breakdown = to_breakdown(inputs, compute_ev(inputs))

    assert breakdown.ratio_relation == "below"
    assert breakdown.threshold_crossed_now is False
    assert breakdown.disputes_3mo == 10


def test_threshold_crossed_now_is_flagged_and_penalised() -> None:
    """One more dispute tips a below-line merchant over: that is the cliff."""
    inputs = EvInputs(amount_usd=Decimal("99.00"), p_win=0.5, sales_3mo=5000, disputes_3mo=74)

    outcome = compute_ev(inputs)
    breakdown = to_breakdown(inputs, outcome)

    # 74/5000 = 1.48% -> 75/5000 = 1.50%, exactly the boundary.
    assert breakdown.ratio_relation == "at_or_above"
    assert breakdown.threshold_crossed_now is True
    assert breakdown.crosses_cliff is True
    assert breakdown.penalty_ratio_usd == Decimal("90.00")


def test_breakdown_carries_the_engine_inputs_used() -> None:
    inputs = EvInputs(amount_usd=Decimal("99.00"), p_win=0.42, sales_3mo=5000, disputes_3mo=149)

    breakdown = to_breakdown(inputs, compute_ev(inputs))

    assert breakdown.sales_3mo == 5000
    assert breakdown.disputes_3mo == 149
    assert breakdown.high_volume_min_sales == inputs.high_volume_min_sales
    assert breakdown.ratio_relation in {"below", "at_or_above"}


# ------------------------------------------------- FIX 4 + fee/EV regressions
def test_frozen_fee_and_threshold_defaults() -> None:
    """The frozen spec values: 1.50% line, 15 standard, 30 high-volume, 0.30 offer."""
    inputs = EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=1, disputes_3mo=0)
    assert inputs.ratio_threshold == Decimal("0.015")
    assert inputs.standard_fee_usd == Decimal("15.00")
    assert inputs.high_volume_fee_usd == Decimal("30.00")
    assert inputs.offer_ratio == Decimal("0.30")
    assert inputs.penalty_multiplier == Decimal("3")
    assert inputs.high_volume_min_sales == 100


def test_ratio_uses_rolling_3mo_counts_with_max_sales_one() -> None:
    outcome = compute_ev(
        EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=0, disputes_3mo=0)
    )
    # max(sales,1): 0/1 -> 0.0 before, 1/1 -> 1.0 after.
    assert outcome.ratio_before == 0.0
    assert outcome.ratio_after == 1.0

    outcome = compute_ev(
        EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=200, disputes_3mo=3)
    )
    assert outcome.ratio_before == pytest.approx(3 / 200)
    assert outcome.ratio_after == pytest.approx(4 / 200)


def test_ratio_relation_exact_boundary_at_015() -> None:
    # 74/5000 = 1.48% below; 75/5000 = 1.50% exactly at the line.
    assert ratio_relation(74 / 5000, Decimal("0.015")) == "below"
    assert ratio_relation(75 / 5000, Decimal("0.015")) == "at_or_above"
    assert ratio_relation(Decimal("0.015"), Decimal("0.015")) == "at_or_above"
    assert ratio_relation(0.01499, Decimal("0.015")) == "below"


def test_canonical_3pct_vs_1_5pct_already_above_fix4() -> None:
    """FIX 4 canonical: 150 disputes / 5000 sales = 3.00% is above 1.50%.

    Already above the line, so no new cliff lands on this dispute — but the
    breakdown must still say "at_or_above", never "below".
    """
    inputs = EvInputs(amount_usd=Decimal("99.00"), p_win=0.42, sales_3mo=5000, disputes_3mo=150)
    outcome = compute_ev(inputs)
    breakdown = to_breakdown(inputs, outcome)

    assert breakdown.ratio_before == pytest.approx(0.03)
    assert breakdown.ratio_after == pytest.approx(151 / 5000)
    assert breakdown.ratio_threshold == pytest.approx(0.015)
    assert breakdown.ratio_relation == "at_or_above"
    assert breakdown.crosses_cliff is False
    assert breakdown.threshold_crossed_now is False
    assert breakdown.penalty_ratio_usd == Decimal("0.00")
    assert breakdown.high_volume_fee_usd == Decimal("30.00")
    # Hand-computed: 0.42*(-30) + 0.58*(-99-15-30) = -12.60 - 83.52.
    assert breakdown.ev_fight_usd == Decimal("-96.12")
    assert breakdown.ev_settle_usd == Decimal("-99.00")
    assert breakdown.ev_offer_usd == Decimal("-29.70")


def test_high_volume_false_never_penalised_even_when_ratio_crosses() -> None:
    """Non-high-volume merchants pay no cliff even when the ratio crosses 1.5%."""
    inputs = EvInputs(
        amount_usd=Decimal("25.00"),
        p_win=0.7,
        sales_3mo=100,
        disputes_3mo=1,
        high_volume=False,
        claim_fee_attached=True,
    )
    outcome = compute_ev(inputs)
    assert outcome.ratio_before == pytest.approx(0.01)
    assert outcome.ratio_after == pytest.approx(0.02)
    assert outcome.crosses_cliff is False
    assert outcome.penalty_ratio == Decimal("0.00")
    # No high-volume leg at all: 0.7*0 + 0.3*(-25-15) = -12.00.
    assert outcome.ev_fight == Decimal("-12.00")


def test_fight_win_leg_pays_only_nonrefundable_high_volume_fee() -> None:
    """Standard 15 is refunded on a win; high-volume 30 is never refunded."""
    won = compute_ev(
        _inputs(amount_usd=Decimal("100.00"), p_win=1.0, high_volume=True,
                claim_fee_attached=True)
    )
    # p=1: win leg is exactly -high_volume_fee.
    assert won.ev_fight == Decimal("-30.00")

    won_non_hv = compute_ev(
        _inputs(amount_usd=Decimal("100.00"), p_win=1.0, high_volume=False,
                claim_fee_attached=True)
    )
    assert won_non_hv.ev_fight == Decimal("0.00")

    lost = compute_ev(
        _inputs(amount_usd=Decimal("100.00"), p_win=0.0, high_volume=True,
                claim_fee_attached=True)
    )
    # p=0, no cliff here: -(100 + 15 + 30).
    assert lost.ev_fight == Decimal("-145.00")


def test_settle_claim_fee_attached_distinction() -> None:
    """Settle is principal+15 claim fee in claim stages, principal only in inquiry."""
    with_fee = compute_ev(_inputs(amount_usd=Decimal("99.00"), claim_fee_attached=True))
    without_fee = compute_ev(_inputs(amount_usd=Decimal("99.00"), claim_fee_attached=False))
    assert with_fee.ev_settle == Decimal("-114.00")
    assert without_fee.ev_settle == Decimal("-99.00")


def test_offer_ratio_scales_linearly_with_amount() -> None:
    outcome = compute_ev(_inputs(amount_usd=Decimal("99.00")))
    assert outcome.ev_offer == Decimal("-29.70")  # -0.30 * 99.00
    custom = compute_ev(
        _inputs(amount_usd=Decimal("200.00"), offer_ratio=Decimal("0.50"))
    )
    assert custom.ev_offer == Decimal("-100.00")


def test_penalty_is_high_volume_fee_times_multiplier() -> None:
    crossing = compute_ev(_inputs(sales_3mo=100, disputes_3mo=1))
    assert crossing.penalty_ratio == Decimal("90.00")  # 30.00 x 3


def test_tie_order_is_fight_then_offer_then_settle() -> None:
    """Frozen tie-break: cheaper fee first, then PROVIDE_EVIDENCE > MAKE_OFFER.

    Frontend parity is read-only here (frontend/lib/ev.ts): the backend order
    is pinned so a naive max() port that prefers settle over offer on ties
    is caught by this test, not by changing the engine.
    """
    # Offer/settle tie at -60 with claim fee attached: offer (no fee) wins.
    assert pick_best_action(
        ev_fight=Decimal("-100.00"),
        ev_settle=Decimal("-60.00"),
        ev_offer=Decimal("-60.00"),
        claim_fee_attached=True,
    ) is RecommendedAction.MAKE_OFFER
    # Three-way tie with no fees: fight first.
    assert pick_best_action(
        ev_fight=Decimal("-10.00"),
        ev_settle=Decimal("-10.00"),
        ev_offer=Decimal("-10.00"),
        claim_fee_attached=False,
    ) is RecommendedAction.PROVIDE_EVIDENCE


def test_breakdown_relation_matches_helper_for_all_states() -> None:
    """Dashboard, analytics, case room and dossier share one helper.

    to_breakdown derives ratio_relation from ratio_after via ratio_relation();
    it must never be inferred from crosses_cliff (false both below the line
    and already above it).
    """
    cases = [
        EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=5000, disputes_3mo=10),
        EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=5000, disputes_3mo=74),
        EvInputs(amount_usd=Decimal("10.00"), p_win=0.5, sales_3mo=5000, disputes_3mo=150),
    ]
    for inputs in cases:
        breakdown = to_breakdown(inputs, compute_ev(inputs))
        assert breakdown.ratio_relation == ratio_relation(
            breakdown.ratio_after, inputs.ratio_threshold
        )
        assert breakdown.threshold_crossed_now is breakdown.crosses_cliff
