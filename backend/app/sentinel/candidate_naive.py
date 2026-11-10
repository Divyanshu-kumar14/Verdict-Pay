"""Negative control 1: a naive, float, count-only triage candidate.

This is the "crime": the kind of triage a generic bot or spreadsheet writes.
It measures the dispute rate as a binary float of *counts* and checks it
*before* adding the case it is about to escalate, so it calls an escalation
"safe" that actually tips the merchant over a cliff:

* PayPal HVD is dollar-weighted: one $2,500 SNAD claim moves the ratio far
  more than a $12 one, which a count ratio cannot see.
* Visa VAMP counts TC40 + TC15 together (an order with both counts twice) and
  only bites at >= 1,500 monthly events; a TC15-only float ratio misses both.

The Sentinel recomputes both with integer ppm and vetoes with exit code 2.
Floats are used here on purpose; this module is excluded from the oracle's
float ban because it exists to demonstrate the failure.
"""

from __future__ import annotations

import uuid
from typing import Any

NAIVE_THRESHOLD = 0.015  # the float a naive bot hard-codes

# Demo portfolio (integers, as the Sentinel receives them).
HVD_PORTFOLIO = {
    "settled_txns_3m": 500,
    "net_sales_minor_3m": 5_000_000,  # $50,000.00
    "disputed_amount_minor_3m": 72_000,  # $720.00 across 7 claims (1.44%)
    "disputed_claims_3m": 7,
}
VAMP_PORTFOLIO = {
    "tc05_settled_cnp": 100_000,
    "tc40_fraud_count": 900,
    "tc15_dispute_count": 599,  # 1,499 combined events: one below the floor
}


def naive_hvd_proposal(*, dispute_id: str = "PP-D-NAIVE-HVD") -> dict[str, Any]:
    """Escalate a $2,500 SNAD inquiry because 7/500 = 1.4% "looks safe"."""
    count_ratio = HVD_PORTFOLIO["disputed_claims_3m"] / HVD_PORTFOLIO["settled_txns_3m"]
    looks_safe = count_ratio < NAIVE_THRESHOLD
    return {
        "proposal_id": str(uuid.uuid4()),
        "dispute_id": dispute_id,
        "payment_rail": "PAYPAL_WALLET",
        "dispute_channel": "INTERNAL",
        "dispute_life_cycle_stage": "INQUIRY",
        "reason": "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        "external_reason_code": None,
        "proposed_action": "ESCALATE" if looks_safe else "MAKE_OFFER",
        "dispute_amount_minor": 250_000,
        "currency": "USD",
        "hateoas_rels": ["escalate", "make-offer", "send-message", "accept-claim"],
        "portfolio": {"hvd": {k: v for k, v in HVD_PORTFOLIO.items() if k != "disputed_claims_3m"}},
        "candidate_mode": "NAIVE",
        "naive_reasoning": (
            f"count ratio {count_ratio!r} < {NAIVE_THRESHOLD!r} -> safe to escalate"
        ),
    }


def naive_vamp_proposal(*, dispute_id: str = "PP-D-NAIVE-VAMP") -> dict[str, Any]:
    """Fight a $12 card chargeback because TC15/TC05 = 0.599% "looks safe"."""
    tc15_only = VAMP_PORTFOLIO["tc15_dispute_count"] / VAMP_PORTFOLIO["tc05_settled_cnp"]
    looks_safe = tc15_only < NAIVE_THRESHOLD
    return {
        "proposal_id": str(uuid.uuid4()),
        "dispute_id": dispute_id,
        "payment_rail": "UNBRANDED_CARD",
        "dispute_channel": "EXTERNAL",
        "dispute_life_cycle_stage": "INQUIRY",
        "reason": "UNAUTHORISED",
        "external_reason_code": "10.4",
        "proposed_action": "ESCALATE" if looks_safe else "MAKE_OFFER",
        "dispute_amount_minor": 1_200,
        "currency": "USD",
        "hateoas_rels": ["escalate", "make-offer", "send-message", "accept-claim"],
        "portfolio": {"vamp": dict(VAMP_PORTFOLIO)},
        "candidate_mode": "NAIVE",
        "naive_reasoning": f"TC15/TC05 {tc15_only!r} < {NAIVE_THRESHOLD!r} -> safe to fight",
    }
