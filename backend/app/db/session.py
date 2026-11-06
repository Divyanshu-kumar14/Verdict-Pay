"""Async engine/session lifecycle.

The app owns a single Database instance (created in the lifespan) so tests can
spin up an isolated SQLite file without touching global state.

Schema drift is handled additively. ``create_all`` only creates *missing tables*:
a real database from an earlier build keeps its old columns, and the first SELECT
then dies with ``no such column``. For a demo product that must boot on a judge's
machine, that failure mode is worse than a narrow automatic migration, so
``create_all`` also adds columns the models declare but the table lacks. Only
nullable additions are ever attempted — a required column cannot be added to a
populated table without inventing data — and anything else is reported loudly
instead of being silently ignored.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.db.base import Base

logger = logging.getLogger(__name__)


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

    @property
    def is_sqlite(self) -> bool:
        return self.url.startswith("sqlite")

    async def create_all(self) -> None:
        async with self._engine.begin() as connection:
            if self.is_sqlite:
                await connection.execute(text("PRAGMA journal_mode=WAL"))
                await connection.execute(text("PRAGMA foreign_keys=ON"))
            await connection.run_sync(Base.metadata.create_all)
            if self.is_sqlite:
                await self._add_missing_columns(connection)

    async def _add_missing_columns(self, connection) -> None:
        """Add nullable columns the models declare but an existing table lacks.

        Repeatable: it reads the live schema each boot and only acts on a
        difference, so a fresh database performs no ALTER at all.
        """
        for table in Base.metadata.sorted_tables:
            existing = {
                row[1]
                for row in (
                    await connection.execute(text(f'PRAGMA table_info("{table.name}")'))
                ).all()
            }
            if not existing:  # table did not pre-exist; create_all just made it
                continue
            for column in table.columns:
                if column.name in existing:
                    continue
                if not column.nullable:
                    logger.error(
                        "schema_column_missing_required",
                        extra={"table": table.name, "column": column.name},
                    )
                    continue
                ddl = (
                    f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" '
                    f"{column.type.compile(dialect=connection.dialect)}"
                )
                await connection.execute(text(ddl))
                logger.warning(
                    "schema_column_added",
                    extra={"table": table.name, "column": column.name},
                )

    async def dispose(self) -> None:
        await self._engine.dispose()

    @asynccontextmanager
    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.session_factory() as session:
            yield session
