"""FastAPI dependencies.

Auth supports both X-API-Key and Authorization: Bearer <key>; the demo key is
documented in .env.example, and the response never reveals whether a key exists.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import Merchant
from app.db.session import Database
from app.domain.protocols import NarrativeProvider, PayPalGateway, SearchIndex
from app.errors import UnauthorizedError
from app.security import hash_api_key


def get_app_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_database(request: Request) -> Database:
    return request.app.state.db


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    database: Database = request.app.state.db
    async with database.session() as session:
        yield session


def get_gateway(request: Request) -> PayPalGateway:
    return request.app.state.gateway


def get_narrative_provider(request: Request) -> NarrativeProvider:
    return request.app.state.narrative


def get_search_index(request: Request) -> SearchIndex:
    return request.app.state.search


SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Settings, Depends(get_app_settings)]
GatewayDep = Annotated[PayPalGateway, Depends(get_gateway)]
NarrativeDep = Annotated[NarrativeProvider, Depends(get_narrative_provider)]
SearchDep = Annotated[SearchIndex, Depends(get_search_index)]


async def get_merchant(
    session: SessionDep,
    x_api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> Merchant:
    token = x_api_key
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise UnauthorizedError("Provide X-API-Key or a Bearer token.")

    merchant = await session.scalar(
        select(Merchant).where(Merchant.api_key_hash == hash_api_key(token))
    )
    if merchant is None:
        raise UnauthorizedError("Invalid API key.")
    return merchant


MerchantDep = Annotated[Merchant, Depends(get_merchant)]
