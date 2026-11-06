"""AI layer: Gemini classification and evidence drafting, deterministically gated.

Design principle (ADR): "AI explains and drafts; rules decide."

The Gemini model may only (1) classify the buyer's free-text claim and (2) draft
the grounded evidence narrative.  Every money decision — win probability,
expected value and the recommended action — is computed by the deterministic
engine in app.domain.disputes and is never model-emitted.  When Gemini is
disabled, unconfigured or fails, the layer degrades to the deterministic keyword
classifier and template narrative (degraded=True) without losing correctness.
"""
