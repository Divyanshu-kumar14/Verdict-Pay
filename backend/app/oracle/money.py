"""Fixed-point money and ratio helpers for the oracle and the Sentinel.

Stdlib only: the Sentinel subprocess imports this module under ``python -I -B``
with an empty environment, so nothing here may depend on app settings or
third-party packages.

Rules (PRD 5.1): money is ``int`` minor units (cents for USD) plus an exact
decimal string; ratios are ``int`` parts-per-million; every division rounds
toward zero (``ROUND_DOWN``) so a ratio is never rounded *up* across a cliff;
JSON floats are rejected at every trust boundary.
"""

from __future__ import annotations

import json
from decimal import ROUND_DOWN, Decimal, InvalidOperation, localcontext
from typing import Any

PPM = 1_000_000
CENT = Decimal("0.01")
EXIT_VETO = 2


class FloatRejectedError(ValueError):
    """A JSON payload carried an IEEE-754 float literal (exit code 2)."""

    veto_code = "VETO_FLOAT_PRECISION_REJECTED"


def _reject_float(literal: str) -> Any:
    raise FloatRejectedError(f"float literal {literal!r} rejected; send minor units or strings")


def strict_loads(raw: str | bytes) -> Any:
    """``json.loads`` that refuses every float literal (``19.99``, ``1e3``)."""
    return json.loads(raw, parse_float=_reject_float, parse_constant=_reject_float)


def to_minor(value: Decimal | int | str) -> int:
    """Convert a USD amount to integer cents, truncating sub-cent noise."""
    if isinstance(value, (bool, float)):
        raise TypeError("money must be Decimal, int or str, never float")
    try:
        amount = value if isinstance(value, Decimal) else Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(f"invalid money value {value!r}") from exc
    return int((amount * 100).to_integral_value(rounding=ROUND_DOWN))


def from_minor(minor: int) -> Decimal:
    """Integer cents back to an exact two-place Decimal."""
    if not isinstance(minor, int) or isinstance(minor, bool):
        raise TypeError("minor units must be int")
    return (Decimal(minor) / 100).quantize(CENT)


def minor_str(minor: int) -> str:
    """Canonical USD string for integer cents: ``1999 -> "19.99"``."""
    return str(from_minor(minor))


def ratio_ppm(numerator: int, denominator: int) -> int:
    """``numerator/denominator`` in parts-per-million, rounded toward zero.

    A zero denominator yields 0: no volume means no measurable ratio.
    """
    if numerator < 0 or denominator < 0:
        raise ValueError("ratio inputs must be non-negative")
    if denominator == 0:
        return 0
    return (numerator * PPM) // denominator


def ppm_str(ppm: int) -> str:
    """Exact six-place decimal string for a ppm ratio: ``15000 -> "0.015000"``."""
    with localcontext() as ctx:
        ctx.prec = 28
        return str((Decimal(ppm) / PPM).quantize(Decimal("0.000001"), rounding=ROUND_DOWN))


def ppm_percent(ppm: int) -> str:
    """Human percent string with two places, truncated: ``14999 -> "1.49%"``."""
    value = (Decimal(ppm) / 10_000).quantize(CENT, rounding=ROUND_DOWN)
    return f"{value}%"


def money_round_down(value: Decimal) -> Decimal:
    """Quantize to cents toward zero (no negative zero)."""
    quantized = value.quantize(CENT, rounding=ROUND_DOWN)
    return Decimal("0.00") if quantized.is_zero() else quantized
