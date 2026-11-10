"""AI-layer data contracts (frozen for the frontend).

"AI explains and drafts; rules decide."  Money decisions — win probability,
expected value, recommended action — are always computed by the deterministic
engine (app.domain.disputes).  The model only classifies the buyer's claim text
and drafts the grounded evidence narrative, both re-validated before use.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import Field

from app.api.schemas import ApiModel, EvBreakdown, WinProbability


class ClaimCategory(StrEnum):
    """The five claim categories Gemini selects; mapped deterministically below."""

    NOT_AS_DESCRIBED = "not_as_described"
    UNAUTHORIZED = "unauthorized"
    NOT_RECEIVED = "not_received"
    DUPLICATE = "duplicate"
    OTHER = "other"


class ClaimClassification(ApiModel):
    """Model output plus the deterministic reason-code mapping that follows it."""

    category: ClaimCategory
    confidence: float
    rationale: str
    # Deterministic mapping, NOT model output:
    reason_code: str
    reason_multiplier: float


class EvidenceDraft(ApiModel):
    """A grounded evidence narrative, or the deterministic template fallback."""

    title: str
    narrative: str
    grounded: bool
    model: str  # "gemini:<model>" or "template"
    warnings: list[str] = Field(default_factory=list)


class PlainExplanation(ApiModel):
    """Plain-language explanation of the deterministic EV decision (never fabricated)."""

    summary: str
    bullets: list[str] = Field(default_factory=list)


class ProvenanceRecord(ApiModel):
    """Provenance of the AI generation, recorded as an append-only chain event."""

    recorded: bool
    event_id: str | None = None
    chain_head: str | None = None
    sequence: int | None = None
    note: str = ""


class AnalyzeRequest(ApiModel):
    """Optional override claim text; otherwise read from the case snapshot."""

    claim_text: str | None = Field(default=None, max_length=4000)


class AnalyzeResponse(ApiModel):
    """One-stop analysis: classification -> deterministic EV -> draft -> explanation."""

    dispute_id: str
    prompt_version: str
    generated_at: datetime
    classification: ClaimClassification
    win_probability: WinProbability
    expected_value: EvBreakdown
    narrative: EvidenceDraft
    explanation: PlainExplanation
    provenance: ProvenanceRecord
    degraded: bool
    degraded_reason: str | None = None
    # Deterministic guard verdicts on the untrusted claim text.
    veto_codes: list[str] = Field(default_factory=list)
