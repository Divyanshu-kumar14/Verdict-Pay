"""Gemini client for the VerdictPay AI layer.

Thin async wrapper around the synchronous ``google-genai`` SDK. The model is
only ever asked to classify free-text claims and to draft evidence prose;
every money/verdict decision stays in the deterministic engine.

The client never logs the API key, and every SDK failure surfaces as
AiUnavailableError so callers can degrade to the deterministic fallback.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.config import Settings

logger = logging.getLogger(__name__)


class AiUnavailableError(RuntimeError):
    """Raised when the Gemini model cannot produce a usable response."""


class GeminiClient:
    """Async JSON wrapper around a ``google.genai`` synchronous client."""

    def __init__(self, settings: Settings) -> None:
        self._model = settings.gemini_model
        self._timeout_s = max(1.0, settings.ai_timeout_ms / 1000.0)
        self._max_retries = max(0, settings.ai_max_retries)
        self._enabled = bool(settings.ai_enabled and settings.gemini_api_key)
        self._client: Any | None = None
        if self._enabled:
            try:
                from google import genai  # lazy: SDK optional until used
                from google.genai import types

                # JSON mode lives in the v1beta API surface; the default v1
                # rejects response_mime_type="application/json" with a 400.
                self._client = genai.Client(
                    api_key=settings.gemini_api_key,
                    http_options=types.HttpOptions(api_version="v1beta"),
                )
            except Exception as exc:  # pragma: no cover - SDK import failure
                logger.warning("gemini client unavailable: %s", type(exc).__name__)
                self._client = None

    @property
    def available(self) -> bool:
        """Whether a live model call can be attempted."""
        return self._client is not None

    @property
    def model(self) -> str:
        return self._model

    async def generate_json(self, *, system: str, user: str, schema: Any) -> dict | None:
        """Return the model JSON response as a dict, or None when disabled."""
        if not self.available:
            return None
        attempts = self._max_retries + 1
        last_error: Exception | None = None
        for attempt in range(1, attempts + 1):
            try:
                raw = await asyncio.wait_for(
                    asyncio.to_thread(self._generate, system, user, schema),
                    timeout=self._timeout_s,
                )
                parsed = json.loads(raw)
                if not isinstance(parsed, dict):
                    raise AiUnavailableError("gemini returned a non-object payload")
                return parsed
            except AiUnavailableError:
                raise
            except Exception as exc:
                last_error = exc
                logger.warning(
                    "gemini generate_json attempt %d/%d failed: %s",
                    attempt,
                    attempts,
                    type(exc).__name__,
                )
        raise AiUnavailableError(
            f"gemini unavailable after {attempts} attempt(s): "
            f"{type(last_error).__name__ if last_error else 'unknown'}"
        )

    def _generate(self, system: str, user: str, schema: Any) -> str:
        """Synchronous SDK call, executed in a worker thread."""
        from google.genai import types

        config_kwargs: dict[str, Any] = {
            "temperature": 0.0,
            "response_mime_type": "application/json",
        }
        if schema is not None:
            config_kwargs["response_schema"] = schema
        if "flash" in self._model.lower():
            # Classification and grounded drafting need no reasoning pass. With
            # thinking on, a long fact pack ran past the 12s timeout twice and
            # every dossier fell back to the template after ~24s. Flash models
            # accept a zero budget; Pro models do not, so they keep the default.
            config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_budget=0)
        response = self._client.models.generate_content(
            model=self._model,
            contents=[
                types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=f"{system}\n\n{user}")],
                )
            ],
            config=types.GenerateContentConfig(**config_kwargs),
        )
        text = (response.text or "").strip()
        if not text:
            raise AiUnavailableError("gemini returned an empty response")
        return text
