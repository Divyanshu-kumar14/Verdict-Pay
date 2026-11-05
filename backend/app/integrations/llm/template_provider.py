"""Deterministic, offline narrative provider.

Used by default (LLM_MODE=template) and as the fallback for every other
provider: it can never fail because of a missing key or a network outage. The
prose is reconstructed from the serialized fact pack only, so it cannot invent
a number, date or claim.
"""

from __future__ import annotations

import unicodedata

from pydantic import ValidationError

from app.api import schemas
from app.domain.evidence.narrative import build_template_narrative
from app.domain.protocols import NarrativeRequest


class TemplateNarrativeProvider:
    """Writes the locked-facts template narrative; safe with no API key."""

    mode = "template"

    async def compose(self, request: NarrativeRequest) -> str:
        """Render the deterministic seller rebuttal for this request."""
        facts = self._facts_from(request)
        if facts is not None:
            try:
                text = build_template_narrative(
                    facts=facts,
                    reason_code=request.reason_code,
                    stage=request.stage,
                    amount_usd=request.amount_usd,
                    merchant_name=request.merchant_name,
                )
            except (TypeError, ValueError):
                text = ""
            if text:
                return truncate_narrative(_ascii(text), request.max_chars)
        return truncate_narrative(_ascii(self._minimal(request)), request.max_chars)

    @staticmethod
    def _facts_from(request: NarrativeRequest) -> schemas.CaseFacts | None:
        """Rebuild the locked fact view from the serialized facts mapping."""
        try:
            return schemas.CaseFacts.model_validate(dict(request.facts))
        except (ValidationError, TypeError, ValueError):
            return None

    @staticmethod
    def _minimal(request: NarrativeRequest) -> str:
        """Deterministic degraded narrative when the fact pack is unavailable."""
        return (
            f"{request.merchant_name} responds to the PayPal dispute for payer "
            f"{request.payer_id} under reason code {request.reason_code} at stage "
            f"{request.stage}. The locked fact pack is unavailable, so no evidentiary "
            "figures are asserted in this response."
        )


def _ascii(text: str) -> str:
    """Fold text to ASCII so the dossier and PayPal upload stay ASCII-only."""
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def truncate_narrative(text: str, max_chars: int) -> str:
    """Clamp narrative text to the caller's character budget, without a trailing space."""
    if max_chars <= 0:
        return ""
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rstrip()
