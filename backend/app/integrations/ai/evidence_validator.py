"""Grounding validator: the air gap between the model and the dossier.

Reuses the existing deterministic narrative validator (number/date containment,
banned phrases, ASCII) and adds title checks.  Every AI-generated draft must
pass here before it can enter an evidence dossier or the append-only ledger.
"""

from __future__ import annotations

from app.api.schemas import CaseFacts
from app.domain.evidence.narrative import validate_narrative


def validate_draft(*, title: str, narrative: str, facts: CaseFacts) -> tuple[bool, str]:
    """Return (ok, reason).  Grounds the narrative; the title must not fabricate."""
    ok, reason = validate_narrative(narrative, facts)
    if not ok:
        return False, reason
    title = (title or "").strip()
    if not title:
        return False, "empty_title"
    if not title.isascii():
        return False, "non_ascii_title"
    return True, "ok"
