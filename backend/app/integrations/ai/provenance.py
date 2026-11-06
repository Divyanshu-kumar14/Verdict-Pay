"""Provenance for AI generations on the hash-chained telemetry ledger.

Every successful model generation appends an AI_GENERATION event so the
chain stays verifiable end to end. Conventions mirror the sandbox usage
writers: occurred_at is left unset (server-assigned), client_ip and device
fingerprints are synthetic service markers.
"""

from __future__ import annotations

import uuid

from app.api import schemas
from app.domain.enums import TelemetryEventType
from app.domain.telemetry.service import TelemetryService
from app.integrations.ai.schemas import ProvenanceRecord


async def record_provenance(
    *,
    telemetry: TelemetryService,
    payer_id: str,
    dispute_id: str,
    model: str,
    prompt_version: str,
    category: str,
) -> ProvenanceRecord:
    """Append an AI_GENERATION event and return its chain position."""
    event = schemas.TelemetryEventIn(
        event_type=TelemetryEventType.AI_GENERATION,
        paypal_payer_id=payer_id,
        client_ip="ai",
        device_fingerprint="ai",
        metadata={
            "dispute_id": dispute_id,
            "model": model,
            "prompt_version": prompt_version,
            "category": category,
        },
        event_id=uuid.uuid4().hex,
    )
    result = await telemetry.record(event)
    return ProvenanceRecord(
        recorded=result.created,
        event_id=event.event_id or "",
        chain_head=result.row.chain_hash,
        sequence=result.row.sequence,
        note="",
    )
