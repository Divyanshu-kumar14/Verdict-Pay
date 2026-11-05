"""Subscription containment circuit breaker.

Containment is the cheapest loss-prevention action in the demo: when a payer
files a friendly-fraud claim, the merchant's recurring revenue is the collateral.
We suspend the subscription and revoke the API key, but neither may ever block
triage or raise into the request path.

Budget: the whole attempt is bounded by timeout_seconds (default 1s) so a hung
PayPal call costs at most that before the dispute flow continues.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.domain.protocols import PayPalGateway
from app.logging_setup import get_logger, log_context

logger = get_logger("verdictpay.containment")

TIMEOUT_ERROR = "timeout"
HOOK_FAILED_PREFIX = "merchant_hook_failed"


@dataclass(frozen=True, slots=True)
class ContainmentResult:
    """Outcome of one containment attempt. Serialisable and exception-free."""

    attempted: bool
    suspended: bool
    latency_ms: int
    error: str | None
    subscription_id: str | None


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)


def _finish(result: ContainmentResult) -> ContainmentResult:
    logger.info(
        "containment",
        extra=log_context(
            attempted=result.attempted,
            suspended=result.suspended,
            latency_ms=result.latency_ms,
            error=result.error,
            subscription_id=result.subscription_id,
        ),
    )
    return result


async def contain_subscription(
    gateway: PayPalGateway,
    *,
    subscription_id: str | None,
    reason: str,
    merchant_hook: Callable[[str], Awaitable[None]] | None = None,
    timeout_seconds: float = 1.0,
) -> ContainmentResult:
    """Suspend a subscription and run the merchant hook; never raises.

    Rules:
    * no subscription id: attempted=False and no gateway call;
    * the suspend call is bounded by timeout_seconds;
    * the hook runs only after a successful suspend and its failure is isolated;
    * latency_ms is measured with perf_counter over the whole attempt.
    """
    started = time.perf_counter()

    if not subscription_id:
        return _finish(
            ContainmentResult(
                attempted=False,
                suspended=False,
                latency_ms=0,
                error=None,
                subscription_id=None,
            )
        )

    error: str | None = None
    try:
        await asyncio.wait_for(
            gateway.suspend_subscription(subscription_id, reason),
            timeout=timeout_seconds,
        )
    except TimeoutError:
        return _finish(
            ContainmentResult(
                attempted=True,
                suspended=False,
                latency_ms=_elapsed_ms(started),
                error=TIMEOUT_ERROR,
                subscription_id=subscription_id,
            )
        )
    except Exception as exc:  # containment must never raise into the request path
        logger.debug("containment_suspend_failed", exc_info=True)
        return _finish(
            ContainmentResult(
                attempted=True,
                suspended=False,
                latency_ms=_elapsed_ms(started),
                error=str(exc) or type(exc).__name__,
                subscription_id=subscription_id,
            )
        )

    if merchant_hook is not None:
        try:
            await merchant_hook(subscription_id)
        except Exception as exc:  # hook failure is isolated from containment
            logger.debug("containment_hook_failed", exc_info=True)
            error = f"{HOOK_FAILED_PREFIX}: {str(exc) or type(exc).__name__}"

    return _finish(
        ContainmentResult(
            attempted=True,
            suspended=True,
            latency_ms=_elapsed_ms(started),
            error=error,
            subscription_id=subscription_id,
        )
    )
