"""Plain-language explanation of the deterministic EV decision (P4).

Deterministic on purpose: the explanation is derived from the same breakdown the
engine emits, so it can never invent a number.  Gemini is intentionally NOT used
here — a formula explanation cannot hallucinate.

The policy recommendation and the lowest modelled loss are two different
statements, and this module keeps them apart.  A recommendation may be the most
sensible policy move while a different action carries the smallest modelled
loss; the summary therefore never says "recommends X because it has the highest
expected value".
"""

from __future__ import annotations

from decimal import ROUND_DOWN, Decimal

from app.api.schemas import DecisionComparison, EvBreakdown, WinProbability
from app.domain.disputes.decision import label_for
from app.integrations.ai.schemas import PlainExplanation

_CENTS = Decimal("0.01")
_ZERO = Decimal("0.00")


def _money(value: Decimal) -> Decimal:
    """Quantize money to cents, toward zero, without negative zero."""
    raw = value if isinstance(value, Decimal) else Decimal(str(value))
    quantized = raw.quantize(_CENTS, rounding=ROUND_DOWN)
    return _ZERO if quantized.is_zero() else quantized


def _d(money: Decimal) -> str:
    return "$" + f"{_money(money):,.2f}"


def _money_clause(breakdown: EvBreakdown) -> str:
    """Name each modelled loss and the cheapest one, without policy claims."""
    return (
        f"Fighting has an expected value of {_d(breakdown.ev_fight_usd)}, settling "
        f"{_d(breakdown.ev_settle_usd)}, and offering {_d(breakdown.ev_offer_usd)}. "
        "In the financial ranking the smallest modelled loss is "
        f"{label_for(breakdown.best_action)}, but that ranking is not the recommendation."
    )


def explain(
    breakdown: EvBreakdown,
    win: WinProbability,
    comparison: DecisionComparison | None = None,
) -> PlainExplanation:
    """Compose a grounded summary plus the engine's formula notes as bullets.

    ``comparison`` is optional: when the caller already holds the policy-vs-
    financial comparison, the summary quotes both labels and says whether they
    agree.  Without it, the summary still refuses to equate the recommendation
    with the cheapest outcome.
    """
    pct = win.score * 100.0
    head = (
        f"Estimated win probability {pct:.1f}% (base {win.base:.2f} plus signal "
        f"contributions {win.signal_sum:.2f}, adjusted by a reason multiplier of "
        f"{win.reason_multiplier:.2f})."
    )

    bullets = list(breakdown.formula_notes)

    if comparison is None:
        summary = (
            f"{head} {_money_clause(breakdown)} Whether to fight, settle or offer is "
            "decided by the triage policy, which weighs the dispute stage and channel, "
            "the win probability and action legality — it can deliberately choose a "
            "non-cheapest action, so read the recommendation and the modelled ranking "
            "as two separate facts."
        )
        return PlainExplanation(summary=summary, bullets=bullets)

    if comparison.agree:
        summary = (
            f"{head} {_money_clause(breakdown)} Here the two agree: the triage policy "
            f"recommends {comparison.policy_label}, which is also the action with the "
            "smallest modelled loss."
        )
        return PlainExplanation(summary=summary, bullets=bullets)

    divergence = comparison.divergence_explanation or (
        f"the policy recommends {comparison.policy_label} while the smallest modelled "
        f"loss belongs to {comparison.best_financial_label}"
    )
    bullets.append(
        f"policy_choice={comparison.policy_action.value} "
        f"lowest_modelled_loss={comparison.best_financial_action.value}"
    )
    summary = (
        f"{head} {_money_clause(breakdown)} The policy recommendation is "
        f"{comparison.policy_label}, which is a different question from the modelled "
        f"loss ranking. {divergence}"
    )
    return PlainExplanation(summary=summary, bullets=bullets)
