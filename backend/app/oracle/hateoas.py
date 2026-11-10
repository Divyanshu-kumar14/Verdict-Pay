"""Stdlib HATEOAS table for the Sentinel (mirrors domain.disputes.state_machine).

The Sentinel subprocess cannot import pydantic-backed modules, so the stage
table and rel names live here as plain strings. ``tests/unit/test_sentinel.py``
asserts this table and the state machine agree.
"""

from __future__ import annotations

ACTION_RELS: dict[str, tuple[str, ...]] = {
    "SEND_MESSAGE": ("send-message",),
    "MAKE_OFFER": ("make-offer",),
    "ACCEPT_CLAIM": ("accept-claim",),
    "PROVIDE_EVIDENCE": ("provide-evidence",),
    "ESCALATE": ("escalate",),
    "APPEAL": ("appeal",),
}

STAGE_ACTIONS: dict[str, frozenset[str]] = {
    "INQUIRY": frozenset(
        {"SEND_MESSAGE", "MAKE_OFFER", "ACCEPT_CLAIM", "PROVIDE_EVIDENCE", "ESCALATE"}
    ),
    "CHARGEBACK": frozenset({"SEND_MESSAGE", "MAKE_OFFER", "ACCEPT_CLAIM", "PROVIDE_EVIDENCE"}),
    "PRE_ARBITRATION": frozenset({"ACCEPT_CLAIM", "PROVIDE_EVIDENCE", "APPEAL"}),
    "ARBITRATION": frozenset({"ACCEPT_CLAIM", "PROVIDE_EVIDENCE"}),
    "RESOLVED": frozenset({"APPEAL"}),
    "CLOSED": frozenset(),
}


def rels_for(stage: str, action: str) -> tuple[str, ...]:
    if stage == "INQUIRY" and action == "PROVIDE_EVIDENCE":
        return ("require-evidence", "provide-evidence")
    return ACTION_RELS.get(action, ())


def is_legal(stage: str, action: str, rels: set[str] | frozenset[str]) -> bool:
    if action not in STAGE_ACTIONS.get(stage, frozenset()):
        return False
    return any(rel in rels for rel in rels_for(stage, action))
