"""Declarative base plus shared column helpers."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy.orm import DeclarativeBase


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str = "") -> str:
    value = uuid.uuid4().hex
    return f"{prefix}{value}" if prefix else value


class Base(DeclarativeBase):
    """Shared declarative base for all VerdictPay tables."""
