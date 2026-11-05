"""Deterministic win-probability scoring from telemetry signals.

Implements the frozen win-probability weights and reason multipliers: they are
constants below, and identical signals always score identically.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Final

from app.api import schemas

# Frozen weights, in display order (section 6).
WEIGHTS: Final[dict[str, float]] = {
    "tos_accepted": 0.15,
    "ip_match": 0.12,
    "asset_delivered": 0.18,
    "usage_metered": 0.15,
    "chain_verified": 0.10,
    "ce3_historical_match": 0.20,
}

# Frozen reason-code multipliers applied after the signal sum, before the clamp.
REASON_MULTIPLIERS: Final[dict[str, float]] = {
    "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": 1.00,
    "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": 0.90,
    "UNAUTHORIZED": 0.75,
    "OTHER": 0.95,
}

SIGNAL_ORDER: Final[tuple[str, ...]] = tuple(WEIGHTS)

SIGNAL_LABELS: Final[dict[str, str]] = {
    "tos_accepted": "Terms of Service accepted",
    "ip_match": "Session IP matches checkout IP",
    "asset_delivered": "Asset delivered with SHA-256",
    "usage_metered": "Metered usage above zero",
    "chain_verified": "Telemetry chain verified",
    "ce3_historical_match": "Visa CE 3.0 prior identity match",
}

BASE: Final[float] = 0.10
MIN_SCORE: Final[float] = 0.02
MAX_SCORE: Final[float] = 0.95
_UNKNOWN_REASON_MULTIPLIER: Final[str] = "OTHER"


@dataclass(frozen=True, slots=True)
class SignalSet:
    """The six telemetry facts that drive the win-probability score."""

    tos_accepted: bool = False
    ip_match: bool = False
    asset_delivered: bool = False
    usage_metered: bool = False
    chain_verified: bool = False
    ce3_historical_match: bool = False


def _clamp(value: float, minimum: float, maximum: float) -> float:
    """Clamp a value into the inclusive minimum..maximum range."""
    return min(max(value, minimum), maximum)


def score_win_probability(signals: SignalSet, reason_code: str) -> schemas.WinProbability:
    """Score the win probability for the signals and a PayPal reason code.

    Unknown reason codes fall back to the conservative OTHER multiplier rather
    than raising: live PayPal payloads may introduce codes we do not model yet.
    """
    if not isinstance(signals, SignalSet):
        raise TypeError("signals must be a SignalSet instance")
    if not isinstance(reason_code, str) or not reason_code:
        raise ValueError("reason_code must be a non-empty string")

    multiplier = REASON_MULTIPLIERS.get(
        reason_code, REASON_MULTIPLIERS[_UNKNOWN_REASON_MULTIPLIER]
    )
    signal_sum = 0.0
    contributions: list[schemas.SignalContribution] = []
    for key in SIGNAL_ORDER:
        present = bool(getattr(signals, key))
        weight = WEIGHTS[key]
        if present:
            signal_sum += weight
        contributions.append(
            schemas.SignalContribution(
                key=key,
                label=SIGNAL_LABELS[key],
                delta=weight if present else 0.0,
                present=present,
            )
        )

    raw = (BASE + signal_sum) * multiplier
    score = round(_clamp(raw, MIN_SCORE, MAX_SCORE), 4)
    return schemas.WinProbability(
        score=score,
        base=BASE,
        signal_sum=round(signal_sum, 4),
        reason_multiplier=multiplier,
        signals=contributions,
    )


def completeness(signals: SignalSet) -> float:
    """Return the equal-weight fraction of the six signals that are present."""
    if not isinstance(signals, SignalSet):
        raise TypeError("signals must be a SignalSet instance")
    present = sum(1 for key in SIGNAL_ORDER if getattr(signals, key))
    return round(present / len(SIGNAL_ORDER), 4)
