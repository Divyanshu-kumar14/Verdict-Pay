"""Search adapter selection: no-op unless ELASTIC_URL is configured."""

from __future__ import annotations

from app.config import Settings
from app.domain.protocols import SearchIndex


def build_search_index(settings: Settings) -> SearchIndex:
    if settings.elastic_url:
        from app.integrations.search.elastic import ElasticSearchIndex

        return ElasticSearchIndex(settings)
    from app.integrations.search.null import NullSearchIndex

    return NullSearchIndex()
