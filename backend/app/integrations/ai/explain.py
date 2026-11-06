"""Plain-language explanation of the deterministic EV decision (P4).

Deterministic on purpose: the explanation is derived from the same breakdown the
engine emits, so it can never invent a number.  Gemini is intentionally NOT used
here — a formula explanation cannot hallucinate.
"""

from __future__ import annotations

from decimal import Decimal

from app.api.schemas import EvBreakdown, WinProbability
from app.integrations.ai.schemas import PlainExplanation


def _d(money: Decimal) -> str:
    return "$" + f"{money:,.2f}"


def explain(breakdown: EvBreakdown, win: WinProbability) -> PlainExplanation:
    """Compose a grounded summary plus the engine's formula notes as bullets."""
    pct = win.score * 100.0
    summary = (
        f"Estimated win probability {pct:.1f}% (base {win.base:.2f} plus signal "
        f"contributions {win.signal_sum:.2f}, adjusted by a reason multiplier of "
        f"{win.reason_multiplier:.2f}). Fighting has an expected value of "
        f"{_d(breakdown.ev_fight_usd)}, settling {_d(breakdown.ev_settle_usd)}, and "
        f"offering {_d(breakdown.ev_offer_usd)}. VerdictPay recommends "
        f"{breakdown.best_action.value} because it has the highest expected value."
    )
    return PlainExplanation(summary=summary, bullets=list(breakdown.formula_notes))
