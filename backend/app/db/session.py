"""Async engine/session lifecycle.

The app owns a single Database instance (created in the lifespan) so tests can
spin up an isolated SQLite file without touching global state.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base


class Database:
    def __init__(self, url: str, *, echo: bool = False) -> None:
        self.url = url
        self._engine: AsyncEngine = create_async_engine(
            url,
            echo=echo,
            pool_pre_ping=True,
            connect_args={"check_same_thread": False} if url.startswith("sqlite") else {},
        )
        self.session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
            self._engine, expire_on_commit=False, autoflush=False
        )

    @property
    def engine(self) -> AsyncEngine:
        return self._engine

    async def create_all(self) -> None:
        async with self._engine.begin() as connection:
            if self.url.startswith("sqlite"):
                from sqlalchemy import text

                await connection.execute(text("PRAGMA journal_mode=WAL"))
                await connection.execute(text("PRAGMA foreign_keys=ON"))
            await connection.run_sync(Base.metadata.create_all)

    async def dispose(self) -> None:
        await self._engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.session_factory() as session:
            yield session
