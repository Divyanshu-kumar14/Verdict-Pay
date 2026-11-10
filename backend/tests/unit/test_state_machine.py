"""Capability matrix for the HATEOAS dispute state machine.

Both guards must agree in every stage: the stage table and PayPal's
``links[].rel``. A rel missing from the links blocks an action the table would
allow.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.domain.disputes.state_machine import (
    Capability,
    capabilities,
    ensure_allowed,
    expected_rels,
    to_allowed_actions,
)
from app.domain.enums import DisputeAction, DisputeChannel, DisputeStage
from app.errors import IllegalDisputeActionError

ALL_RELS = {
    rel: f"https://api-m.sandbox.paypal.com/v1/customer/disputes/PP-D-1/{rel}"
    for rel in (
        "send-message",
        "make-offer",
        "accept-claim",
        "provide-evidence",
        "escalate",
        "appeal",
        "require-evidence",
    )
}

# stage -> actions the stage table permits (given every rel is present)
STAGE_TABLE = {
    DisputeStage.INQUIRY: {
        DisputeAction.SEND_MESSAGE,
        DisputeAction.MAKE_OFFER,
        DisputeAction.ACCEPT_CLAIM,
        DisputeAction.PROVIDE_EVIDENCE,
        DisputeAction.ESCALATE,
    },
    DisputeStage.CHARGEBACK: {
        DisputeAction.SEND_MESSAGE,
        DisputeAction.MAKE_OFFER,
        DisputeAction.ACCEPT_CLAIM,
        DisputeAction.PROVIDE_EVIDENCE,
    },
    DisputeStage.PRE_ARBITRATION: {
        DisputeAction.ACCEPT_CLAIM,
        DisputeAction.PROVIDE_EVIDENCE,
        DisputeAction.APPEAL,
    },
    DisputeStage.ARBITRATION: {DisputeAction.ACCEPT_CLAIM, DisputeAction.PROVIDE_EVIDENCE},
    DisputeStage.RESOLVED: {DisputeAction.APPEAL},
    DisputeStage.CLOSED: set(),
}

MATRIX = [
    pytest.param(stage, channel, action, id=f"{stage}-{channel}-{action}")
    for stage in STAGE_TABLE
    for channel in (DisputeChannel.INTERNAL, DisputeChannel.EXTERNAL)
    for action in DisputeAction
]


@pytest.mark.parametrize("stage,channel,action", MATRIX)
def test_stage_table_with_all_links(
    stage: DisputeStage, channel: DisputeChannel, action: DisputeAction
) -> None:
    cap = capabilities(stage=stage, channel=channel, links=ALL_RELS)[action]
    assert cap.allowed is (action in STAGE_TABLE[stage])
    if not cap.allowed:
        assert cap.reason


@pytest.mark.parametrize("stage", list(STAGE_TABLE))
def test_missing_links_block_every_stage(stage: DisputeStage) -> None:
    caps = capabilities(stage=stage, channel=DisputeChannel.INTERNAL, links={})
    assert not any(cap.allowed for cap in caps.values())
    for action in STAGE_TABLE[stage]:
        assert caps[action].reason is not None
        assert caps[action].reason.endswith("_link_missing")


@pytest.mark.parametrize("stage", [DisputeStage.CHARGEBACK, DisputeStage.PRE_ARBITRATION])
def test_single_rel_unlocks_only_its_action(stage: DisputeStage) -> None:
    caps = capabilities(stage=stage, channel=DisputeChannel.INTERNAL, links={"accept-claim": "x"})
    allowed = {action for action, cap in caps.items() if cap.allowed}
    assert allowed == {DisputeAction.ACCEPT_CLAIM}


def test_inquiry_evidence_needs_require_or_provide_evidence_rel() -> None:
    links = {
        rel: href
        for rel, href in ALL_RELS.items()
        if rel not in {"require-evidence", "provide-evidence"}
    }
    caps = capabilities(stage=DisputeStage.INQUIRY, channel=DisputeChannel.INTERNAL, links=links)
    assert caps[DisputeAction.PROVIDE_EVIDENCE] == Capability(
        False, "require-evidence_link_missing", Decimal("0.00")
    )
    caps = capabilities(
        stage=DisputeStage.INQUIRY,
        channel=DisputeChannel.INTERNAL,
        links={"require-evidence": "x"},
    )
    assert caps[DisputeAction.PROVIDE_EVIDENCE].allowed is True


@pytest.mark.parametrize(
    "stage,high_volume,fee",
    [
        (DisputeStage.INQUIRY, False, "0.00"),
        (DisputeStage.INQUIRY, True, "0.00"),
        (DisputeStage.CHARGEBACK, False, "15.00"),
        (DisputeStage.CHARGEBACK, True, "30.00"),
        (DisputeStage.PRE_ARBITRATION, False, "15.00"),
        (DisputeStage.PRE_ARBITRATION, True, "30.00"),
        (DisputeStage.ARBITRATION, True, "30.00"),
    ],
)
def test_accept_claim_fee_is_one_tier_fee(stage: DisputeStage, high_volume: bool, fee: str) -> None:
    cap = capabilities(
        stage=stage, channel=DisputeChannel.INTERNAL, links=ALL_RELS, high_volume=high_volume
    )[DisputeAction.ACCEPT_CLAIM]
    assert cap.allowed is True
    assert cap.fee_usd == Decimal(fee)


def test_capabilities_returns_every_action() -> None:
    caps = capabilities(stage=DisputeStage.CHARGEBACK, channel=DisputeChannel.EXTERNAL, links={})
    assert list(caps) == list(DisputeAction)


def test_ensure_allowed_and_veto_detail() -> None:
    ensure_allowed(
        DisputeAction.ACCEPT_CLAIM,
        stage=DisputeStage.CHARGEBACK,
        channel=DisputeChannel.INTERNAL,
        links={"accept-claim": "x"},
    )
    with pytest.raises(IllegalDisputeActionError) as raised:
        ensure_allowed(
            DisputeAction.MAKE_OFFER,
            stage=DisputeStage.PRE_ARBITRATION,
            channel=DisputeChannel.INTERNAL,
            links=ALL_RELS,
        )
    assert raised.value.status_code == 422
    detail = raised.value.details[0]
    assert detail["reason"] == "action_not_allowed_in_pre_arbitration"
    assert detail["veto_code"] == "VETO_ILLEGAL_HATEOAS_TRANSITION"


def test_to_allowed_actions_contract() -> None:
    rendered = to_allowed_actions(
        stage=DisputeStage.CHARGEBACK,
        channel=DisputeChannel.INTERNAL,
        links={"accept-claim": "https://paypal/accept"},
        high_volume=True,
    )
    by_action = {item.action: item for item in rendered}
    accept = by_action[DisputeAction.ACCEPT_CLAIM]
    assert accept.allowed is True
    assert accept.fee_usd == Decimal("30.00")
    assert accept.paypal_link == "https://paypal/accept"
    assert by_action[DisputeAction.SEND_MESSAGE].allowed is False
    assert by_action[DisputeAction.SEND_MESSAGE].reason == "send-message_link_missing"


@pytest.mark.parametrize("stage", list(STAGE_TABLE))
def test_expected_rels_unlock_exactly_the_stage_table(stage: DisputeStage) -> None:
    links = expected_rels(stage)
    assert all(href.startswith("internal-test:") for href in links.values())
    caps = capabilities(stage=stage, channel=DisputeChannel.INTERNAL, links=links)
    allowed = {action for action, cap in caps.items() if cap.allowed}
    assert allowed == STAGE_TABLE[stage] - (
        {DisputeAction.PROVIDE_EVIDENCE} if stage is DisputeStage.INQUIRY else set()
    )


def test_unknown_channel_rejected() -> None:
    with pytest.raises(ValueError):
        capabilities(stage=DisputeStage.INQUIRY, channel="PHONE", links={})  # type: ignore[arg-type]
