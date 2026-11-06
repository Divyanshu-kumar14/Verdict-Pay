"""Grounded evidence-draft generation.

The model drafts seller-protection prose from the deterministic fact pack;
every draft is gated by the frozen evidence validator and any failure
(missing client, bad JSON, ungrounded prose) degrades to the deterministic
template fallback. The model never decides money or verdicts.
"""

from __future__ import annotations

import logging
from decimal import Decimal
from typing import Any

from app.api import schemas
from app.domain.evidence.narrative import facts_as_prompt
from app.integrations.ai import evidence_validator, fallback
from app.integrations.ai.client import AiUnavailableError
from app.integrations.ai.prompts.v1 import DRAFT_SYSTEM, DRAFT_USER_TEMPLATE
from app.integrations.ai.schemas import EvidenceDraft

logger = logging.getLogger(__name__)

DRAFT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "narrative": {"type": "string"},
    },
    "required": ["title", "narrative"],
}


async def draft_evidence(
    *,
    client: Any | None,
    facts: schemas.CaseFacts,
    reason_code: str,
    stage: str,
    amount_usd: Decimal,
    merchant_name: str,
    model: str,
    max_chars: int = 1800,
    max_retries: int = 1,
) -> EvidenceDraft:
    """Draft a grounded evidence narrative, else the template fallback."""
    if client is None:
        return fallback.draft_narrative(
            facts=facts,
            reason_code=reason_code,
            stage=stage,
            amount_usd=amount_usd,
            merchant_name=merchant_name,
        )
    fact_pack = facts_as_prompt(facts)
    user = DRAFT_USER_TEMPLATE.format(
        fact_pack=fact_pack,
        reason_code=reason_code,
        stage=stage,
        merchant=merchant_name,
        max_chars=max_chars,
    )
    attempts = max(1, max_retries + 1)
    last_note = "model unavailable"
    for _ in range(attempts):
        try:
            payload = await client.generate_json(
                system=DRAFT_SYSTEM, user=user, schema=DRAFT_SCHEMA
            )
        except AiUnavailableError as exc:
            last_note = str(exc)
            continue
        except Exception as exc:  # defensive: fake/odd clients in tests
            last_note = f"{type(exc).__name__}: {exc}"
            continue
        if payload is None:
            break
        title = str(payload.get("title", "") or "")
        narrative = str(payload.get("narrative", "") or "")
        ok, note = evidence_validator.validate_draft(
            title=title, narrative=narrative, facts=facts
        )
        if ok:
            return EvidenceDraft(
                title=title.strip(),
                narrative=narrative,
                grounded=True,
                model=f"gemini:{model}",
                warnings=[],
            )
        last_note = note
        logger.warning("gemini draft failed validation: %s", note)
    logger.warning("evidence draft falling back to template: %s", last_note)
    draft = fallback.draft_narrative(
        facts=facts,
        reason_code=reason_code,
        stage=stage,
        amount_usd=amount_usd,
        merchant_name=merchant_name,
    )
    return draft.model_copy(update={"warnings": [f"model draft unused: {last_note}"]})
