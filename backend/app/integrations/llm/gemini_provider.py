"""Gemini-backed narrative provider with a deterministic template fallback.

Mirrors OpenAINarrativeProvider: the model drafts prose from the fact pack,
the frozen narrative validator gates every answer, and ANY failure degrades
to the locked template so the dossier footer stays honest.
"""

from __future__ import annotations

import logging

from pydantic import ValidationError

from app.api import schemas
from app.config import Settings
from app.domain.evidence.narrative import (
    build_template_narrative,
    facts_as_prompt,
    validate_narrative,
)
from app.domain.protocols import NarrativeRequest
from app.integrations.ai.client import GeminiClient
from app.integrations.ai.prompts.v1 import DRAFT_SYSTEM, DRAFT_USER_TEMPLATE
from app.integrations.llm.template_provider import _ascii, truncate_narrative

logger = logging.getLogger(__name__)

DRAFT_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "narrative": {"type": "string"},
    },
    "required": ["title", "narrative"],
}


class GeminiNarrativeProvider:
    """NarrativeProvider that drafts with Gemini, else the template."""

    mode = "gemini"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.model_name = settings.gemini_model
        try:
            client: GeminiClient | None = GeminiClient(settings)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("gemini provider disabled: %s", type(exc).__name__)
            client = None
        self._client = client

    async def compose(self, request: NarrativeRequest) -> str:
        """Draft narrative prose, falling back to the template on ANY failure."""
        try:
            if self._client is None or not self._client.available:
                raise RuntimeError("gemini unavailable")
            user = DRAFT_USER_TEMPLATE.format(
                fact_pack=facts_as_prompt(request.facts),
                reason_code=request.reason_code,
                stage=request.stage,
                merchant=request.merchant_name,
                max_chars=request.max_chars,
            )
            payload = await self._client.generate_json(
                system=DRAFT_SYSTEM, user=user, schema=DRAFT_SCHEMA
            )
            if not payload:
                raise RuntimeError("gemini returned no payload")
            narrative = str(payload.get("narrative", "") or "")
            ok, _ = validate_narrative(narrative, request.facts)
            if not ok:
                raise RuntimeError("model narrative failed validation")
            return truncate_narrative(narrative, request.max_chars)
        except Exception as exc:
            logger.warning("gemini compose falling back to template: %s", exc)
            return self._template(request)

    @staticmethod
    def _hydrate_facts(request: NarrativeRequest) -> schemas.CaseFacts | None:
        """Rebuild the locked fact view from the serialized mapping.

        ``NarrativeRequest.facts`` is a plain Mapping on purpose — the provider
        contract is JSON-shaped. ``build_template_narrative`` needs the typed
        model, so hydrate here; returning None means the degraded path must not
        assert any evidentiary figure.
        """
        if isinstance(request.facts, schemas.CaseFacts):
            return request.facts
        try:
            return schemas.CaseFacts.model_validate(dict(request.facts))
        except (ValidationError, TypeError, ValueError):
            return None

    def _template(self, request: NarrativeRequest) -> str:
        """Deterministic fallback: the same prose path the offline mode uses."""
        facts = self._hydrate_facts(request)
        if facts is None:
            return truncate_narrative(
                _ascii(
                    f"{request.merchant_name} responds to the PayPal dispute for payer "
                    f"{request.payer_id} under reason code {request.reason_code} at stage "
                    f"{request.stage}. The locked fact pack could not be rehydrated, so no "
                    "evidentiary figures are asserted in this response."
                ),
                request.max_chars,
            )
        return build_template_narrative(
            facts=facts,
            reason_code=request.reason_code,
            stage=request.stage,
            amount_usd=request.amount_usd,
            merchant_name=request.merchant_name,
        )
