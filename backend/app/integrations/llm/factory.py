"""Narrative provider selection: deterministic template by default."""

from __future__ import annotations

from app.config import Settings
from app.domain.protocols import NarrativeProvider


def build_narrative_provider(settings: Settings) -> NarrativeProvider:
    if settings.llm_mode == "openai" and settings.openai_api_key:
        from app.integrations.llm.openai_provider import OpenAINarrativeProvider

        return OpenAINarrativeProvider(settings)
    from app.integrations.llm.template_provider import TemplateNarrativeProvider

    return TemplateNarrativeProvider()
