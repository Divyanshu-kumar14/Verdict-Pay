"""Property-based checks (hypothesis, 1,000+ examples each) on the oracle math."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from decimal import Decimal

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from app.domain.disputes.ev import EvInputs, compute_ev
from app.domain.enums import DisputeStage
from app.oracle import ce3_matcher
from app.oracle.cliff_engine import hvd_state, vamp_state
from app.oracle.money import PPM, ratio_ppm, to_minor

MANY = settings(max_examples=1000, deadline=None, suppress_health_check=[HealthCheck.too_slow])
amounts = st.integers(min_value=1, max_value=1_000_000).map(lambda c: Decimal(c) / 100)
probabilities = st.integers(min_value=0, max_value=10_000).map(lambda n: Decimal(n) / 10_000)


@MANY
@given(numerator=st.integers(0, 10**12), denominator=st.integers(1, 10**12))
def test_ratio_ppm_never_rounds_up(numerator: int, denominator: int) -> None:
    ppm = ratio_ppm(numerator, denominator)
    assert ppm * denominator <= numerator * PPM < (ppm + 1) * denominator


@MANY
@given(sales=st.integers(1, 10**10), disputed=st.integers(0, 10**10), txns=st.integers(0, 10_000))
def test_hvd_tier_is_exact_integer_comparison(sales: int, disputed: int, txns: int) -> None:
    state = hvd_state(
        settled_txns_3m=txns, net_sales_minor_3m=sales, disputed_amount_minor_3m=disputed
    )
    exact = disputed * PPM >= 15_000 * sales  # no division, no float
    assert state.in_tier is (txns > 100 and exact)
    assert state.active_fee_tier_usd_cents == (3000 if state.in_tier else 1500)
    if not state.in_tier and txns > 100:
        # Adding the reported headroom crosses the line; one cent less does not.
        crossed = hvd_state(
            settled_txns_3m=txns,
            net_sales_minor_3m=sales,
            disputed_amount_minor_3m=disputed + state.amount_until_cliff_minor,
        )
        assert crossed.in_tier
        if state.amount_until_cliff_minor > 0:
            short = hvd_state(
                settled_txns_3m=txns,
                net_sales_minor_3m=sales,
                disputed_amount_minor_3m=disputed + state.amount_until_cliff_minor - 1,
            )
            assert not short.in_tier


@MANY
@given(amount=amounts, p=probabilities, in_tier=st.booleans())
def test_fee_replaces_never_stacks(amount: Decimal, p: Decimal, in_tier: bool) -> None:
    outcome = compute_ev(
        EvInputs(
            amount_usd=amount,
            p_win=p,
            stage=DisputeStage.CHARGEBACK,
            settled_txns_3m=500,
            net_sales_minor_3m=1_000_000,
            disputed_amount_minor_3m=20_000 if in_tier else 0,
        )
    )
    fee = Decimal("30.00") if outcome.high_volume else Decimal("15.00")
    # At p = 0 the fight loss is exactly amount + one fee: -$130 on $100 in the tier, never -$145.
    lost = compute_ev(
        EvInputs(
            amount_usd=amount,
            p_win=Decimal(0),
            stage=DisputeStage.CHARGEBACK,
            settled_txns_3m=500,
            net_sales_minor_3m=1_000_000,
            disputed_amount_minor_3m=20_000 if in_tier else 0,
        )
    )
    assert lost.ev_fight == -(amount + fee)
    assert outcome.ev_settle == -(amount + fee)
    assert outcome.ev_fight >= outcome.ev_settle  # fighting never costs more than conceding
    assert outcome.ev_fight <= 0


@MANY
@given(amount=amounts, p=probabilities)
def test_inquiry_accept_is_fee_free(amount: Decimal, p: Decimal) -> None:
    outcome = compute_ev(EvInputs(amount_usd=amount, p_win=p, stage=DisputeStage.INQUIRY))
    assert outcome.ev_settle == -amount
    expected_offer = (Decimal("0.30") * amount).quantize(Decimal("0.01"), rounding="ROUND_DOWN")
    assert outcome.ev_offer == (-expected_offer if expected_offer else Decimal("0.00"))


@MANY
@given(
    tc05=st.integers(0, 10**7),
    tc40=st.integers(0, 10**5),
    tc15=st.integers(0, 10**5),
    remedied=st.integers(0, 10**5),
)
def test_vamp_dual_condition_and_ce3_offsets_tc15_only(
    tc05: int, tc40: int, tc15: int, remedied: int
) -> None:
    state = vamp_state(
        tc05_settled_cnp=tc05,
        tc40_fraud_count=tc40,
        tc15_dispute_count=tc15,
        ce3_remedied_tc15=remedied,
    )
    combined = tc40 + tc15 - min(remedied, tc15)
    assert state.combined_events == combined
    assert state.combined_events >= tc40  # the TC40 fraud count is never offset
    active = combined >= 1500 and tc05 > 0 and combined * PPM >= 15_000 * tc05
    assert state.excessive_enforcement_active is active
    assert state.projected_vamp_fines_usd_cents == (combined * 800 if active else 0)


@MANY
@given(dollars=st.integers(0, 10**9), cents=st.integers(0, 99), noise=st.integers(0, 999))
def test_to_minor_truncates_sub_cent_noise(dollars: int, cents: int, noise: int) -> None:
    value = Decimal(f"{dollars}.{cents:02d}{noise:03d}")
    assert to_minor(value) == dollars * 100 + cents


D = datetime(2026, 11, 10, tzinfo=UTC)
ANCHORS = {
    "ip_hash": "i",
    "device_id_hash": "d",
    "account_login_id_hash": "a",
    "shipping_address_hash": "s",
}


def _order(order_id: str, seconds: int, **extra: object) -> ce3_matcher.Ce3Order:
    fields = {**ANCHORS, **extra}
    return ce3_matcher.Ce3Order(
        order_id=order_id,
        payment_credential_hash=str(fields.pop("credential", "card")),
        settled_at=D - timedelta(seconds=seconds),
        **fields,  # type: ignore[arg-type]
    )


DISPUTED = _order("OD", 0)


@MANY
@given(s1=st.integers(0, 400 * 86400), s2=st.integers(0, 400 * 86400))
def test_ce3_window_is_second_exact(s1: int, s2: int) -> None:
    result = ce3_matcher.match(
        DISPUTED, [_order("O1", s1), _order("O2", s2)], external_reason_code="10.4"
    )
    inside = all(120 * 86400 <= s <= 365 * 86400 for s in (s1, s2))
    assert result.verified is inside


@MANY
@given(
    o1=st.sets(st.sampled_from(sorted(ANCHORS)), max_size=4),
    o2=st.sets(st.sampled_from(sorted(ANCHORS)), max_size=4),
)
def test_ce3_three_way_intersection(o1: set[str], o2: set[str]) -> None:
    def build(order_id: str, shared: set[str]) -> ce3_matcher.Ce3Order:
        values = {key: (ANCHORS[key] if key in shared else f"{order_id}-{key}") for key in ANCHORS}
        return _order(order_id, 200 * 86400, **values)

    result = ce3_matcher.match(
        DISPUTED, [build("O1", o1), build("O2", o2)], external_reason_code="10.4"
    )
    both = o1 & o2
    expected = len(both) >= 2 and bool(both & {"ip_hash", "device_id_hash"})
    assert result.verified is expected
    if not expected:
        assert result.veto_code == "VETO_CE3_MISSING_PRIMARY_ANCHOR"


@MANY
@given(
    rail=st.sampled_from(["PAYPAL_WALLET", "UNBRANDED_CARD"]),
    code=st.sampled_from(["10.4", "10.3", "13.1", "4853", None]),
    reason=st.sampled_from(["UNAUTHORISED", "MERCHANDISE_OR_SERVICE_NOT_RECEIVED"]),
)
def test_ce3_eligibility_is_card_10_4_fraud_only(rail: str, code: str | None, reason: str) -> None:
    disputed = _order("OD", 0, payment_rail=rail)
    result = ce3_matcher.match(
        disputed,
        [_order("O1", 200 * 86400), _order("O2", 300 * 86400)],
        external_reason_code=code,
        reason_code=reason,
    )
    eligible = rail == "UNBRANDED_CARD" and code == "10.4" and reason == "UNAUTHORISED"
    assert result.eligible is eligible
    assert result.verified is eligible
