"""Two-axis cliff engine: PayPal HVD (dollar-weighted) vs Visa VAMP (count-weighted).

Axis 1 — PayPal High-Volume Dispute tier, ``PAYPAL_WALLET`` rail only:
    active when settled wallet transactions over 3 full calendar months
    ``> 100`` AND ``disputed_amount_minor / net_sales_minor >= 15000 ppm``.
    The numerator counts wallet INR/SNAD *claims* (and wallet chargebacks);
    unescalated ``INQUIRY`` cases ($0 fee) and ``UNBRANDED_CARD`` disputes are
    excluded. In the tier the fee is $30 (replacing $15), non-reimbursable on a
    win, and the seller response SLA compresses from 10 to 3 days.

Axis 2 — Visa VAMP (April 2026), ``UNBRANDED_CARD`` rail:
    ``(TC40 + TC15) / TC05 >= 15000 ppm`` AND ``TC40 + TC15 >= 1500`` monthly
    events, then $8 (800 minor units) per counted event. An order with both a
    TC40 fraud advice and a TC15 chargeback counts twice. A CE 3.0 remedy
    removes the TC15 chargeback, never the prior TC40.

Mastercard ECP: ``chargebacks / prior-month settled >= 15000 ppm`` AND
``>= 100`` chargebacks; ``>= 10000 ppm`` is the warning band.

Every number is ``int`` (minor units, counts, ppm). Stdlib only.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Any

from app.oracle.manifest import RulesManifest, get_manifest
from app.oracle.money import PPM, minor_str, ppm_str, ratio_ppm

SIMULATED_SOURCE_PLANE = "SIMULATED_CARD_NETWORK_FEED"
LIVE_SOURCE_PLANE = "LIVE_PAYPAL_SANDBOX"


def full_calendar_months_window(now: datetime, months: int) -> tuple[datetime, datetime]:
    """``[start, end)`` covering the ``months`` full calendar months before ``now``'s month."""
    if months < 1:
        raise ValueError("months must be >= 1")
    moment = now.replace(tzinfo=UTC) if now.tzinfo is None else now.astimezone(UTC)
    end = moment.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    index = end.year * 12 + (end.month - 1) - months
    start = end.replace(year=index // 12, month=index % 12 + 1)
    return start, end


@dataclass(frozen=True, slots=True)
class HvdInputs:
    """Raw HVD aggregates read from the ledger (integers only)."""

    settled_txns: int
    net_sales_minor: int
    disputed_minor: int
    disputed_claims: int
    window_start: datetime
    window_end: datetime


def _ceil_div(numerator: int, denominator: int) -> int:
    return -(-numerator // denominator)


def _require_count(name: str, value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValueError(f"{name} must be a non-negative int")
    return value


@dataclass(frozen=True, slots=True)
class HvdState:
    settled_txns_3m: int
    net_sales_amount_minor_3m: int
    net_sales_amount_str_3m: str
    disputed_amount_minor_3m: int
    disputed_amount_str_3m: str
    ratio_ppm: int
    ratio_str: str
    threshold_ppm: int
    in_tier: bool
    active_fee_tier_usd_cents: int
    fee_reimbursable_on_win: bool
    sla_response_days: int
    amount_until_cliff_minor: int

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def hvd_state(
    *,
    settled_txns_3m: int,
    net_sales_minor_3m: int,
    disputed_amount_minor_3m: int,
    manifest: RulesManifest | None = None,
) -> HvdState:
    rules = (manifest or get_manifest()).section("hvd")
    txns = _require_count("settled_txns_3m", settled_txns_3m)
    sales = _require_count("net_sales_minor_3m", net_sales_minor_3m)
    disputed = _require_count("disputed_amount_minor_3m", disputed_amount_minor_3m)
    threshold = int(rules["threshold_ppm"])
    ratio = ratio_ppm(disputed, sales)
    in_tier = txns > int(rules["min_settled_txns_exclusive"]) and ratio >= threshold
    needed = _ceil_div(threshold * sales, PPM) if sales else 0
    return HvdState(
        settled_txns_3m=txns,
        net_sales_amount_minor_3m=sales,
        net_sales_amount_str_3m=minor_str(sales),
        disputed_amount_minor_3m=disputed,
        disputed_amount_str_3m=minor_str(disputed),
        ratio_ppm=ratio,
        ratio_str=ppm_str(ratio),
        threshold_ppm=threshold,
        in_tier=in_tier,
        active_fee_tier_usd_cents=int(
            rules["hvd_fee_minor"] if in_tier else rules["standard_fee_minor"]
        ),
        fee_reimbursable_on_win=bool(
            rules["hvd_fee_reimbursable_on_win"]
            if in_tier
            else rules["standard_fee_reimbursable_on_win"]
        ),
        sla_response_days=int(rules["hvd_sla_days"] if in_tier else rules["standard_sla_days"]),
        amount_until_cliff_minor=max(0, needed - disputed),
    )


def hvd_after_escalation(
    before: HvdState, *, added_disputed_minor: int, manifest: RulesManifest | None = None
) -> HvdState:
    """The HVD state if one more countable claim of this amount were filed."""
    return hvd_state(
        settled_txns_3m=before.settled_txns_3m,
        net_sales_minor_3m=before.net_sales_amount_minor_3m,
        disputed_amount_minor_3m=before.disputed_amount_minor_3m
        + _require_count("added_disputed_minor", added_disputed_minor),
        manifest=manifest,
    )


@dataclass(frozen=True, slots=True)
class VampState:
    tc05_settled_cnp: int
    tc40_fraud_count: int
    tc15_dispute_count: int
    ce3_remedied_tc15: int
    dual_counted_events: int
    combined_events: int
    monthly_floor_events: int
    ratio_ppm: int
    ratio_str: str
    threshold_ppm: int
    excessive_enforcement_active: bool
    projected_vamp_fines_usd_cents: int
    projected_vamp_fines_str: str
    events_until_cliff: int
    source_plane: str = SIMULATED_SOURCE_PLANE

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def vamp_state(
    *,
    tc05_settled_cnp: int,
    tc40_fraud_count: int,
    tc15_dispute_count: int,
    dual_counted_events: int = 0,
    ce3_remedied_tc15: int = 0,
    manifest: RulesManifest | None = None,
) -> VampState:
    rules = (manifest or get_manifest()).section("vamp")
    tc05 = _require_count("tc05_settled_cnp", tc05_settled_cnp)
    tc40 = _require_count("tc40_fraud_count", tc40_fraud_count)
    tc15 = _require_count("tc15_dispute_count", tc15_dispute_count)
    remedied = min(_require_count("ce3_remedied_tc15", ce3_remedied_tc15), tc15)
    dual = _require_count("dual_counted_events", dual_counted_events)
    # CE 3.0 removes the chargeback (TC15) only; the TC40 fraud advice stays.
    combined = tc40 + (tc15 - remedied)
    threshold = int(rules["threshold_ppm"])
    floor = int(rules["min_monthly_events_inclusive"])
    ratio = ratio_ppm(combined, tc05)
    active = combined >= floor and ratio >= threshold
    fines = combined * int(rules["fee_per_event_minor"]) if active else 0
    events_for_ratio = _ceil_div(threshold * tc05, PPM) if tc05 else 0
    return VampState(
        tc05_settled_cnp=tc05,
        tc40_fraud_count=tc40,
        tc15_dispute_count=tc15,
        ce3_remedied_tc15=remedied,
        dual_counted_events=dual,
        combined_events=combined,
        monthly_floor_events=floor,
        ratio_ppm=ratio,
        ratio_str=ppm_str(ratio),
        threshold_ppm=threshold,
        excessive_enforcement_active=active,
        projected_vamp_fines_usd_cents=fines,
        projected_vamp_fines_str=minor_str(fines),
        events_until_cliff=max(0, max(floor, events_for_ratio) - combined),
    )


@dataclass(frozen=True, slots=True)
class EcpState:
    prior_month_settled_mc: int
    current_month_chargebacks_mc: int
    ratio_ppm: int
    ratio_str: str
    threshold_ppm: int
    warning_ppm: int
    warning: bool
    breached: bool
    source_plane: str = SIMULATED_SOURCE_PLANE

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def ecp_state(
    *,
    prior_month_settled_mc: int,
    current_month_chargebacks_mc: int,
    manifest: RulesManifest | None = None,
) -> EcpState:
    rules = (manifest or get_manifest()).section("ecp")
    settled = _require_count("prior_month_settled_mc", prior_month_settled_mc)
    chargebacks = _require_count("current_month_chargebacks_mc", current_month_chargebacks_mc)
    threshold = int(rules["threshold_ppm"])
    warning_ppm = int(rules["warning_ppm"])
    ratio = ratio_ppm(chargebacks, settled)
    return EcpState(
        prior_month_settled_mc=settled,
        current_month_chargebacks_mc=chargebacks,
        ratio_ppm=ratio,
        ratio_str=ppm_str(ratio),
        threshold_ppm=threshold,
        warning_ppm=warning_ppm,
        warning=ratio >= warning_ppm,
        breached=ratio >= threshold
        and chargebacks >= int(rules["min_monthly_chargebacks_inclusive"]),
    )
