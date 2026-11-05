"""Optional Elasticsearch mirror for sub-second cross-customer correlation.

Mirroring is best-effort by design: any transport or HTTP error is logged and
swallowed, because the optional index must never break telemetry ingestion. The
factory constructs this adapter only when ELASTIC_URL is configured, so it is
enabled for its whole lifetime.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, Final

import httpx

from app.config import Settings
from app.logging_setup import get_logger, log_context

logger = get_logger("verdictpay.search.elastic")

_TIMEOUT_SECONDS: Final[float] = 10.0
_TELEMETRY_SUFFIX: Final[str] = "-telemetry"
_TRANSACTION_SUFFIX: Final[str] = "-transactions"


class ElasticSearchIndex:
    """Mirrors telemetry and transaction documents into Elasticsearch via _bulk."""

    def __init__(self, settings: Settings) -> None:
        self.enabled = True
        self._base_url = settings.elastic_url.rstrip("/")
        self._api_key = settings.elastic_api_key
        self._prefix = settings.elastic_index_prefix
        self._client: httpx.AsyncClient | None = None

    def _client_or_create(self) -> httpx.AsyncClient:
        """Lazily create the shared HTTP client with auth and NDJSON headers."""
        if self._client is None:
            headers = {"Content-Type": "application/x-ndjson"}
            if self._api_key:
                headers["Authorization"] = f"ApiKey {self._api_key}"
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers=headers,
                timeout=httpx.Timeout(_TIMEOUT_SECONDS),
            )
        return self._client

    async def index_telemetry(self, document: Mapping[str, Any]) -> None:
        """Mirror one telemetry document into the telemetry index."""
        await self._bulk(f"{self._prefix}{_TELEMETRY_SUFFIX}", document)

    async def index_transaction(self, document: Mapping[str, Any]) -> None:
        """Mirror one transaction document into the transactions index."""
        await self._bulk(f"{self._prefix}{_TRANSACTION_SUFFIX}", document)

    async def _bulk(self, index: str, document: Mapping[str, Any]) -> None:
        """Send one NDJSON bulk action; log and swallow any failure."""
        action = json.dumps({"index": {"_index": index}}, separators=(",", ":"))
        source = json.dumps(dict(document), default=str, separators=(",", ":"))
        body = f"{action}\n{source}\n"
        try:
            response = await self._client_or_create().post(
                "/_bulk", content=body.encode("utf-8")
            )
            response.raise_for_status()
        except Exception as exc:  # the optional mirror must never break ingestion
            logger.warning(
                "elastic_bulk_failed",
                extra=log_context(index=index, error=type(exc).__name__),
            )

    async def close(self) -> None:
        """Close the underlying HTTP client, if it was ever created."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
