"""Deterministic claim-category -> PayPal reason-code mapping.

The Gemini model picks a category and a confidence; THIS module is the rules
layer that converts the category to a PayPal reason code and multiplier.  The
mapping is frozen and mirrors win_probability.REASON_MULTIPLIERS exactly — the
model is deliberately not trusted to emit a reason code directly.
"""

from __future__ import annotations

from typing import Final

from app.domain.disputes.win_probability import REASON_MULTIPLIERS
from app.domain.enums import DisputeReason
from app.integrations.ai.schemas import ClaimCategory

# Confidence below this keeps the case in the conservative OTHER bucket.
MIN_CONFIDENCE: Final[float] = 0.5

# Frozen category -> PayPal reason code mapping (never model-emitted).
_CATEGORY_TO_REASON: Final[dict[ClaimCategory, DisputeReason]] = {
    ClaimCategory.NOT_AS_DESCRIBED: DisputeReason.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED,
    ClaimCategory.UNAUTHORIZED: DisputeReason.UNAUTHORIZED,
    ClaimCategory.NOT_RECEIVED: DisputeReason.MERCHANDISE_OR_SERVICE_NOT_RECEIVED,
    ClaimCategory.DUPLICATE: DisputeReason.OTHER,
    ClaimCategory.OTHER: DisputeReason.OTHER,
}

REASON_LABELS: Final[dict[str, str]] = {
    "MERCHANDISE_OR_SERVICE_NOT_RECEIVED": "Item not received",
    "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED": "Item not as described",
    "UNAUTHORIZED": "Unauthorized transaction",
    "OTHER": "Other / not classified",
}


def reason_for_category(category: ClaimCategory) -> DisputeReason:
    """Map a validated category to its PayPal reason code."""
    return _CATEGORY_TO_REASON[category]


def multiplier_for_reason(reason_code: str) -> float:
    """Return the frozen win-probability multiplier for a reason code."""
    return REASON_MULTIPLIERS.get(reason_code, REASON_MULTIPLIERS["OTHER"])


def guarded_category(category: ClaimCategory, confidence: float) -> ClaimCategory:
    """Demote a low-confidence classification to the conservative OTHER bucket."""
    if confidence < MIN_CONFIDENCE:
        return ClaimCategory.OTHER
    return category
