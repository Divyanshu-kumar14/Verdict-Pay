"""Deterministic expected-value engine for PayPal dispute actions.

Every public function is pure: identical inputs always produce identical outputs
(ADR-003). Money is Decimal quantized to cents with ROUND_DOWN; ratios are
integer parts-per-million from :mod:`app.oracle.cliff_engine`; probabilities are
Decimal. No binary float participates in any calculation.

Fee model (PayPal, April 2026 policy manifest):

* Standard tier: a lost claim costs ``amount + $15``; a won claim costs ``$0``
  (the fee is reimbursed).
* High-Volume Dispute (HVD) tier: the ``$30`` fee *replaces* the ``$15`` fee.
  A lost claim costs ``amount + $30``; a won claim still costs ``$30``
  (non-reimbursable). It is never ``$15 + $30``.
* ``ACCEPT_CLAIM`` in ``INQUIRY`` is fee-free; in a claim stage it costs the
  active tier fee.
* Fighting an INQUIRY that would cross the HVD cliff if it escalates adds a
  portfolio penalty: the fee uplift ``($30 - $15)`` times
  ``penalty_multiplier`` future claims (claim-stage crossings are sunk).

The HVD ratio is dollar-weighted and wallet-only: ``disputed_amount / net
sales`` over the lookback. An unescalated INQUIRY is *not* added to the ratio;
only the fight path prices the risk that it escalates into a countable claim.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_DOWN, Decimal
from typing import Literal

from app.api import schemas
from app.domain.enums import DisputeStage, RecommendedAction
from app.oracle.cliff_engine import HvdState, hvd_after_escalation, hvd_state
from app.oracle.manifest import get_manifest
from app.oracle.money import PPM, from_minor, money_round_down, ppm_str, to_minor

_CENTS = Decimal("0.01")
_ZERO = Decimal("0.00")
_RATIO_PRECISION = Decimal("0.000001")
PAYPAL_WALLET = "PAYPAL_WALLET"
UNBRANDED_CARD = "UNBRANDED_CARD"
_CLAIM_STAGES = frozenset(
    {DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION, DisputeStage.ARBITRATION}
)

# Frozen tie-break order: cheaper fee first, then this rank.
_ACTION_RANK: dict[RecommendedAction, int] = {
    RecommendedAction.PROVIDE_EVIDENCE: 0,
    RecommendedAction.DEFLECT_INQUIRY: 1,
    RecommendedAction.MAKE_OFFER: 2,
    RecommendedAction.ACCEPT_CLAIM: 3,
}


def _money(value: Decimal) -> Decimal:
    """Quantize a money value to cents toward zero (no negative zero)."""
    return money_round_down(value)


def _as_probability(value: Decimal | float | int | str) -> Decimal:
    if isinstance(value, bool):
        raise TypeError("p_win must be numeric")
    if isinstance(value, Decimal):
        return value
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError("p_win must be a finite probability between 0 and 1")
    # str() gives the shortest round-trip form, so 0.6375 stays exactly 0.6375.
    return Decimal(str(value))


def is_hvd_countable(*, payment_rail: str, reason_code: str) -> bool:
    """Wallet INR/SNAD claims count toward HVD; card-rail and unauthorised do not."""
    rules = get_manifest().section("hvd")
    return payment_rail == rules["rail"] and reason_code in set(rules["countable_reasons"])


@dataclass(frozen=True, slots=True)
class EvInputs:
    """All inputs of the EV model; every field is caller-supplied."""

    amount_usd: Decimal
    p_win: Decimal | float
    stage: DisputeStage = DisputeStage.CHARGEBACK
    payment_rail: str = PAYPAL_WALLET
    reason_code: str = "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    settled_txns_3m: int = 0
    net_sales_minor_3m: int = 0
    disputed_amount_minor_3m: int = 0
    disputes_3mo: int = 0
    offer_ratio: Decimal = Decimal("0.30")
    penalty_multiplier: Decimal = Decimal("3")

    @property
    def claim_stage(self) -> bool:
        return DisputeStage(self.stage) in _CLAIM_STAGES


@dataclass(frozen=True, slots=True)
class EvOutcome:
    """Deterministic result of the EV model for one dispute decision."""

    ev_fight: Decimal
    ev_settle: Decimal
    ev_offer: Decimal
    penalty_ratio: Decimal
    fee_tier: Decimal
    standard_fee: Decimal
    high_volume_fee: Decimal
    accept_fee: Decimal
    win_fee: Decimal
    high_volume: bool
    hvd_countable: bool
    ratio_before_ppm: int
    ratio_after_ppm: int
    threshold_ppm: int
    crosses_cliff: bool
    sla_days: int
    hvd_before: HvdState
    hvd_after: HvdState
    best_action: RecommendedAction
    formula_notes: tuple[str, ...]


def _validate(inputs: EvInputs) -> Decimal:
    if not isinstance(inputs, EvInputs):
        raise TypeError("inputs must be an EvInputs instance")
    for name in ("amount_usd", "offer_ratio", "penalty_multiplier"):
        if not isinstance(getattr(inputs, name), Decimal):
            raise TypeError(f"{name} must be a Decimal")
    if inputs.amount_usd < 0:
        raise ValueError("amount_usd must be non-negative")
    p = _as_probability(inputs.p_win)
    if not p.is_finite() or not Decimal(0) <= p <= Decimal(1):
        raise ValueError("p_win must be a finite probability between 0 and 1")
    for name in ("settled_txns_3m", "net_sales_minor_3m", "disputed_amount_minor_3m"):
        value = getattr(inputs, name)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ValueError(f"{name} must be a non-negative int")
    if inputs.disputes_3mo < 0:
        raise ValueError("disputes_3mo must be non-negative")
    if inputs.offer_ratio <= 0 or inputs.offer_ratio > 1:
        raise ValueError("offer_ratio must be in (0, 1]")
    if inputs.penalty_multiplier < 0:
        raise ValueError("penalty_multiplier must be non-negative")
    if inputs.payment_rail not in (PAYPAL_WALLET, UNBRANDED_CARD):
        raise ValueError("payment_rail must be PAYPAL_WALLET or UNBRANDED_CARD")
    DisputeStage(inputs.stage)
    return p


def pick_best_action(
    *,
    ev_fight: Decimal,
    ev_settle: Decimal,
    ev_offer: Decimal,
    accept_fee: Decimal = _ZERO,
) -> RecommendedAction:
    """Highest-EV financial action; ties prefer the cheaper fee, then the rank."""
    values: dict[RecommendedAction, Decimal] = {
        RecommendedAction.PROVIDE_EVIDENCE: ev_fight,
        RecommendedAction.MAKE_OFFER: ev_offer,
        RecommendedAction.ACCEPT_CLAIM: ev_settle,
    }
    fees: dict[RecommendedAction, Decimal] = {
        RecommendedAction.PROVIDE_EVIDENCE: _ZERO,
        RecommendedAction.MAKE_OFFER: _ZERO,
        RecommendedAction.ACCEPT_CLAIM: accept_fee,
    }
    ranked = sorted(
        values,
        key=lambda action: (-values[action], fees[action], _ACTION_RANK[action]),
    )
    return ranked[0]


def compute_ev(inputs: EvInputs) -> EvOutcome:
    """Compute fight/settle/offer EV with the two-tier fee model and cliff penalty."""
    p = _validate(inputs)
    rules = get_manifest().section("hvd")
    standard_fee = from_minor(int(rules["standard_fee_minor"]))
    high_volume_fee = from_minor(int(rules["hvd_fee_minor"]))
    amount = inputs.amount_usd
    stage = DisputeStage(inputs.stage)

    countable = is_hvd_countable(payment_rail=inputs.payment_rail, reason_code=inputs.reason_code)
    before = hvd_state(
        settled_txns_3m=inputs.settled_txns_3m,
        net_sales_minor_3m=inputs.net_sales_minor_3m,
        disputed_amount_minor_3m=inputs.disputed_amount_minor_3m,
    )
    after = (
        hvd_after_escalation(before, added_disputed_minor=to_minor(amount)) if countable else before
    )
    crosses_cliff = countable and not before.in_tier and after.in_tier
    # A claim already counts; an INQUIRY only counts if it escalates (fight path).
    tier_now = after.in_tier if inputs.claim_stage else before.in_tier
    tier_if_claim = after.in_tier

    fee_now = high_volume_fee if tier_now else standard_fee
    fee_if_claim = high_volume_fee if tier_if_claim else standard_fee
    win_fee = high_volume_fee if tier_if_claim else _ZERO

    # The cliff penalty prices *escalation*: only fighting an INQUIRY can turn
    # it into a countable claim. In a claim stage the claim already counts
    # whatever the seller does, so the crossing is sunk and unpriced.
    penalty = (
        _money((high_volume_fee - standard_fee) * inputs.penalty_multiplier)
        if crosses_cliff and not inputs.claim_stage
        else _ZERO
    )
    inverse_p = Decimal(1) - p
    ev_fight = _money(p * (-win_fee) + inverse_p * (-(amount + fee_if_claim) - penalty))
    accept_fee = fee_now if inputs.claim_stage else _ZERO
    ev_settle = _money(-(amount + accept_fee))
    ev_offer = _money(-(inputs.offer_ratio * amount))

    best_action = pick_best_action(
        ev_fight=ev_fight, ev_settle=ev_settle, ev_offer=ev_offer, accept_fee=accept_fee
    )
    notes = (
        f"hvd_ratio_before={before.ratio_str} ({before.ratio_ppm} ppm) = "
        f"disputed_3m({before.disputed_amount_str_3m}) / net_sales_3m("
        f"{before.net_sales_amount_str_3m}); settled_txns_3m={before.settled_txns_3m}",
        (
            f"hvd_ratio_if_claim={after.ratio_str} ({after.ratio_ppm} ppm) adds this "
            f"{inputs.reason_code} claim ({amount})"
            if countable
            else f"not HVD-countable (rail={inputs.payment_rail}, reason={inputs.reason_code})"
        ),
        f"tier: {'HVD $30 (replaces $15, non-reimbursable on win)' if tier_if_claim else 'standard $15 (reimbursed on win)'}"  # noqa: E501
        f"; SLA {after.sla_response_days if inputs.claim_stage else before.sla_response_days}d",
        (
            f"fee_cliff: this claim crosses {ppm_str(before.threshold_ppm)}; "
            f"penalty={penalty} = (30.00-15.00) x {inputs.penalty_multiplier}"
            if crosses_cliff
            else "fee_cliff: no crossing; penalty=0.00"
        ),
        f"ev_fight={ev_fight} = p({p}) x (-win_fee {win_fee}) + (1-p)({inverse_p}) x "
        f"(-(amount {amount} + fee {fee_if_claim}) - penalty {penalty})",
        f"ev_settle={ev_settle} = -(amount {amount} + accept_fee {accept_fee}) "
        f"(stage={stage.value})",
        f"ev_offer={ev_offer} = -offer_ratio({inputs.offer_ratio}) x amount({amount}); fee 0.00",
        f"best_action={best_action.value} (highest EV, then cheaper fee)",
    )
    return EvOutcome(
        ev_fight=ev_fight,
        ev_settle=ev_settle,
        ev_offer=ev_offer,
        penalty_ratio=penalty,
        fee_tier=fee_now,
        standard_fee=standard_fee,
        high_volume_fee=high_volume_fee,
        accept_fee=accept_fee,
        win_fee=win_fee,
        high_volume=tier_now,
        hvd_countable=countable,
        ratio_before_ppm=before.ratio_ppm,
        ratio_after_ppm=after.ratio_ppm,
        threshold_ppm=before.threshold_ppm,
        crosses_cliff=crosses_cliff,
        sla_days=after.sla_response_days if inputs.claim_stage else before.sla_response_days,
        hvd_before=before,
        hvd_after=after,
        best_action=best_action,
        formula_notes=notes,
    )


def ratio_relation_ppm(ratio: int, threshold: int) -> Literal["below", "at_or_above"]:
    return "at_or_above" if ratio >= threshold else "below"


def ratio_relation(
    ratio: Decimal | int | str, threshold: Decimal | int | str
) -> Literal["below", "at_or_above"]:
    """Which side of the high-volume line a ratio sits on (exact, no floats)."""
    observed = Decimal(str(ratio)).quantize(_RATIO_PRECISION, rounding=ROUND_DOWN)
    limit = Decimal(str(threshold)).quantize(_RATIO_PRECISION, rounding=ROUND_DOWN)
    return "at_or_above" if observed >= limit else "below"


def _ppm_decimal(ppm: int) -> Decimal:
    return Decimal(ppm) / PPM


def to_breakdown(inputs: EvInputs, outcome: EvOutcome) -> schemas.EvBreakdown:
    """Project the inputs/outcome pair onto the API response contract."""
    shown_ratio = outcome.ratio_after_ppm if inputs.claim_stage else outcome.ratio_before_ppm
    return schemas.EvBreakdown(
        amount_usd=inputs.amount_usd,
        high_volume=outcome.high_volume,
        high_volume_fee_usd=outcome.high_volume_fee if outcome.high_volume else _ZERO,
        standard_fee_usd=outcome.standard_fee,
        fee_tier_usd=outcome.fee_tier,
        accept_fee_usd=outcome.accept_fee,
        win_fee_usd=outcome.win_fee,
        fee_reimbursable_on_win=outcome.win_fee == _ZERO,
        sla_response_days=outcome.sla_days,
        penalty_ratio_usd=outcome.penalty_ratio,
        ratio_before=_ppm_decimal(outcome.ratio_before_ppm),
        ratio_after=_ppm_decimal(outcome.ratio_after_ppm),
        ratio_before_ppm=outcome.ratio_before_ppm,
        ratio_after_ppm=outcome.ratio_after_ppm,
        ratio_threshold_ppm=outcome.threshold_ppm,
        ratio_before_str=ppm_str(outcome.ratio_before_ppm),
        ratio_after_str=ppm_str(outcome.ratio_after_ppm),
        ratio_threshold=_ppm_decimal(outcome.threshold_ppm),
        ratio_relation=ratio_relation_ppm(shown_ratio, outcome.threshold_ppm),
        threshold_crossed_now=outcome.crosses_cliff,
        high_volume_min_sales=int(get_manifest().section("hvd")["min_settled_txns_exclusive"]),
        sales_3mo=inputs.settled_txns_3m,
        disputes_3mo=inputs.disputes_3mo,
        net_sales_minor_3m=inputs.net_sales_minor_3m,
        disputed_amount_minor_3m=inputs.disputed_amount_minor_3m,
        payment_rail=inputs.payment_rail,
        hvd_countable=outcome.hvd_countable,
        crosses_cliff=outcome.crosses_cliff,
        p_win=_as_probability(inputs.p_win),
        offer_ratio=inputs.offer_ratio,
        ev_fight_usd=outcome.ev_fight,
        ev_settle_usd=outcome.ev_settle,
        ev_offer_usd=outcome.ev_offer,
        best_action=outcome.best_action,
        formula_notes=list(outcome.formula_notes),
        source_plane="LIVE_PAYPAL_SANDBOX"
        if inputs.payment_rail == PAYPAL_WALLET
        else "SIMULATED_CARD_NETWORK_FEED",
    )
