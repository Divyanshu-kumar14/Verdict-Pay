"""Exact-value tests for the frozen win-probability weights (plan section 6)."""

from __future__ import annotations

import pytest

from app.domain.disputes.win_probability import (
    BASE,
    REASON_MULTIPLIERS,
    SIGNAL_ORDER,
    WEIGHTS,
    SignalSet,
    completeness,
    score_win_probability,
)

ALL_SIGNALS = SignalSet(
    tos_accepted=True,
    ip_match=True,
    asset_delivered=True,
    usage_metered=True,
    chain_verified=True,
    ce3_historical_match=True,
)


@pytest.mark.parametrize(
    "signals,reason,expected_score,expected_sum",
    [
        (ALL_SIGNALS, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 0.95, 0.9),
        (ALL_SIGNALS, "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 0.9, 0.9),
        (ALL_SIGNALS, "UNAUTHORIZED", 0.75, 0.9),
        (SignalSet(), "MERCHANDISE_OR_SERVICE_NOT_RECEIVED", 0.10, 0.0),
        (SignalSet(), "UNAUTHORIZED", 0.075, 0.0),
        (SignalSet(), "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED", 0.09, 0.0),
        (
            SignalSet(tos_accepted=True, asset_delivered=True, chain_verified=True),
            "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
            0.53,
            0.43,
        ),
    ],
)
def test_score_exact(
    signals: SignalSet, reason: str, expected_score: float, expected_sum: float
) -> None:
    result = score_win_probability(signals, reason)
    assert result.score == expected_score
    assert result.base == BASE == 0.10
    assert result.signal_sum == expected_sum
    assert result.reason_multiplier == REASON_MULTIPLIERS[reason]


def test_clamp_and_contributions_order() -> None:
    result = score_win_probability(ALL_SIGNALS, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED")
    assert result.score == 0.95
    assert [item.key for item in result.signals] == list(SIGNAL_ORDER)
    assert [item.label for item in result.signals] == [
        "Terms of Service accepted",
        "Session IP matches checkout IP",
        "Asset delivered with SHA-256",
        "Metered usage above zero",
        "Telemetry chain verified",
        "Visa CE 3.0 prior identity match",
    ]
    assert [item.delta for item in result.signals] == [
        WEIGHTS[key] for key in SIGNAL_ORDER
    ]
    assert all(item.present is True for item in result.signals)


def test_absent_signals_have_zero_delta() -> None:
    result = score_win_probability(
        SignalSet(ip_match=True), "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    )
    deltas = {item.key: item.delta for item in result.signals}
    present = {item.key: item.present for item in result.signals}
    assert deltas["ip_match"] == 0.12
    assert deltas["tos_accepted"] == 0.0
    assert present == {
        "tos_accepted": False,
        "ip_match": True,
        "asset_delivered": False,
        "usage_metered": False,
        "chain_verified": False,
        "ce3_historical_match": False,
    }


def test_unknown_reason_uses_other_multiplier() -> None:
    result = score_win_probability(SignalSet(), "SOMETHING_NEW")
    assert result.reason_multiplier == 0.95
    assert result.score == 0.095


def test_missing_telemetry_lowers_score() -> None:
    strong = score_win_probability(ALL_SIGNALS, "MERCHANDISE_OR_SERVICE_NOT_RECEIVED")
    weak = score_win_probability(
        SignalSet(tos_accepted=True), "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"
    )
    assert weak.score == 0.25
    assert weak.score < strong.score


@pytest.mark.parametrize(
    "signals,expected",
    [
        (SignalSet(), 0.0),
        (SignalSet(tos_accepted=True), 0.1667),
        (SignalSet(tos_accepted=True, ip_match=True, asset_delivered=True), 0.5),
        (ALL_SIGNALS, 1.0),
    ],
)
def test_completeness_exact(signals: SignalSet, expected: float) -> None:
    assert completeness(signals) == expected


def test_scoring_is_deterministic() -> None:
    first = score_win_probability(ALL_SIGNALS, "UNAUTHORIZED")
    second = score_win_probability(ALL_SIGNALS, "UNAUTHORIZED")
    assert first.model_dump() == second.model_dump()


def test_invalid_reason_code_rejected() -> None:
    with pytest.raises(ValueError, match="reason_code"):
        score_win_probability(SignalSet(), "")
