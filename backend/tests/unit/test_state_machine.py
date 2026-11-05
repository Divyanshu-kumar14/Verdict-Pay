"""Full capability matrix for the HATEOAS dispute state machine (plan section 7)."""

from __future__ import annotations

import pytest

from app.domain.disputes.state_machine import (
    Capability,
    capabilities,
    ensure_allowed,
    to_allowed_actions,
)
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage
from app.errors import IllegalDisputeActionError

ACTION_ORDER = [
    DisputeAction.SEND_MESSAGE,
    DisputeAction.MAKE_OFFER,
    DisputeAction.ACCEPT_CLAIM,
    DisputeAction.PROVIDE_EVIDENCE,
]

# stage -> action -> (allowed, reason, fee)
STAGE_EXPECTATIONS = {
    DisputeStage.INQUIRY: {
        DisputeAction.SEND_MESSAGE: (True, None, "0.00"),
        DisputeAction.MAKE_OFFER: (True, None, "0.00"),
        DisputeAction.ACCEPT_CLAIM: (True, None, "0.00"),
        DisputeAction.PROVIDE_EVIDENCE: (
            False,
            "require-evidence_link_missing",
            "0.00",
        ),
    },
    DisputeStage.CHARGEBACK: {
        DisputeAction.SEND_MESSAGE: (True, None, "0.00"),
        DisputeAction.MAKE_OFFER: (True, None, "0.00"),
        DisputeAction.ACCEPT_CLAIM: (True, None, "15.00"),
        DisputeAction.PROVIDE_EVIDENCE: (True, None, "0.00"),
    },
    DisputeStage.PRE_ARBITRATION: {
        DisputeAction.SEND_MESSAGE: (
            False,
            "action_not_allowed_in_pre_arbitration",
            "0.00",
        ),
        DisputeAction.MAKE_OFFER: (
            False,
            "action_not_allowed_in_pre_arbitration",
            "0.00",
        ),
        DisputeAction.ACCEPT_CLAIM: (True, None, "15.00"),
        DisputeAction.PROVIDE_EVIDENCE: (True, None, "0.00"),
    },
    DisputeStage.RESOLVED: {
        DisputeAction.SEND_MESSAGE: (False, "dispute_resolved", "0.00"),
        DisputeAction.MAKE_OFFER: (False, "dispute_resolved", "0.00"),
        DisputeAction.ACCEPT_CLAIM: (False, "dispute_resolved", "0.00"),
        DisputeAction.PROVIDE_EVIDENCE: (False, "dispute_resolved", "0.00"),
    },
    DisputeStage.CLOSED: {
        DisputeAction.SEND_MESSAGE: (False, "dispute_closed", "0.00"),
        DisputeAction.MAKE_OFFER: (False, "dispute_closed", "0.00"),
        DisputeAction.ACCEPT_CLAIM: (False, "dispute_closed", "0.00"),
        DisputeAction.PROVIDE_EVIDENCE: (False, "dispute_closed", "0.00"),
    },
}

MATRIX_CASES = [
    pytest.param(stage, channel, action, expected, id=f"{stage}-{channel}-{action}")
    for stage, actions in STAGE_EXPECTATIONS.items()
    for channel in (DisputeChannel.INTERNAL, DisputeChannel.EXTERNAL)
    for action, expected in actions.items()
]


@pytest.mark.parametrize("stage,channel,action,expected", MATRIX_CASES)
def test_capability_matrix(
    stage: DisputeStage,
    channel: DisputeChannel,
    action: DisputeAction,
    expected: tuple[bool, str | None, str],
) -> None:
    allowed, reason, fee = expected
    caps = capabilities(stage=stage, channel=channel, links={})
    assert isinstance(caps[action], Capability)
    assert caps[action].allowed is allowed
    assert caps[action].reason == reason
    assert str(caps[action].fee_usd) == fee


def test_capabilities_returns_every_action() -> None:
    caps = capabilities(
        stage=DisputeStage.CHARGEBACK, channel=DisputeChannel.INTERNAL, links={}
    )
    assert list(caps) == ACTION_ORDER


def test_inquiry_require_evidence_exception() -> None:
    links = {"require-evidence": "https://api.paypal.com/v1/.../require-evidence"}
    caps = capabilities(
        stage=DisputeStage.INQUIRY, channel=DisputeChannel.INTERNAL, links=links
    )
    assert caps[DisputeAction.PROVIDE_EVIDENCE].allowed is True
    assert caps[DisputeAction.PROVIDE_EVIDENCE].reason is None
    assert str(caps[DisputeAction.PROVIDE_EVIDENCE].fee_usd) == "0.00"


def test_missing_require_evidence_link_is_rejected() -> None:
    with pytest.raises(IllegalDisputeActionError) as excinfo:
        ensure_allowed(
            DisputeAction.PROVIDE_EVIDENCE,
            stage=DisputeStage.INQUIRY,
            channel=DisputeChannel.INTERNAL,
            links={},
        )
    assert excinfo.value.status_code == 422
    assert excinfo.value.code == "illegal_dispute_action"
    assert excinfo.value.details == [
        {
            "action": "PROVIDE_EVIDENCE",
            "stage": "INQUIRY",
            "reason": "require-evidence_link_missing",
        }
    ]


@pytest.mark.parametrize("stage,action", [
    (DisputeStage.CHARGEBACK, DisputeAction.PROVIDE_EVIDENCE),
    (DisputeStage.CHARGEBACK, DisputeAction.ACCEPT_CLAIM),
    (DisputeStage.PRE_ARBITRATION, DisputeAction.PROVIDE_EVIDENCE),
    (DisputeStage.PRE_ARBITRATION, DisputeAction.ACCEPT_CLAIM),
    (DisputeStage.INQUIRY, DisputeAction.SEND_MESSAGE),
    (DisputeStage.INQUIRY, DisputeAction.MAKE_OFFER),
    (DisputeStage.INQUIRY, DisputeAction.ACCEPT_CLAIM),
])
def test_ensure_allowed_returns_none_for_legal_actions(
    stage: DisputeStage, action: DisputeAction
) -> None:
    assert (
        ensure_allowed(action, stage=stage, channel=DisputeChannel.INTERNAL, links={})
        is None
    )


def test_illegal_action_raises_422() -> None:
    with pytest.raises(IllegalDisputeActionError) as excinfo:
        ensure_allowed(
            DisputeAction.SEND_MESSAGE,
            stage=DisputeStage.CLOSED,
            channel=DisputeChannel.EXTERNAL,
            links={"send-message": "https://api.paypal.com/v1/.../send-message"},
        )
    assert excinfo.value.details == [
        {"action": "SEND_MESSAGE", "stage": "CLOSED", "reason": "dispute_closed"}
    ]


def test_to_allowed_actions_contract() -> None:
    rendered = to_allowed_actions(
        stage=DisputeStage.INQUIRY,
        channel=DisputeChannel.INTERNAL,
        links={
            "send-message": "https://api.paypal.com/v1/customer/disputes/PP-1/send-message",
            "require-evidence": "https://api.paypal.com/v1/customer/disputes/PP-1/require-evidence",
        },
    )
    assert [item.action for item in rendered] == ACTION_ORDER
    by_action = {item.action: item for item in rendered}
    assert by_action[DisputeAction.SEND_MESSAGE].allowed is True
    assert by_action[DisputeAction.SEND_MESSAGE].paypal_link == (
        "https://api.paypal.com/v1/customer/disputes/PP-1/send-message"
    )
    assert by_action[DisputeAction.PROVIDE_EVIDENCE].allowed is True
    assert by_action[DisputeAction.PROVIDE_EVIDENCE].paypal_link == (
        "https://api.paypal.com/v1/customer/disputes/PP-1/require-evidence"
    )
    assert by_action[DisputeAction.MAKE_OFFER].paypal_link is None
    assert by_action[DisputeAction.ACCEPT_CLAIM].fee_usd == 0


def test_channel_is_validated() -> None:
    with pytest.raises(ValueError, match="channel"):
        capabilities(stage=DisputeStage.INQUIRY, channel="WRONG", links={})  # type: ignore[arg-type]


def test_stage_is_validated() -> None:
    with pytest.raises(ValueError, match="WRONG"):
        capabilities(stage="WRONG", channel=DisputeChannel.INTERNAL, links={})  # type: ignore[arg-type]
