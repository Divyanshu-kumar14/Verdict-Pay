"""Deterministic fallback for the AI layer (used when Gemini is disabled or fails).

"AI explains and drafts; rules decide" — when the model is unavailable the
endpoint still returns a correct analysis: keyword classification, the
deterministic template narrative and a formula-driven explanation.  The result
carries degraded=True and remains fully grounded.
"""

from __future__ import annotations

from decimal import Decimal

from app.api.schemas import CaseFacts
from app.domain.evidence.narrative import build_template_narrative
from app.integrations.ai.claim_classifier import REASON_LABELS
from app.integrations.ai.schemas import ClaimCategory, EvidenceDraft

# Keyword rules for the offline classifier.  Order matters (first hit wins).
_KEYWORDS: tuple[tuple[ClaimCategory, tuple[str, ...]], ...] = (
    (ClaimCategory.NOT_RECEIVED, (
        "not received", "never received", "never got", "did not receive",
        "didn't receive", "didn't get", "not delivered", "never delivered",
        "haven't received", "never arrived", "did not arrive", "didn't arrive",
    )),
    (ClaimCategory.NOT_AS_DESCRIBED, (
        "not as described", "not what", "different from", "doesn't match",
        "does not match", "doesn't work", "does not work", "broken",
        "misleading", "not working", "wrong item", "defective",
    )),
    (ClaimCategory.UNAUTHORIZED, (
        "unauthorised", "unauthorized", "did not authorize", "didn't authorize",
        "did not authorise", "hacked", "stolen", "fraudulent", "not me",
        "didn't make", "did not make", "someone else", "card was",
    )),
    (ClaimCategory.DUPLICATE, (
        "duplicate", "charged twice", "double charge", "double charged",
        "charged again", "two charges", "extra charge", "charged me twice",
    )),
)


VETO_PROMPT_INJECTION_BLOCKED = "VETO_PROMPT_INJECTION_BLOCKED"

# Phrases that address the model instead of describing a purchase. Their
# presence means the text is an instruction attempt; the keyword classifier
# must not obey whatever category the text asks for.
_INJECTION_MARKERS: tuple[str, ...] = (
    "ignore previous",
    "ignore all previous",
    "ignore the previous",
    "ignore instructions",
    "ignore your instructions",
    "disregard",
    "system override",
    "system prompt",
    "you are now",
    "new instructions",
    "category=",
    "category:",
    "accept claim",
    "accept_claim",
    "accept_dispute_claim",
    "accept the claim",
    "</claim>",
    "<claim>",
    "act as",
    "developer mode",
)


def detect_injection(claim_text: str | None) -> str | None:
    """Return the first injection marker found in the text, else None."""
    text = (claim_text or "").lower()
    for marker in _INJECTION_MARKERS:
        if marker in text:
            return marker
    return None


def classify_claim(claim_text: str | None) -> tuple[ClaimCategory, float, str]:
    """Keyword classification with a conservative default to OTHER.

    Text carrying a prompt-injection marker is never classified by keyword:
    it returns OTHER with zero confidence and the veto code in the rationale.
    """
    text = (claim_text or "").lower()
    if not text.strip():
        return ClaimCategory.OTHER, 0.0, "No claim text supplied."
    marker = detect_injection(text)
    if marker is not None:
        return (
            ClaimCategory.OTHER,
            0.0,
            f"{VETO_PROMPT_INJECTION_BLOCKED}: claim text contains an instruction "
            f"marker ('{marker}'); keyword classification refused.",
        )
    for category, keywords in _KEYWORDS:
        for keyword in keywords:
            if keyword in text:
                return category, 0.8, f"Claim text matched keyword '{keyword}'."
    return ClaimCategory.OTHER, 0.3, "No keyword matched; classified as other."


def draft_narrative(
    *,
    facts: CaseFacts,
    reason_code: str,
    stage: str,
    amount_usd: Decimal,
    merchant_name: str,
) -> EvidenceDraft:
    """Render the deterministic template rebuttal (offline, always grounded)."""
    narrative = build_template_narrative(
        facts=facts,
        reason_code=reason_code,
        stage=stage,
        amount_usd=amount_usd,
        merchant_name=merchant_name,
    )
    return EvidenceDraft(
        title="Seller rebuttal (deterministic template)",
        narrative=narrative,
        grounded=True,
        model="template",
        warnings=[],
    )


def label_for_reason(reason_code: str) -> str:
    """Human label for a reason code, defaulting to the literal code."""
    return REASON_LABELS.get(reason_code, reason_code)
