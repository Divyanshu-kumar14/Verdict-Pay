"""Deterministic expected-value engine for PayPal dispute actions.

Implements the frozen EV specification: fight, settle and offer are derived from
the same deterministic formula, unit-tested to the cent. Every public function is
pure: identical inputs always produce identical outputs (ADR-003). Money is
Decimal, quantized to cents with ROUND_HALF_UP at the boundary; probabilities
arrive as float and are converted through their shortest decimal representation
so the arithmetic is reproducible.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal

from app.api import schemas
from app.domain.enums import RecommendedAction

_CENTS = Decimal("0.01")
_ZERO = Decimal("0.00")
# Ratios are compared at six decimal places so 0.015 == 1.5% exactly.
_RATIO_PRECISION = Decimal("0.000001")
_ACCEPT_CLAIM_FEE = Decimal("15.00")

# Frozen tie-break order (section 5): cheaper fee first, then this rank.
_ACTION_RANK: dict[RecommendedAction, int] = {
    RecommendedAction.PROVIDE_EVIDENCE: 0,
    RecommendedAction.DEFLECT_INQUIRY: 1,
    RecommendedAction.MAKE_OFFER: 2,
    RecommendedAction.ACCEPT_CLAIM: 3,
}


def _money(value: Decimal) -> Decimal:
    """Quantize a money value to cents with ROUND_HALF_UP (no negative zero)."""
    quantized = value.quantize(_CENTS, rounding=ROUND_HALF_UP)
    return _ZERO if quantized.is_zero() else quantized


def effective_high_volume_fee(inputs: EvInputs) -> Decimal:
    """Return the 30 USD high-volume fee only for high-volume merchants."""
    return inputs.high_volume_fee_usd if inputs.high_volume else _ZERO


@dataclass(frozen=True, slots=True)
class EvInputs:
    """All inputs of the frozen EV model; every field is caller-supplied."""

    amount_usd: Decimal
    p_win: float
    sales_3mo: int
    disputes_3mo: int
    high_volume: bool = True
    claim_fee_attached: bool = False
    offer_ratio: Decimal = Decimal("0.30")
    standard_fee_usd: Decimal = Decimal("15.00")
    high_volume_fee_usd: Decimal = Decimal("30.00")
    ratio_threshold: Decimal = Decimal("0.015")
    penalty_multiplier: Decimal = Decimal("3")
    high_volume_min_sales: int = 100


@dataclass(frozen=True, slots=True)
class EvOutcome:
    """Deterministic result of the EV model for one dispute decision."""

    ev_fight: Decimal
    ev_settle: Decimal
    ev_offer: Decimal
    penalty_ratio: Decimal
    ratio_before: float
    ratio_after: float
    crosses_cliff: bool
    best_action: RecommendedAction
    formula_notes: tuple[str, ...]


def _validate(inputs: EvInputs) -> None:
    """Reject invalid external inputs before any arithmetic happens."""
    if not isinstance(inputs, EvInputs):
        raise TypeError("inputs must be an EvInputs instance")
    money_fields = (
        "amount_usd",
        "offer_ratio",
        "standard_fee_usd",
        "high_volume_fee_usd",
        "ratio_threshold",
        "penalty_multiplier",
    )
    for name in money_fields:
        if not isinstance(getattr(inputs, name), Decimal):
            raise TypeError(f"{name} must be a Decimal")
    if inputs.amount_usd < 0:
        raise ValueError("amount_usd must be non-negative")
    if not math.isfinite(inputs.p_win) or not 0.0 <= inputs.p_win <= 1.0:
        raise ValueError("p_win must be a finite probability between 0 and 1")
    if inputs.sales_3mo < 0:
        raise ValueError("sales_3mo must be non-negative")
    if inputs.disputes_3mo < 0:
        raise ValueError("disputes_3mo must be non-negative")
    if inputs.offer_ratio <= 0 or inputs.offer_ratio > 1:
        raise ValueError("offer_ratio must be in (0, 1]")
    if inputs.standard_fee_usd < 0 or inputs.high_volume_fee_usd < 0:
        raise ValueError("fees must be non-negative")
    if inputs.ratio_threshold < 0:
        raise ValueError("ratio_threshold must be non-negative")
    if inputs.penalty_multiplier < 0:
        raise ValueError("penalty_multiplier must be non-negative")


def pick_best_action(
    *,
    ev_fight: Decimal,
    ev_settle: Decimal,
    ev_offer: Decimal,
    claim_fee_attached: bool,
) -> RecommendedAction:
    """Return the highest-EV financial action with the frozen tie-breaks.

    Ties prefer the cheaper-fee action, then the order
    PROVIDE_EVIDENCE > MAKE_OFFER > ACCEPT_CLAIM.
    """
    values: dict[RecommendedAction, Decimal] = {
        RecommendedAction.PROVIDE_EVIDENCE: ev_fight,
        RecommendedAction.MAKE_OFFER: ev_offer,
        RecommendedAction.ACCEPT_CLAIM: ev_settle,
    }
    fees: dict[RecommendedAction, Decimal] = {
        RecommendedAction.PROVIDE_EVIDENCE: _ZERO,
        RecommendedAction.MAKE_OFFER: _ZERO,
        RecommendedAction.ACCEPT_CLAIM: _ACCEPT_CLAIM_FEE if claim_fee_attached else _ZERO,
    }
    ranked = sorted(
        values,
        key=lambda action: (-values[action], fees[action], _ACTION_RANK[action]),
    )
    return ranked[0]


def compute_ev(inputs: EvInputs) -> EvOutcome:
    """Compute fight/settle/offer EV plus the high-volume fee-cliff penalty."""
    _validate(inputs)

    sales = max(inputs.sales_3mo, 1)
    ratio_before_den = Decimal(inputs.disputes_3mo) / Decimal(sales)
    ratio_after_den = Decimal(inputs.disputes_3mo + 1) / Decimal(sales)
    crosses_cliff = (
        inputs.high_volume
        and ratio_before_den < inputs.ratio_threshold
        and ratio_after_den >= inputs.ratio_threshold
    )

    penalty = (
        _money(inputs.high_volume_fee_usd * inputs.penalty_multiplier)
        if crosses_cliff
        else _ZERO
    )

    p = Decimal(str(inputs.p_win))
    inverse_p = Decimal(1) - p
    amount = inputs.amount_usd
    standard_fee = inputs.standard_fee_usd
    high_volume_fee = effective_high_volume_fee(inputs)

    ev_fight = _money(
        p * (-high_volume_fee)
        + inverse_p * (-amount - standard_fee - high_volume_fee - penalty)
    )
    ev_settle = _money(-(amount + standard_fee)) if inputs.claim_fee_attached else _money(-amount)
    ev_offer = _money(-(inputs.offer_ratio * amount))

    ratio_before = float(ratio_before_den)
    ratio_after = float(ratio_after_den)
    best_action = pick_best_action(
        ev_fight=ev_fight,
        ev_settle=ev_settle,
        ev_offer=ev_offer,
        claim_fee_attached=inputs.claim_fee_attached,
    )
    notes = _formula_notes(
        inputs=inputs,
        sales=sales,
        ratio_before=ratio_before,
        ratio_after=ratio_after,
        penalty=penalty,
        effective_fee=effective_high_volume_fee(inputs),
        p=p,
        inverse_p=inverse_p,
        ev_fight=ev_fight,
        ev_settle=ev_settle,
        ev_offer=ev_offer,
        best_action=best_action,
    )
    return EvOutcome(
        ev_fight=ev_fight,
        ev_settle=ev_settle,
        ev_offer=ev_offer,
        penalty_ratio=penalty,
        ratio_before=ratio_before,
        ratio_after=ratio_after,
        crosses_cliff=crosses_cliff,
        best_action=best_action,
        formula_notes=notes,
    )


def _formula_notes(
    *,
    inputs: EvInputs,
    sales: int,
    ratio_before: float,
    ratio_after: float,
    penalty: Decimal,
    effective_fee: Decimal,
    p: Decimal,
    inverse_p: Decimal,
    ev_fight: Decimal,
    ev_settle: Decimal,
    ev_offer: Decimal,
    best_action: RecommendedAction,
) -> tuple[str, ...]:
    """Build short, human-readable notes explaining the chosen numbers."""
    notes = [
        (
            f"ratio_before={ratio_before:.4f} = disputes_3mo({inputs.disputes_3mo}) / "
            f"max(sales_3mo,1)({sales})"
        ),
        (
            f"ratio_after={ratio_after:.4f} = (disputes_3mo+1)({inputs.disputes_3mo + 1}) / "
            f"max(sales_3mo,1)({sales})"
        ),
    ]
    if penalty > 0:
        notes.append(
            f"fee_cliff: crossing ratio_threshold({inputs.ratio_threshold}) adds "
            f"penalty_ratio={penalty} = high_volume_fee({inputs.high_volume_fee_usd}) x "
            f"penalty_multiplier({inputs.penalty_multiplier})"
        )
    else:
        notes.append(
            f"fee_cliff: no crossing (high_volume={inputs.high_volume}); penalty_ratio=0.00"
        )
    notes.append(
        f"ev_fight={ev_fight} = p({p}) x (-high_volume_fee({effective_fee})) + "
        f"(1-p)({inverse_p}) x (-amount({inputs.amount_usd}) - standard_fee("
        f"{inputs.standard_fee_usd}) - high_volume_fee({effective_fee}) - "
        f"penalty_ratio({penalty})) (high_volume={inputs.high_volume})"
    )
    notes.append(f"ev_settle={ev_settle} (claim_fee_attached={inputs.claim_fee_attached})")
    notes.append(
        f"ev_offer={ev_offer} = -offer_ratio({inputs.offer_ratio}) x amount({inputs.amount_usd})"
    )
    notes.append(f"best_action={best_action.value} (highest EV, then cheaper fee)")
    return tuple(notes)


def ratio_relation(
    ratio: float | Decimal, threshold: float | Decimal
) -> Literal["below", "at_or_above"]:
    """Which side of the high-volume line a dispute ratio sits on.

    One implementation for the dashboard, the case room, the dossier and the AI
    context. Comparing at micro-ratio precision keeps the 1.50% boundary exact:
    ``150/5000`` must read ``at_or_above``, never ``below``.
    """
    observed = Decimal(str(ratio)).quantize(_RATIO_PRECISION)
    limit = Decimal(str(threshold)).quantize(_RATIO_PRECISION)
    return "at_or_above" if observed >= limit else "below"


def to_breakdown(inputs: EvInputs, outcome: EvOutcome) -> schemas.EvBreakdown:
    """Project the frozen inputs/outcome pair onto the API response contract."""
    # The threshold relationship is derived here, once, from the same numbers
    # that drive the arithmetic. Renderers read ``ratio_relation`` instead of
    # inferring it from ``crosses_cliff`` (which is false both below the line
    # and already above it — the source of the "3.00% is below 1.5%" defect).
    relation = ratio_relation(outcome.ratio_after, inputs.ratio_threshold)
    return schemas.EvBreakdown(
        amount_usd=inputs.amount_usd,
        high_volume=inputs.high_volume,
        high_volume_fee_usd=effective_high_volume_fee(inputs),
        standard_fee_usd=inputs.standard_fee_usd,
        penalty_ratio_usd=outcome.penalty_ratio,
        ratio_before=outcome.ratio_before,
        ratio_after=outcome.ratio_after,
        ratio_threshold=float(inputs.ratio_threshold),
        ratio_relation=relation,
        threshold_crossed_now=outcome.crosses_cliff,
        high_volume_min_sales=inputs.high_volume_min_sales,
        sales_3mo=inputs.sales_3mo,
        disputes_3mo=inputs.disputes_3mo,
        crosses_cliff=outcome.crosses_cliff,
        p_win=inputs.p_win,
        offer_ratio=float(inputs.offer_ratio),
        ev_fight_usd=outcome.ev_fight,
        ev_settle_usd=outcome.ev_settle,
        ev_offer_usd=outcome.ev_offer,
        best_action=outcome.best_action,
        formula_notes=list(outcome.formula_notes),
    )
