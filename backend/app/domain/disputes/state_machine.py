"""HATEOAS dispute state machine.

PayPal's returned links[] are authoritative: the stage table is the guard that
rejects an action the API would refuse, and INQUIRY evidence uploads are only
legal when PayPal exposed the require-evidence action. The EXTERNAL channel uses
the same capability matrix as INTERNAL (frozen plan section 7).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from decimal import Decimal

from app.api import schemas
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage
from app.errors import IllegalDisputeActionError

_ZERO_FEE = Decimal("0.00")
_ACCEPT_CLAIM_FEE = Decimal("15.00")
_REQUIRE_EVIDENCE_REL = "require-evidence"

_LINK_RELS: dict[DisputeAction, str] = {
    DisputeAction.SEND_MESSAGE: "send-message",
    DisputeAction.MAKE_OFFER: "make-offer",
    DisputeAction.ACCEPT_CLAIM: "accept-claim",
    DisputeAction.PROVIDE_EVIDENCE: "provide-evidence",
}

_STAGE_REASON: dict[DisputeStage, str] = {
    DisputeStage.INQUIRY: "action_not_allowed_in_inquiry",
    DisputeStage.CHARGEBACK: "action_not_allowed_in_chargeback",
    DisputeStage.PRE_ARBITRATION: "action_not_allowed_in_pre_arbitration",
    DisputeStage.RESOLVED: "dispute_resolved",
    DisputeStage.CLOSED: "dispute_closed",
}


@dataclass(frozen=True, slots=True)
class Capability:
    """Whether one action is legal, why not, and what PayPal charges for it."""

    allowed: bool
    reason: str | None
    fee_usd: Decimal


def _stage_rule(stage: DisputeStage, action: DisputeAction) -> Capability:
    """Apply the frozen stage table, ignoring the returned links."""
    if stage is DisputeStage.INQUIRY:
        if action is DisputeAction.PROVIDE_EVIDENCE:
            return Capability(False, _REQUIRE_EVIDENCE_REL + "_link_missing", _ZERO_FEE)
        return Capability(True, None, _ZERO_FEE)
    if stage is DisputeStage.CHARGEBACK:
        fee = _ACCEPT_CLAIM_FEE if action is DisputeAction.ACCEPT_CLAIM else _ZERO_FEE
        return Capability(True, None, fee)
    if stage is DisputeStage.PRE_ARBITRATION:
        if action is DisputeAction.ACCEPT_CLAIM:
            return Capability(True, None, _ACCEPT_CLAIM_FEE)
        if action is DisputeAction.PROVIDE_EVIDENCE:
            return Capability(True, None, _ZERO_FEE)
        return Capability(False, _STAGE_REASON[stage], _ZERO_FEE)
    return Capability(False, _STAGE_REASON[stage], _ZERO_FEE)


def capabilities(
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
) -> dict[DisputeAction, Capability]:
    """Return the capability for every action at this stage/channel.

    The stage table and the returned links must both allow an action. Links can
    only narrow the table: in INQUIRY, provide-evidence additionally requires the
    require-evidence rel; everywhere else the table is the authority.
    """
    stage_enum = DisputeStage(stage)
    if channel not in (DisputeChannel.INTERNAL, DisputeChannel.EXTERNAL):
        raise ValueError("channel must be INTERNAL or EXTERNAL")
    if not isinstance(links, Mapping):
        raise TypeError("links must be a Mapping")

    result: dict[DisputeAction, Capability] = {}
    for action in DisputeAction:
        capability = _stage_rule(stage_enum, action)
        if stage_enum is DisputeStage.INQUIRY and action is DisputeAction.PROVIDE_EVIDENCE:
            if _REQUIRE_EVIDENCE_REL in links:
                capability = Capability(True, None, _ZERO_FEE)
            else:
                capability = Capability(
                    False, _REQUIRE_EVIDENCE_REL + "_link_missing", _ZERO_FEE
                )
        result[action] = capability
    return result


def _paypal_rel(stage: DisputeStage, action: DisputeAction) -> str:
    """Return the PayPal link rel that authorises this action at this stage."""
    if stage is DisputeStage.INQUIRY and action is DisputeAction.PROVIDE_EVIDENCE:
        return _REQUIRE_EVIDENCE_REL
    return _LINK_RELS[action]


def to_allowed_actions(
    *,
    stage: DisputeStage,
    channel: DisputeChannel,
    links: Mapping[str, str],
) -> list[schemas.AllowedAction]:
    """Render the capability map as the frozen AllowedAction API contract."""
    stage_enum = DisputeStage(stage)
    caps = capabilities(stage=stage_enum, channel=channel, links=links)
    rendered: list[schemas.AllowedAction] = []
    for action, capability in caps.items():
        link = links.get(_paypal_rel(stage_enum, action))
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
            }
        ],
    )
