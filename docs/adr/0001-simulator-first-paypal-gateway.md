# ADR-001: Simulator-first PayPal gateway, not mocks in tests

**Status:** Accepted

## Context

The demo must run with no PayPal sandbox credentials, and the judge flow must exercise the
same code path the product ships. Unit tests that monkeypatch PayPal internals would test a
different integration than the one merchants run.

## Decision

The PayPal boundary is a protocol ([backend/app/domain/protocols.py](../../backend/app/domain/protocols.py))
with two real implementations selected by `PAYPAL_MODE`:

* `SimulatorGateway` — deterministic, in-memory, records every call, powers the demo and the
  E2E script ([backend/app/integrations/paypal/simulator.py](../../backend/app/integrations/paypal/simulator.py)).
* `LiveGateway` — real PayPal REST calls with OAuth caching, idempotent retries and webhook
  verification ([backend/app/integrations/paypal/live.py](../../backend/app/integrations/paypal/live.py)).

Tests never mock PayPal internals: integration tests run the simulator through the app, and
the live client is covered with recorded HTTP fixtures.

## Consequences

* The demo path is the tested path.
* A gateway bug shows up in the demo instead of hiding behind a mock.
* The simulator must model state transitions faithfully (disputes, offers, evidence,
  suspension), which is a maintenance cost we accept.
