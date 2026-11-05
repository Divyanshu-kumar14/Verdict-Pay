"""No-op search index used when Elasticsearch is not configured."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


class NullSearchIndex:
    """A SearchIndex that accepts documents and discards them."""

    enabled = False

    async def index_telemetry(self, document: Mapping[str, Any]) -> None:
        """Discard a mirrored telemetry document."""
        return None

    async def index_transaction(self, document: Mapping[str, Any]) -> None:
        """Discard a mirrored transaction document."""
        return None

    async def close(self) -> None:
        """Release nothing; present for protocol symmetry."""
        return None
