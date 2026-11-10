"""Deterministic triage policy on top of the EV engine and state machine.

First match wins. Every recommendation is then degraded to a PayPal-legal
action: DEFLECT_INQUIRY -> MAKE_OFFER -> ACCEPT_CLAIM -> MONITOR.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from app.api import schemas
from app.domain.disputes.ev import EvOutcome
from app.domain.disputes.state_machine import capabilities, to_allowed_actions
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage, RecommendedAction

_INQUIRY_STAGES = (DisputeStage.INQUIRY,)
_CLAIM_STAGES = (
    DisputeStage.CHARGEBACK,
    DisputeStage.PRE_ARBITRATION,
    DisputeStage.ARBITRATION,
)

# A recommendation needs this DisputeAction to be legal; MONITOR needs nothing.
_REQUIRED_ACTION: dict[RecommendedAction, DisputeAction | None] = {
    RecommendedAction.DEFLECT_INQUIRY: DisputeAction.SEND_MESSAGE,
    RecommendedAction.MAKE_OFFER: DisputeAction.MAKE_OFFER,
    RecommendedAction.ACCEPT_CLAIM: DisputeAction.ACCEPT_CLAIM,
    RecommendedAction.PROVIDE_EVIDENCE: DisputeAction.PROVIDE_EVIDENCE,
    RecommendedAction.MONITOR: None,
}

# Degradation order when the preferred recommendation is not legally available.
_DEGRADATION_ORDER: tuple[RecommendedAction, ...] = (
    RecommendedAction.DEFLECT_INQUIRY,
    RecommendedAction.MAKE_OFFER,
    RecommendedAction.ACCEPT_CLAIM,
)


@dataclass(frozen=True, slots=True)
class TriageInput:
    """Everything triage needs: state, signals, win probability and EV."""

    stage: DisputeStage
    channel: DisputeChannel
    reason_code: str
    win: schemas.WinProbability
    completeness: float
    ev: EvOutcome
    links: Mapping[str, str]
    amount_usd: Decimal


@dataclass(frozen=True, slots=True)
class TriageDecision:
    """The recommended action plus its auditable rationale and legal actions."""

    action: RecommendedAction
    rationale: list[schemas.RationaleItem]
    allowed_actions: list[schemas.AllowedAction]


def _validate(inputs: TriageInput) -> None:
    """Reject malformed external input before the policy runs."""
    if not isinstance(inputs, TriageInput):
        raise TypeError("inputs must be a TriageInput instance")
    if not isinstance(inputs.win, schemas.WinProbability):
        raise TypeError("win must be a schemas.WinProbability")
    if not isinstance(inputs.ev, EvOutcome):
        raise TypeError("ev must be an EvOutcome")
    if not isinstance(inputs.links, Mapping):
        raise TypeError("links must be a Mapping")
    if not inputs.reason_code:
        raise ValueError("reason_code must be non-empty")
    if not 0.0 <= inputs.completeness <= 1.0:
        raise ValueError("completeness must be between 0 and 1")
    if inputs.amount_usd < 0:
        raise ValueError("amount_usd must be non-negative")


def degrade_to_legal(
    preferred: RecommendedAction,
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
) -> RecommendedAction:
    """Return the preferred action if legal, else the best legal fallback."""
    caps = capabilities(stage=stage, channel=channel, links=links)
    candidates = (preferred, *_DEGRADATION_ORDER)
    seen: set[RecommendedAction] = set()
    for candidate in candidates:
        if candidate in seen:
            continue
        seen.add(candidate)
        required = _REQUIRED_ACTION[candidate]
        if required is None:
            return RecommendedAction.MONITOR
        if caps[required].allowed:
            return candidate
    return RecommendedAction.MONITOR


def _preferred_action(
    inputs: TriageInput,
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    caps: Mapping[DisputeAction, object],
) -> tuple[RecommendedAction, str]:
    """Return the first-matching policy recommendation and its rule key."""
    score = inputs.win.score
    ev = inputs.ev
    if (
        stage in _INQUIRY_STAGES
        and channel is DisputeChannel.INTERNAL
        and inputs.completeness >= 0.6
        and score >= 0.55
    ):
        return RecommendedAction.DEFLECT_INQUIRY, "inquiry_deflection"
    if (
        stage is DisputeStage.INQUIRY
        and caps[DisputeAction.MAKE_OFFER].allowed
        and ev.ev_offer > ev.ev_fight
    ):
        return RecommendedAction.MAKE_OFFER, "inquiry_offer_beats_fight"
    if stage is DisputeStage.INQUIRY and caps[DisputeAction.SEND_MESSAGE].allowed:
        return RecommendedAction.DEFLECT_INQUIRY, "inquiry_deflection_default"
    if stage in _CLAIM_STAGES and ev.ev_fight > ev.ev_settle and score >= 0.35:
        return RecommendedAction.PROVIDE_EVIDENCE, "claim_evidence_positive_ev"
    if stage in _CLAIM_STAGES and ev.ev_fight <= ev.ev_settle:
        return RecommendedAction.ACCEPT_CLAIM, "claim_settle_cheaper"
    return RecommendedAction.MONITOR, "monitor"


def decide(inputs: TriageInput) -> TriageDecision:
    """Apply the frozen triage policy and return a PayPal-legal decision."""
    _validate(inputs)
    stage = DisputeStage(inputs.stage)
    channel = DisputeChannel(inputs.channel)
    caps = capabilities(
        stage=stage, channel=channel, links=inputs.links, high_volume=inputs.ev.high_volume
    )

    preferred, rule = _preferred_action(inputs, stage=stage, channel=channel, caps=caps)
    final = degrade_to_legal(preferred, stage=stage, channel=channel, links=inputs.links)
    rationale = _rationale(
        inputs,
        stage=stage,
        channel=channel,
        rule=rule,
        preferred=preferred,
        final=final,
        caps=caps,
    )
    allowed_actions = to_allowed_actions(
        stage=stage, channel=channel, links=inputs.links, high_volume=inputs.ev.high_volume
    )
    return TriageDecision(
        action=final,
        rationale=rationale,
        allowed_actions=allowed_actions,
    )


def _rationale(
    inputs: TriageInput,
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    rule: str,
    preferred: RecommendedAction,
    final: RecommendedAction,
    caps: Mapping[DisputeAction, object],
) -> list[schemas.RationaleItem]:
    """Build the concrete, numeric audit trail for the decision."""
    ev = inputs.ev
    items = [
        schemas.RationaleItem(
            key="stage_channel",
            label="Dispute posture",
            detail=(
                f"stage={stage.value} channel={channel.value} reason_code={inputs.reason_code} "
                f"amount_usd={inputs.amount_usd} currency=USD"
            ),
        ),
        schemas.RationaleItem(
            key="win_probability",
            label="Win probability",
            detail=(
                f"p_win={inputs.win.score:.4f} completeness={inputs.completeness:.4f} "
                f"reason_multiplier={inputs.win.reason_multiplier:.4f}"
            ),
        ),
        schemas.RationaleItem(
            key="expected_value",
            label="Expected value",
            detail=(
                f"ev_fight={ev.ev_fight} ev_settle={ev.ev_settle} ev_offer={ev.ev_offer} "
                f"best_financial_action={ev.best_action.value}"
            ),
        ),
        schemas.RationaleItem(
            key="fee_cliff",
            label="High-volume fee cliff",
            detail=(
                f"crosses_cliff={str(ev.crosses_cliff).lower()} "
                f"penalty_ratio_usd={ev.penalty_ratio} "
                f"hvd_ratio_before_ppm={ev.ratio_before_ppm} "
                f"hvd_ratio_if_claim_ppm={ev.ratio_after_ppm} "
                f"threshold_ppm={ev.threshold_ppm} fee_tier_usd={ev.fee_tier} "
                f"sla_days={ev.sla_days}"
            ),
        ),
    ]
    if final != preferred:
        required = _REQUIRED_ACTION[preferred]
        reason = caps[required].reason if required is not None else None
        items.append(
            schemas.RationaleItem(
                key="legality",
                label="Action legality",
                detail=(f"preferred={preferred.value} degraded_to={final.value} reason={reason}"),
            )
        )
    items.append(
        schemas.RationaleItem(
            key="decision",
            label="Recommended action",
            detail=f"rule={rule} recommended={final.value}",
        )
    )
    return items
