#!/usr/bin/env python
"""Create all tables for the configured database (idempotent)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.db.session import Database
from app.services.bootstrap import ensure_demo_merchant


async def main() -> None:
    settings = get_settings()
    database = Database(settings.database_url)
    await database.create_all()
    async with database.session() as session:
        merchant = await ensure_demo_merchant(session, settings)
    print(f"database ready: {settings.database_url}")
    print(f"demo merchant:  {merchant.id} ({merchant.name})")
    await database.dispose()


if __name__ == "__main__":
    asyncio.run(main())
