"""HATEOAS dispute state machine.

Both guards must agree before an action is legal, in *every* stage:

1. the stage table below (what PayPal's lifecycle permits at all), and
2. PayPal's returned ``links[].rel`` (what PayPal permits on this dispute now).

Links can only narrow the table; a rel missing from ``links`` blocks the action
even when the stage would allow it. The EXTERNAL channel uses the same matrix
as INTERNAL. ``ACCEPT_CLAIM`` is fee-free in INQUIRY and costs the active tier
fee (``$15`` standard, ``$30`` HVD — one fee, never both) in a claim stage.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from app.api import schemas
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage
from app.errors import IllegalDisputeActionError

_ZERO_FEE = Decimal("0.00")
_STANDARD_FEE = Decimal("15.00")
_HVD_FEE = Decimal("30.00")
_REQUIRE_EVIDENCE_REL = "require-evidence"

# The PayPal links[].rel that authorises each action.
_LINK_RELS: dict[DisputeAction, tuple[str, ...]] = {
    DisputeAction.SEND_MESSAGE: ("send-message",),
    DisputeAction.MAKE_OFFER: ("make-offer",),
    DisputeAction.ACCEPT_CLAIM: ("accept-claim",),
    DisputeAction.PROVIDE_EVIDENCE: ("provide-evidence",),
    DisputeAction.ESCALATE: ("escalate",),
    DisputeAction.APPEAL: ("appeal",),
}

# Stage table: the actions PayPal's lifecycle can ever offer at each stage.
_STAGE_ACTIONS: dict[DisputeStage, frozenset[DisputeAction]] = {
    DisputeStage.INQUIRY: frozenset(
        {
            DisputeAction.SEND_MESSAGE,
            DisputeAction.MAKE_OFFER,
            DisputeAction.ACCEPT_CLAIM,
            DisputeAction.PROVIDE_EVIDENCE,
            DisputeAction.ESCALATE,
        }
    ),
    DisputeStage.CHARGEBACK: frozenset(
        {
            DisputeAction.SEND_MESSAGE,
            DisputeAction.MAKE_OFFER,
            DisputeAction.ACCEPT_CLAIM,
            DisputeAction.PROVIDE_EVIDENCE,
        }
    ),
    DisputeStage.PRE_ARBITRATION: frozenset(
        {DisputeAction.ACCEPT_CLAIM, DisputeAction.PROVIDE_EVIDENCE, DisputeAction.APPEAL}
    ),
    DisputeStage.ARBITRATION: frozenset(
        {DisputeAction.ACCEPT_CLAIM, DisputeAction.PROVIDE_EVIDENCE}
    ),
    DisputeStage.RESOLVED: frozenset({DisputeAction.APPEAL}),
    DisputeStage.CLOSED: frozenset(),
}

_STAGE_REASON: dict[DisputeStage, str] = {
    DisputeStage.INQUIRY: "action_not_allowed_in_inquiry",
    DisputeStage.CHARGEBACK: "action_not_allowed_in_chargeback",
    DisputeStage.PRE_ARBITRATION: "action_not_allowed_in_pre_arbitration",
    DisputeStage.ARBITRATION: "action_not_allowed_in_arbitration",
    DisputeStage.RESOLVED: "dispute_resolved",
    DisputeStage.CLOSED: "dispute_closed",
}

CLAIM_STAGES = frozenset(
    {DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION, DisputeStage.ARBITRATION}
)


@dataclass(frozen=True, slots=True)
class Capability:
    """Whether one action is legal, why not, and what PayPal charges for it."""

    allowed: bool
    reason: str | None
    fee_usd: Decimal


def _fee(stage: DisputeStage, action: DisputeAction, *, high_volume: bool) -> Decimal:
    if action is DisputeAction.ACCEPT_CLAIM and stage in CLAIM_STAGES:
        return _HVD_FEE if high_volume else _STANDARD_FEE
    return _ZERO_FEE


def _rels_for(stage: DisputeStage, action: DisputeAction) -> tuple[str, ...]:
    if stage is DisputeStage.INQUIRY and action is DisputeAction.PROVIDE_EVIDENCE:
        # PayPal exposes evidence upload on an inquiry only after it asked for it.
        return (_REQUIRE_EVIDENCE_REL, "provide-evidence")
    return _LINK_RELS[action]


def capabilities(
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
    high_volume: bool = False,
) -> dict[DisputeAction, Capability]:
    """Return the capability for every action at this stage/channel/links."""
    stage_enum = DisputeStage(stage)
    if channel not in (DisputeChannel.INTERNAL, DisputeChannel.EXTERNAL):
        raise ValueError("channel must be INTERNAL or EXTERNAL")
    if not isinstance(links, Mapping):
        raise TypeError("links must be a Mapping")

    permitted = _STAGE_ACTIONS[stage_enum]
    result: dict[DisputeAction, Capability] = {}
    for action in DisputeAction:
        fee = _fee(stage_enum, action, high_volume=high_volume)
        if action not in permitted:
            result[action] = Capability(False, _STAGE_REASON[stage_enum], _ZERO_FEE)
            continue
        rels = _rels_for(stage_enum, action)
        if not any(rel in links for rel in rels):
            result[action] = Capability(False, f"{rels[0]}_link_missing", fee)
            continue
        result[action] = Capability(True, None, fee)
    return result


def paypal_rel(stage: DisputeStage, action: DisputeAction, links: Mapping[str, str]) -> str:
    """The rel that authorises this action (the first one PayPal returned)."""
    rels = _rels_for(DisputeStage(stage), DisputeAction(action))
    for rel in rels:
        if rel in links:
            return rel
    return rels[0]


def expected_rels(stage: DisputeStage) -> dict[str, str]:
    """The rels PayPal returns for a fresh dispute at this stage.

    Only used to build a locally created test dispute (``origin =
    internal_test_event``); hrefs use the ``internal-test:`` scheme so nobody
    mistakes them for PayPal URLs.
    """
    stage_enum = DisputeStage(stage)
    rels: dict[str, str] = {}
    for action in sorted(_STAGE_ACTIONS[stage_enum], key=lambda item: item.value):
        if stage_enum is DisputeStage.INQUIRY and action is DisputeAction.PROVIDE_EVIDENCE:
            continue
        rel = _LINK_RELS[action][0]
        rels[rel] = f"internal-test:{rel}"
    return rels


def to_allowed_actions(
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
    high_volume: bool = False,
) -> list[schemas.AllowedAction]:
    """Render the capability map as the AllowedAction API contract."""
    stage_enum = DisputeStage(stage)
    caps = capabilities(stage=stage_enum, channel=channel, links=links, high_volume=high_volume)
    rendered: list[schemas.AllowedAction] = []
    for action, capability in caps.items():
        link = links.get(paypal_rel(stage_enum, action, links))
        rendered.append(
            schemas.AllowedAction(
                action=action,
                allowed=capability.allowed,
                reason=capability.reason,
                fee_usd=capability.fee_usd,
                paypal_link=str(link) if link is not None else None,
            )
        )
    return rendered


def ensure_allowed(
    action: DisputeAction,
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
) -> None:
    """Raise IllegalDisputeActionError unless the action is legal right now."""
    action_enum = DisputeAction(action)
    stage_enum = DisputeStage(stage)
    capability = capabilities(stage=stage_enum, channel=channel, links=links)[action_enum]
    if capability.allowed:
        return
    raise IllegalDisputeActionError(
        f"Action {action_enum.value} is not allowed at stage {stage_enum.value}.",
        details=[
            {
                "action": action_enum.value,
                "stage": stage_enum.value,
                "reason": capability.reason,
                "veto_code": "VETO_ILLEGAL_HATEOAS_TRANSITION",
            }
        ],
    )
