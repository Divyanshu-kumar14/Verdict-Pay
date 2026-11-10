"""Shared domain constants that more than one layer must agree on."""

from __future__ import annotations

from typing import Final

# PayPal reports a captured Orders v2 sale as COMPLETED; the sandbox router
# stores its own ledger row as CAPTURED. Both mean the money moved, so every
# volume, ratio and CE 3.0 query must accept both.
SETTLED_STATUSES: Final[tuple[str, ...]] = ("COMPLETED", "CAPTURED")
