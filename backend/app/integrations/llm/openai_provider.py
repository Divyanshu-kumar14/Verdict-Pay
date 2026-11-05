"""Optional LLM narrative provider, strictly constrained to locked facts.

The model only rewrites supplied facts. Every response is re-validated against
the locked fact pack; on any transport failure, timeout, non-2xx answer or
unverifiable content the provider falls back to the deterministic template.
The API key is never logged and never placed in a prompt.
"""

from __future__ import annotations

import asyncio
from typing import Any, Final

import httpx
from pydantic import ValidationError

from app.api import schemas
from app.config import Settings
from app.domain.evidence.narrative import facts_as_prompt, validate_narrative
from app.domain.protocols import NarrativeRequest
from app.integrations.llm.template_provider import (
    TemplateNarrativeProvider,
    truncate_narrative,
)
from app.logging_setup import get_logger, log_context

logger = get_logger("verdictpay.llm.openai")

_DEFAULT_BASE_URL: Final[str] = "https://api.openai.com/v1"
_TIMEOUT_SECONDS: Final[float] = 20.0
_MAX_ATTEMPTS: Final[int] = 2
_RETRY_DELAY_SECONDS: Final[float] = 0.2
_SYSTEM_PROMPT: Final[str] = (
    "You rewrite only the supplied facts. Never add numbers, names, dates or claims "
    "not present. Output ASCII only. Max 1800 characters."
)


class OpenAINarrativeProvider:
    """Chat-completions narrative writer with a deterministic template fallback."""

    mode = "openai"

    def __init__(self, settings: Settings) -> None:
        self._api_key = settings.openai_api_key
        self._model = settings.llm_model or settings.openai_model
        base_url = settings.llm_base_url or _DEFAULT_BASE_URL
        self._endpoint = f"{base_url.rstrip('/')}/chat/completions"
        self._local_endpoint = bool(settings.llm_base_url)
        self.model_name = self._model

    async def compose(self, request: NarrativeRequest) -> str:
        """Write the rebuttal, falling back to the template on any failure."""
        fallback = await TemplateNarrativeProvider().compose(request)
        if not self._api_key and not self._local_endpoint:
            logger.info("openai_unconfigured", extra=log_context(fallback="template"))
            return fallback

        facts = self._facts_from(request)
        if facts is None:
            logger.warning(
                "openai_facts_unavailable", extra=log_context(payer_id=request.payer_id)
            )
            return fallback

        candidate = await self._chat(self._request_body(facts, request))
        if candidate is None:
            return fallback
        ok, reason = validate_narrative(candidate, facts)
        if not ok:
            logger.warning("openai_narrative_rejected", extra=log_context(reason=reason))
            return fallback
        return truncate_narrative(candidate, request.max_chars)

    async def _chat(self, body: dict[str, Any]) -> str | None:
        """POST once, retry once on 429/5xx, return None on any failure."""
        async with httpx.AsyncClient(timeout=httpx.Timeout(_TIMEOUT_SECONDS)) as client:
            for attempt in range(1, _MAX_ATTEMPTS + 1):
                try:
                    headers = {"Content-Type": "application/json"}
                    if self._api_key:
                        headers["Authorization"] = f"Bearer {self._api_key}"
                    response = await client.post(self._endpoint, headers=headers, json=body)
                except httpx.HTTPError as exc:
                    logger.warning(
                        "openai_transport_failed",
                        extra=log_context(attempt=attempt, error=type(exc).__name__),
                    )
                    return None

                retryable = response.status_code == 429 or response.status_code >= 500
                if retryable and attempt < _MAX_ATTEMPTS:
                    logger.warning(
                        "openai_retrying",
                        extra=log_context(attempt=attempt, status=response.status_code),
                    )
                    await asyncio.sleep(_RETRY_DELAY_SECONDS)
                    continue
                if retryable or response.status_code >= 400:
                    logger.warning(
                        "openai_http_error",
                        extra=log_context(attempt=attempt, status=response.status_code),
                    )
                    return None
                try:
                    return _extract_content(response.json()).strip()
                except (ValueError, KeyError, TypeError) as exc:
                    logger.warning(
                        "openai_malformed_response",
                        extra=log_context(attempt=attempt, error=type(exc).__name__),
                    )
                    return None
        return None

    @staticmethod
    def _facts_from(request: NarrativeRequest) -> schemas.CaseFacts | None:
        """Rebuild and validate the locked fact view."""
        try:
            return schemas.CaseFacts.model_validate(dict(request.facts))
        except (ValidationError, TypeError, ValueError):
            return None

    def _request_body(
        self, facts: schemas.CaseFacts, request: NarrativeRequest
    ) -> dict[str, Any]:
        """Build the deterministic chat-completions request body."""
        user_prompt = (
            f"{facts_as_prompt(facts)}\n\n"
            f"Case context: reason_code={request.reason_code}; stage={request.stage}; "
            f"merchant={request.merchant_name}; payer_id={request.payer_id}. "
            f"Write at most {request.max_chars} characters. Do not restate the disputed amount."
        )
        return {
            "model": self._model,
            "temperature": 0,
            "max_tokens": 700,
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        }


def _extract_content(payload: Any) -> str:
    """Pull the assistant text out of a chat-completions response body."""
    if not isinstance(payload, dict):
        raise ValueError("response is not a JSON object")
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("response has no choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("response choice has no message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise ValueError("response content is empty")
    return content
