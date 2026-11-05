# ADR-002: SQLite by default, Postgres optional

**Status:** Accepted

## Context

Judge friction is the number-one demo killer. Requiring Docker, Postgres, Supabase or an
Elastic cluster for a first run loses judges before the first click.

## Decision

`DATABASE_URL` defaults to `sqlite+aiosqlite:///./verdictpay.db`. The schema
([backend/app/db/models.py](../../backend/app/db/models.py)) uses portable SQL types only —
no SQLite-only constructs, no vendor-specific columns — so any async SQLAlchemy URL
(including `postgresql+asyncpg://`) is a configuration swap.

## Consequences

* One process, one file, zero external services for the demo.
* Concurrency limits are acceptable for a single-instance demo; production deployments are
  expected to point `DATABASE_URL` at Postgres.
* WAL mode and a per-stream lock keep the append-only ledger safe under the demo's load.
