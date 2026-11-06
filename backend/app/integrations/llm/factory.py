"""Narrative provider selection: deterministic template by default."""

from __future__ import annotations

from app.config import Settings
from app.domain.protocols import NarrativeProvider


def build_narrative_provider(settings: Settings) -> NarrativeProvider:
    # A hosted key or a local OpenAI-compatible endpoint both count as configured.
    configured = bool(settings.openai_api_key or settings.llm_base_url)
    if settings.llm_mode == "openai" and configured:
        from app.integrations.llm.openai_provider import OpenAINarrativeProvider

        return OpenAINarrativeProvider(settings)
    if settings.llm_mode == "gemini":
        from app.integrations.llm.gemini_provider import GeminiNarrativeProvider

        return GeminiNarrativeProvider(settings)
    from app.integrations.llm.template_provider import TemplateNarrativeProvider

    return TemplateNarrativeProvider()
