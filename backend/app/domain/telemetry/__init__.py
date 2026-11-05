"""Telemetry system of record: canonical JSON, SHA-256 chain, append and verify."""

from __future__ import annotations

from app.domain.telemetry.hashing import (
    GENESIS_HASH,
    canonical_payload,
    compute_chain_hash,
    payload_hash,
    utc_timestamp,
    verify_rows,
)
from app.domain.telemetry.service import (
    RecordResult,
    TelemetryService,
    build_payload,
    summarize_rows,
    to_event_out,
)

__all__ = [
    "GENESIS_HASH",
    "RecordResult",
    "TelemetryService",
    "build_payload",
    "canonical_payload",
    "compute_chain_hash",
    "payload_hash",
    "summarize_rows",
    "to_event_out",
    "utc_timestamp",
    "verify_rows",
]
