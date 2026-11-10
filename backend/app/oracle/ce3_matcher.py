"""Deterministic Visa Compelling Evidence 3.0 three-way matcher.

Eligibility: ``UNBRANDED_CARD`` rail AND Visa reason code ``10.4`` (card-absent
fraud). PayPal Wallet disputes, INR and SNAD are never CE 3.0 eligible.

For a disputed order ``O_d`` the matcher needs two distinct prior orders
``O_1, O_2`` such that:

a. both share the exact ``payment_credential_hash`` of ``O_d``;
b. each sits in the window ``120*86400 <= (t_d - t_k).total_seconds() <= 365*86400``
   (second precision: 119d23h59m59s and 365d00h00m01s both fail);
c. neither carries a prior dispute or a TC40 fraud advice;
d. at least two core elements are identical across *all three* orders, and at
   least one of them is ``ip_hash`` or ``device_id_hash``.

Stdlib only. Returns a result object, never raises on a non-match.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from itertools import combinations
from typing import Any

from app.oracle.manifest import RulesManifest, get_manifest

UNBRANDED_CARD = "UNBRANDED_CARD"
PAYPAL_WALLET = "PAYPAL_WALLET"
CORE_ELEMENTS = ("ip_hash", "device_id_hash", "account_login_id_hash", "shipping_address_hash")

VETO_NOT_ELIGIBLE = "VETO_CE3_NOT_ELIGIBLE"
VETO_INSUFFICIENT = "VETO_CE3_INSUFFICIENT_PRIOR_TXNS"
VETO_WINDOW = "VETO_CE3_WINDOW_OUT_OF_RANGE"
VETO_CONTAMINATED = "VETO_CE3_CONTAMINATED_HISTORY"
VETO_ANCHOR = "VETO_CE3_MISSING_PRIMARY_ANCHOR"


@dataclass(frozen=True, slots=True)
class Ce3Order:
    order_id: str
    payment_credential_hash: str
    settled_at: datetime
    ip_hash: str | None = None
    device_id_hash: str | None = None
    account_login_id_hash: str | None = None
    shipping_address_hash: str | None = None
    payment_rail: str = UNBRANDED_CARD
    has_prior_dispute: bool = False
    has_tc40: bool = False
    amount_minor: int = 0

    def element(self, name: str) -> str | None:
        value = getattr(self, name)
        return value if isinstance(value, str) and value else None


@dataclass(frozen=True, slots=True)
class Ce3Result:
    eligible: bool
    verified: bool
    veto_code: str | None
    matched_prior_orders: tuple[str, ...] = ()
    shared_anchors: tuple[str, ...] = ()
    window_seconds: tuple[int, ...] = ()
    manifest: dict[str, Any] = field(default_factory=dict)
    sha256_manifest: str | None = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "eligible": self.eligible,
            "verified": self.verified,
            "veto_code": self.veto_code,
            "matched_prior_orders": list(self.matched_prior_orders),
            "shared_anchors": list(self.shared_anchors),
            "window_seconds": list(self.window_seconds),
            "sha256_manifest": self.sha256_manifest,
        }


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def is_eligible(*, payment_rail: str, external_reason_code: str | None, reason_code: str) -> bool:
    """CE 3.0 applies to unbranded Visa 10.4 card-absent fraud only."""
    rules = get_manifest().section("ce3")
    return (
        payment_rail == rules["rail"]
        and (external_reason_code or "").strip() == rules["visa_reason_code"]
        and reason_code.upper() in {"UNAUTHORISED", "UNAUTHORIZED"}
    )


def shared_elements(o1: Ce3Order, o2: Ce3Order, disputed: Ce3Order) -> tuple[str, ...]:
    """Core elements whose value is identical (and present) on all three orders."""
    shared: list[str] = []
    for name in CORE_ELEMENTS:
        value = disputed.element(name)
        if value is not None and o1.element(name) == value and o2.element(name) == value:
            shared.append(name)
    return tuple(shared)


def match(
    disputed: Ce3Order,
    history: Sequence[Ce3Order],
    *,
    external_reason_code: str | None,
    reason_code: str = "UNAUTHORISED",
    manifest: RulesManifest | None = None,
) -> Ce3Result:
    rules = (manifest or get_manifest()).section("ce3")
    if not is_eligible(
        payment_rail=disputed.payment_rail,
        external_reason_code=external_reason_code,
        reason_code=reason_code,
    ):
        return Ce3Result(eligible=False, verified=False, veto_code=VETO_NOT_ELIGIBLE)

    lower = int(rules["window_min_days"]) * 86400
    upper = int(rules["window_max_days"]) * 86400
    primary = set(rules["primary_elements"])
    min_shared = int(rules["min_shared_elements"])
    t_d = _utc(disputed.settled_at)

    same_credential = [
        order
        for order in history
        if order.order_id != disputed.order_id
        and order.payment_credential_hash
        and order.payment_credential_hash == disputed.payment_credential_hash
    ]

    def seconds_before(order: Ce3Order) -> int:
        return int((t_d - _utc(order.settled_at)).total_seconds())

    in_window = [o for o in same_credential if lower <= seconds_before(o) <= upper]
    clean = [o for o in in_window if not o.has_prior_dispute and not o.has_tc40]

    if len(clean) < int(rules["min_prior_txns"]):
        if len(in_window) >= int(rules["min_prior_txns"]):
            code = VETO_CONTAMINATED
        elif len(same_credential) >= int(rules["min_prior_txns"]):
            code = VETO_WINDOW
        else:
            code = VETO_INSUFFICIENT
        return Ce3Result(eligible=True, verified=False, veto_code=code)

    ordered = sorted(clean, key=lambda o: (_utc(o.settled_at), o.order_id))
    best: tuple[Ce3Order, Ce3Order, tuple[str, ...]] | None = None
    for o1, o2 in combinations(ordered, 2):
        shared = shared_elements(o1, o2, disputed)
        if len(shared) >= min_shared and primary.intersection(shared):
            best = (o1, o2, shared)
            break
    if best is None:
        return Ce3Result(eligible=True, verified=False, veto_code=VETO_ANCHOR)

    o1, o2, shared = best
    manifest_body = {
        "rule": "VISA_CE3_10.4",
        "disputed_order_id": disputed.order_id,
        "payment_credential_hash": disputed.payment_credential_hash,
        "prior_orders": [
            {
                "order_id": order.order_id,
                "settled_at_utc": _utc(order.settled_at).isoformat(),
                "seconds_before_dispute": seconds_before(order),
            }
            for order in (o1, o2)
        ],
        "shared_elements": list(shared),
        "window_seconds": [lower, upper],
    }
    digest = hashlib.sha256(
        json.dumps(manifest_body, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return Ce3Result(
        eligible=True,
        verified=True,
        veto_code=None,
        matched_prior_orders=(o1.order_id, o2.order_id),
        shared_anchors=shared,
        window_seconds=(seconds_before(o1), seconds_before(o2)),
        manifest=manifest_body,
        sha256_manifest=digest,
    )
