"""Policy recommendation vs lowest modelled loss — the decision comparison.

Two questions used to be conflated in one sentence ("VerdictPay recommends X
because it has the highest expected value"):

* what do the frozen policy rules select for this stage/channel? and
* which of the three financially modelled options has the smallest loss?

They answer different questions and they are allowed to disagree. Deflecting an
inquiry, for example, is a policy choice that protects the customer relationship
and avoids a chargeback altogether — a benefit the EV model deliberately does not
price. The comparison therefore states both facts separately and never implies
that the recommendation is the cheapest modelled outcome.

Everything here is pure: no I/O, no clock, no randomness, Decimal in / Decimal
out. The same case always renders the same comparison (ADR-003).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from decimal import ROUND_HALF_UP, Decimal
from typing import Final

from app.api import schemas
from app.domain.disputes.triage import _REQUIRED_ACTION as _TRIAGE_REQUIRED_ACTION
from app.domain.enums import DisputeAction, RecommendedAction

_CENTS: Final[Decimal] = Decimal("0.01")
_ZERO: Final[Decimal] = Decimal("0.00")

# The three rows of the financial comparison, in display order.
_OPTION_ORDER: Final[tuple[RecommendedAction, ...]] = (
    RecommendedAction.PROVIDE_EVIDENCE,
    RecommendedAction.ACCEPT_CLAIM,
    RecommendedAction.MAKE_OFFER,
)

# Short row labels for the three modelled options.
_OPTION_LABEL: Final[dict[RecommendedAction, str]] = {
    RecommendedAction.PROVIDE_EVIDENCE: "Fight",
    RecommendedAction.ACCEPT_CLAIM: "Settle",
    RecommendedAction.MAKE_OFFER: "Make offer",
}

# Human labels for every recommendation the policy can return.
_ACTION_LABEL: Final[dict[RecommendedAction, str]] = {
    RecommendedAction.DEFLECT_INQUIRY: "Deflect inquiry",
    RecommendedAction.PROVIDE_EVIDENCE: "Fight (provide evidence)",
    RecommendedAction.ACCEPT_CLAIM: "Settle (accept claim)",
    RecommendedAction.MAKE_OFFER: "Make offer",
    RecommendedAction.MONITOR: "Monitor",
}

_OPTION_DETAIL: Final[dict[RecommendedAction, str]] = {
    RecommendedAction.PROVIDE_EVIDENCE: (
        "Contest the case with the locked evidence dossier; the figure is the "
        "modelled loss if we fight, weighted by the win probability."
    ),
    RecommendedAction.ACCEPT_CLAIM: (
        "Accept the claim and refund in full; the figure is the modelled loss "
        "including any claim fee attached at this stage."
    ),
    RecommendedAction.MAKE_OFFER: (
        "Offer a partial refund to close the case; the figure is the modelled "
        "loss of the offered share of the disputed amount."
    ),
}

# Rationale keys the policy actually reasons over (triage._rationale emits them).
_RATIONALE_KEYS: Final[str] = "stage_channel, win_probability, expected_value and legality"


def _money(value: Decimal | int | float | str) -> Decimal:
    """Quantize a money value to cents, half-up, without negative zero."""
    raw = value if isinstance(value, Decimal) else Decimal(str(value))
    quantized = raw.quantize(_CENTS, rounding=ROUND_HALF_UP)
    return _ZERO if quantized.is_zero() else quantized


def _d(value: Decimal) -> str:
    """Render money as ``$1,234.56`` / ``-$1,234.56`` (deterministic, no locale)."""
    money = _money(value)
    sign = "-" if money < 0 else ""
    return f"{sign}${abs(money):,.2f}"


def _loss_phrase(value: Decimal) -> str:
    """Describe an expected value as a loss or a gain in plain words.

    The engine's EV figures are net amounts: negative means money lost, positive
    means money saved. Saying "$120.00 of modelled loss" is readable where
    "$-120.00" is not.
    """
    money = _money(value)
    if money < 0:
        return f"{_d(-money)} of modelled loss"
    if money > 0:
        return f"a net gain of {_d(money)}"
    return _d(money)


def label_for(action: RecommendedAction) -> str:
    """Return the human label for a recommendation (never raises)."""
    return _ACTION_LABEL.get(RecommendedAction(action), str(action))


def policy_reason_from(
    rationale: Sequence[schemas.RationaleItem | Mapping[str, object]],
    *,
    limit: int = 400,
) -> str:
    """Condense persisted triage rationale into one short, auditable reason.

    Accepts either the persisted JSON rows (``case.action_rationale``) or the
    typed models, so callers never have to reshape them. Deterministic: the same
    rationale always yields the same sentence.
    """
    if not rationale:
        return ""
    rows: dict[str, str] = {}
    for item in rationale:
        if isinstance(item, schemas.RationaleItem):
            key, detail = item.key, item.detail
        elif isinstance(item, Mapping):
            key = str(item.get("key", ""))
            detail = str(item.get("detail", ""))
        else:  # pragma: no cover - defensive, callers pass models or mappings
            continue
        if key and detail:
            rows[key] = detail

    parts: list[str] = []
    decision_detail = rows.get("decision", "")
    rule = next(
        (
            token.removeprefix("rule=")
            for token in decision_detail.split()
            if token.startswith("rule=")
        ),
        "",
    )
    if rule:
        parts.append(f"triage rule {rule}")
    if "stage_channel" in rows:
        parts.append(rows["stage_channel"])
    if "win_probability" in rows:
        parts.append(rows["win_probability"])
    if "legality" in rows:
        parts.append(rows["legality"])
    if not parts:
        parts.append(decision_detail)
    return "; ".join(part for part in parts if part)[:limit]


def _option_values(breakdown: schemas.EvBreakdown) -> dict[RecommendedAction, Decimal]:
    """Map each modelled option onto the engine value for that option."""
    return {
        RecommendedAction.PROVIDE_EVIDENCE: _money(breakdown.ev_fight_usd),
        RecommendedAction.ACCEPT_CLAIM: _money(breakdown.ev_settle_usd),
        RecommendedAction.MAKE_OFFER: _money(breakdown.ev_offer_usd),
    }


def _allowed_by_action(
    allowed_actions: Sequence[schemas.AllowedAction],
) -> dict[DisputeAction, schemas.AllowedAction]:
    """Index the PayPal capability rows by their DisputeAction."""
    indexed: dict[DisputeAction, schemas.AllowedAction] = {}
    for row in allowed_actions:
        indexed[DisputeAction(row.action)] = row
    return indexed


def _paypal_availability(
    action: RecommendedAction,
    indexed: Mapping[DisputeAction, schemas.AllowedAction],
) -> tuple[bool, str | None]:
    """Whether PayPal exposes the action behind a recommendation, and why not.

    The recommendation -> DisputeAction mapping is imported from triage so this
    module can never drift from the policy's own legality model. MONITOR needs
    no PayPal action at all.
    """
    required = _TRIAGE_REQUIRED_ACTION.get(action)
    if required is None:
        return True, "No PayPal action is required for this recommendation."
    row = indexed.get(required)
    if row is None:
        return False, f"{required.value} is not offered by PayPal at this stage."
    if not row.allowed:
        return False, row.reason or f"{required.value} is not allowed at this stage."
    return True, row.reason


def _default_policy_reason(breakdown: schemas.EvBreakdown, policy_action: RecommendedAction) -> str:
    """Fallback reason when the caller does not pass the triage rule detail."""
    return (
        f"the frozen triage ladder selects {label_for(policy_action)} from "
        f"{_RATIONALE_KEYS} (p_win={breakdown.p_win:.4f}, "
        f"ev_fight={_money(breakdown.ev_fight_usd)}, "
        f"ev_settle={_money(breakdown.ev_settle_usd)}, "
        f"ev_offer={_money(breakdown.ev_offer_usd)})"
    )


def _loss_amount(value: Decimal) -> Decimal:
    """Turn the engine's net EV into a loss amount (negative = we come out ahead)."""
    return -_money(value)


def _policy_freedom(policy_action: RecommendedAction) -> str:
    """Name the un-priced benefit that justifies a non-cheapest policy choice."""
    if policy_action is RecommendedAction.DEFLECT_INQUIRY:
        benefit = (
            "deflecting an inquiry answers the buyer directly, preserves the "
            "relationship and avoids the chargeback it would otherwise escalate into"
        )
    elif policy_action is RecommendedAction.MONITOR:
        benefit = (
            "monitoring waits for PayPal to move first, keeping the case open without "
            "spending a defence the stage cannot accept yet"
        )
    else:
        benefit = (
            "deflecting an inquiry or settling early can preserve the customer "
            "relationship and avoid a chargeback or arbitration altogether"
        )
    return (
        f"Policy can deliberately prefer a non-cheapest action here: {benefit} — "
        "outcomes the EV model does not price. That is why the recommendation is a "
        "policy judgement, separate from the purely financial ranking."
    )


def _loss_text(value: Decimal) -> str:
    """Describe one option's modelled loss in plain words."""
    loss = _loss_amount(value)
    if loss > 0:
        return f"{_d(loss)} of modelled loss"
    if loss < 0:
        return f"a net gain of {_d(-loss)}"
    return "$0.00"


def _divergence(
    *,
    policy_action: RecommendedAction,
    breakdown: schemas.EvBreakdown,
    values: Mapping[RecommendedAction, Decimal],
    policy_reason: str,
    availability: Mapping[RecommendedAction, tuple[bool, str | None]],
) -> str:
    """Explain both facts plainly when policy and financial ranking disagree."""
    policy_label = label_for(policy_action)
    best_action = RecommendedAction(breakdown.best_action)
    best_label = label_for(best_action)
    cheapest_loss = _loss_amount(values[best_action])

    sentences = [
        f"Policy rules select {policy_label} — {policy_reason}.",
        (
            "That is a policy preference, not the cheapest modelled outcome: the "
            f"lowest modelled loss is {best_label}, at {_d(cheapest_loss)}."
        ),
    ]

    if policy_action in values:
        policy_loss = _loss_amount(values[policy_action])
        gap = _money(policy_loss - cheapest_loss)
        if gap > 0:
            sentences.append(
                f"The policy action {policy_label} carries {_loss_text(values[policy_action])}, "
                f"which is {_d(gap)} more than {best_label} ({_d(cheapest_loss)})."
            )
        elif gap < 0:
            sentences.append(
                f"The policy action {policy_label} carries {_loss_text(values[policy_action])}, "
                f"which is {_d(-gap)} less than {best_label} ({_d(cheapest_loss)})."
            )
        else:
            sentences.append(
                f"The policy action {policy_label} carries the same "
                f"{_d(cheapest_loss)} figure as {best_label}; the financial tie-break "
                f"still names {best_label} as the cheapest modelled loss."
            )
    else:
        others = ", ".join(
            f"{label_for(option)} {_d(_loss_amount(values[option]))}" for option in _OPTION_ORDER
        )
        losses = [_loss_amount(values[option]) for option in _OPTION_ORDER]
        spread = _money(max(losses) - min(losses))
        sentences.append(
            f"The policy action {policy_label} is not one of the three financially "
            f"modelled options, so it carries no EV figure of its own — those are "
            f"{others}. The modelled options span {_d(spread)} (from {_d(min(losses))} "
            f"to {_d(max(losses))} of loss), and deflection sits outside that range "
            "because the model does not price the chargeback it avoids."
        )

    # A ranking nobody can act on must say so: the cheapest row can be illegal.
    best_available, best_reason = availability[best_action]
    if not best_available:
        reason = best_reason or "not_allowed_at_this_stage"
        sentences.append(
            f"{best_label} is the cheapest modelled loss but PayPal does not offer "
            f"that action here ({reason}), so the ranking alone cannot be acted on — "
            "one more reason the recommendation is a policy judgement rather than a "
            "restatement of the cheapest row."
        )

    sentences.append(_policy_freedom(policy_action))
    sentences.append(
        f"The financial ranking therefore still names {best_label} as the cheapest "
        f"modelled loss while the recommendation remains {policy_label}."
    )
    return " ".join(sentences)


def compare(
    *,
    breakdown: schemas.EvBreakdown,
    policy_action: RecommendedAction,
    allowed_actions: Sequence[schemas.AllowedAction],
    policy_reason: str | None = None,
) -> schemas.DecisionComparison:
    """Return the three-row comparison plus an honest divergence explanation.

    ``agree`` is true only when the policy action is literally the action with the
    lowest modelled loss. Otherwise ``divergence_explanation`` names both actions,
    the dollar gap, and the fact that policy may legitimately prefer a non-cheapest
    action — it never claims the recommendation has the highest expected value.
    """
    if not isinstance(breakdown, schemas.EvBreakdown):
        raise TypeError("breakdown must be a schemas.EvBreakdown")
    action = RecommendedAction(policy_action)
    best_action = RecommendedAction(breakdown.best_action)
    indexed = _allowed_by_action(allowed_actions)
    values = _option_values(breakdown)

    reason = (policy_reason or "").strip() or _default_policy_reason(breakdown, action)
    agree = action is best_action

    options: list[schemas.DecisionOption] = []
    availability: dict[RecommendedAction, tuple[bool, str | None]] = {}
    for option_action in _OPTION_ORDER:
        available, availability_reason = _paypal_availability(option_action, indexed)
        availability[option_action] = (available, availability_reason)
        options.append(
            schemas.DecisionOption(
                action=option_action,
                label=_OPTION_LABEL[option_action],
                value_usd=values[option_action],
                detail=_OPTION_DETAIL[option_action],
                is_policy_choice=action is option_action,
                is_best_financial=best_action is option_action,
                paypal_action_available=available,
                paypal_action_reason=availability_reason,
            )
        )

    return schemas.DecisionComparison(
        policy_action=action,
        policy_label=label_for(action),
        policy_reason=reason,
        best_financial_action=best_action,
        best_financial_label=label_for(best_action),
        agree=agree,
        divergence_explanation=(
            None
            if agree
            else _divergence(
                policy_action=action,
                breakdown=breakdown,
                values=values,
                policy_reason=reason,
                availability=availability,
            )
        ),
        options=options,
    )
