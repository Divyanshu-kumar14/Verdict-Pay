# ADR-005: Gemini AI layer classifies and drafts, never decides

**Status:** Accepted

## Context

The dossier narrative provider (ADR-003) already draws the hard line: deterministic code
owns every number, the model only restates locked facts. The dispute workflow needs the
same line in one more place: somebody must read the buyer's free-text claim, put it into a
PayPal reason code, and draft the evidence narrative a human reviews — without ever letting
that reading move win probability, expected value, the recommendation or the verdict.

A raw model call cannot be trusted with that mapping. A model that emits a reason code
directly could invent a multiplier; a model that drafts from memory could invent an amount,
a date or a name. And the endpoint must stay useful when the key is absent or the model
fails, because the demo runs with zero credentials.

## Decision

* The model scope is classification + drafting only. Gemini (`GEMINI_MODEL`, default
  `gemini-2.5-flash`, via `GEMINI_API_KEY`) returns a claim category (one of five),
  a confidence and a draft narrative — nothing else is accepted from it
  ([backend/app/integrations/ai/schemas.py](../../backend/app/integrations/ai/schemas.py)).
* A frozen rules layer converts the category to a PayPal reason code and multiplier and
  mirrors `win_probability.REASON_MULTIPLIERS` exactly; below `MIN_CONFIDENCE` (0.5)
  the classification is demoted to the conservative `other` bucket
  ([backend/app/integrations/ai/claim_classifier.py](../../backend/app/integrations/ai/claim_classifier.py)).
  EV, p(win) and triage then run unchanged on that reason code.
* Every draft is grounding-validated against the locked fact pack before use: the existing
  token-level narrative validator (no invented numbers/dates, no banned phrases, ASCII
  only) plus title checks
  ([backend/app/integrations/ai/evidence_validator.py](../../backend/app/integrations/ai/evidence_validator.py),
  [backend/app/domain/evidence/narrative.py](../../backend/app/domain/evidence/narrative.py)).
  A failed draft falls back to the deterministic template narrative.
* The endpoints degrade deterministically. `POST /api/v1/disputes/{id}/ai/analyze` and
  `GET /api/v1/disputes/{id}/ai` return a full analysis even with `AI_ENABLED=false`,
  no key, a timeout (`AI_TIMEOUT_MS`, default 12000 ms, `AI_MAX_RETRIES`, default 1)
  or a model failure — built from the keyword classifier and the template narrative
  ([backend/app/integrations/ai/fallback.py](../../backend/app/integrations/ai/fallback.py)),
  marked `degraded=true` with a reason.
* Every generation is recorded as an append-only `AI_GENERATION` telemetry event in the
  per-payer SHA-256 chain as provenance, so the dossier can show what the model saw and
  what the rules decided.

## Consequences

* Same facts produce the same EV, recommendation and dossier bytes whether Gemini answers
  or not; the model can only change the classification bucket (inside the frozen map) and
  the draft prose (inside the validator).
* Disabling the AI layer (`AI_ENABLED=false` or no key) is a supported configuration,
  not an error path — the demo stays keyless.
* The category-to-reason map and the validator are the load-bearing code; prompt changes
  in [backend/app/integrations/ai/prompts/v1.py](../../backend/app/integrations/ai/prompts/v1.py)
  cannot move money by construction.
