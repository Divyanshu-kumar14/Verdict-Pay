# ADR-004: One hash chain per payer stream

**Status:** Accepted

## Context

A single global ledger chain would serialize ingestion across all customers and make
per-customer verification require the whole database. Merchants need to prove one customer's
history to PayPal without exporting anyone else's data.

## Decision

Each `(merchant_id, payer_id)` stream is an independent SHA-256 chain:

```
payload_hash = sha256(canonical_json(payload))
chain_hash   = sha256("<prev_hash>:<event_type>:<payer_id>:<created_at_utc_iso>:<payload_hash>")
```

The stream starts at sequence 0 from a 64-zero genesis hash. Unique constraints on
`(merchant_id, payer_id, sequence)` and `(merchant_id, event_id)` make a fork or a silent
replay impossible, and `verify_chain` reports the exact broken sequence. The contract lives in
[backend/app/domain/telemetry/hashing.py](../../backend/app/domain/telemetry/hashing.py).

## Consequences

* Verification is O(stream length) and merchant-scoped.
* Ingestion writes can proceed per payer without a global lock.
* Chain heads are only comparable within one payer stream; cross-customer claims rely on the
  CE 3.0 transaction cache, not on a global chain.
