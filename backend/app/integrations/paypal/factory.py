"""Gateway selection: simulator (default, keyless) or live (real PayPal APIs)."""

from __future__ import annotations

from app.config import Settings
from app.domain.protocols import PayPalGateway


def build_gateway(settings: Settings) -> PayPalGateway:
    if settings.paypal_mode == "live":
        from app.integrations.paypal.live import LivePayPalGateway

        return LivePayPalGateway(settings)
    from app.integrations.paypal.simulator import SimulatorGateway

    return SimulatorGateway(settings)
