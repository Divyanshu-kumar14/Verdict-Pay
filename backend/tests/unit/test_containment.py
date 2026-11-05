"""Containment breaker: bounded, isolated and never fatal to triage.

The success and failure paths use the real SimulatorGateway. Only the timeout
path uses a latency double, because there is no honest way to make the
in-memory simulator hang.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable

import pytest

from app.config import Settings
from app.domain.protocols import GatewayResponse
from app.domain.subscriptions.containment import (
    ContainmentResult,
    contain_subscription,
)
from app.integrations.paypal.simulator import SimulatorGateway

TIMEOUT_SUBSCRIPTION = "I-BWTESTSUBSCRIPTION"


class SlowGateway:
    """Minimal gateway double whose suspend call outlives any test budget."""

    mode = "simulator"

    def __init__(self, delay_seconds: float) -> None:
        self.delay_seconds = delay_seconds
        self.calls: list[tuple[str, str]] = []

    async def suspend_subscription(
        self, subscription_id: str, reason: str
    ) -> GatewayResponse:
        self.calls.append((subscription_id, reason))
        await asyncio.sleep(self.delay_seconds)
        return GatewayResponse(status_code=200, body={}, latency_ms=0)


def _hook_recorder() -> tuple[list[str], Callable[[str], Awaitable[None]]]:
    calls: list[str] = []

    async def hook(subscription_id: str) -> None:
        calls.append(subscription_id)

    return calls, hook


async def test_containment_suspends_and_runs_hook(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    gateway = SimulatorGateway(settings)
    hook_calls, hook = _hook_recorder()
    caplog.set_level(logging.INFO, logger="verdictpay.containment")

    result = await contain_subscription(
        gateway,
        subscription_id=settings.demo_subscription_id,
        reason="friendly fraud claim",
        merchant_hook=hook,
    )

    assert result.attempted is True
    assert result.suspended is True
    assert result.error is None
    assert result.subscription_id == settings.demo_subscription_id
    assert 0 <= result.latency_ms < 500
    assert gateway.suspended_subscriptions == {
        settings.demo_subscription_id: "friendly fraud claim"
    }
    assert hook_calls == [settings.demo_subscription_id]

    records = [r for r in caplog.records if r.name == "verdictpay.containment"]
    assert len(records) == 1
    assert records[0].extra_fields["attempted"] is True
    assert records[0].extra_fields["suspended"] is True
    assert records[0].extra_fields["subscription_id"] == settings.demo_subscription_id


async def test_containment_without_hook_is_successful(settings: Settings) -> None:
    gateway = SimulatorGateway(settings)

    result = await contain_subscription(
        gateway,
        subscription_id=settings.demo_subscription_id,
        reason="claim opened",
    )

    assert result.suspended is True
    assert result.error is None
    assert result.attempted is True


async def test_containment_unknown_subscription_isolates_failure(
    settings: Settings,
) -> None:
    gateway = SimulatorGateway(settings)
    hook_calls, hook = _hook_recorder()

    result = await contain_subscription(
        gateway,
        subscription_id="I-UNKNOWN",
        reason="claim opened",
        merchant_hook=hook,
    )

    assert result.attempted is True
    assert result.suspended is False
    assert result.error == "subscription_not_found"
    assert result.subscription_id == "I-UNKNOWN"
    assert hook_calls == []
    assert gateway.suspended_subscriptions == {}


async def test_containment_timeout_returns_fast() -> None:
    gateway = SlowGateway(delay_seconds=5.0)
    started = time.perf_counter()

    result = await contain_subscription(
        gateway,
        subscription_id=TIMEOUT_SUBSCRIPTION,
        reason="claim opened",
        timeout_seconds=0.05,
    )

    elapsed_ms = (time.perf_counter() - started) * 1000
    assert result.attempted is True
    assert result.suspended is False
    assert result.error == "timeout"
    assert result.subscription_id == TIMEOUT_SUBSCRIPTION
    assert elapsed_ms < 500
    assert result.latency_ms < 500
    assert gateway.calls == [(TIMEOUT_SUBSCRIPTION, "claim opened")]


async def test_containment_hook_failure_does_not_raise(settings: Settings) -> None:
    gateway = SimulatorGateway(settings)

    async def failing_hook(subscription_id: str) -> None:
        raise RuntimeError("api key revocation failed")

    result = await contain_subscription(
        gateway,
        subscription_id=settings.demo_subscription_id,
        reason="claim opened",
        merchant_hook=failing_hook,
    )

    assert result.attempted is True
    assert result.suspended is True
    assert result.error == "merchant_hook_failed: api key revocation failed"
    assert gateway.suspended_subscriptions == {
        settings.demo_subscription_id: "claim opened"
    }


async def test_containment_without_subscription_is_skipped(settings: Settings) -> None:
    gateway = SimulatorGateway(settings)
    hook_calls, hook = _hook_recorder()

    result = await contain_subscription(
        gateway,
        subscription_id=None,
        reason="claim opened",
        merchant_hook=hook,
    )

    assert result == ContainmentResult(
        attempted=False,
        suspended=False,
        latency_ms=0,
        error=None,
        subscription_id=None,
    )
    assert hook_calls == []
    assert gateway.calls == []
    assert gateway.suspended_subscriptions == {}