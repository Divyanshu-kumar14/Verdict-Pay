# ADR-003: Determinism owns the money, the LLM owns the prose

**Status:** Accepted

## Context

An expected-value number that appears in a dispute decision — and potentially in a legal
filing — must be reproducible bit-for-bit. An LLM must never invent an amount, a timestamp,
an IP address or a probability.

## Decision

* `ev.py`, `win_probability.py`, `triage.py` and the fact pack are pure, I/O-free functions
  with frozen constants.
* Money is `Decimal`, quantized to cents with `ROUND_HALF_UP` at the boundary.
* The evidence pipeline locks a `CaseFacts` snapshot first
  ([backend/app/domain/evidence/facts.py](../../backend/app/domain/evidence/facts.py)).
* A narrative provider may only restate those facts; the default is a deterministic template
  ([backend/app/domain/evidence/narrative.py](../../backend/app/domain/evidence/narrative.py)).
* The PDF renderer is a pure function of facts + narrative
  ([backend/app/domain/evidence/pdf.py](../../backend/app/domain/evidence/pdf.py)).

## Consequences

* Same inputs produce the same EV, the same recommendation and the same dossier bytes.
* Optional LLM providers can be disabled without changing any number.
* Narrative quality is bounded by the template unless an operator opts into an LLM.
