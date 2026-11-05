"""Structured, redacting logger setup.

Never logs settings objects wholesale; secrets are scrubbed by pattern as a
belt-and-braces measure for upstream payloads.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from collections.abc import Mapping, MutableMapping
from typing import Any

_REDACT_KEYS = re.compile(
    r"(secret|token|password|api[_-]?key|authorization|client[_-]?secret)", re.IGNORECASE
)
_REDACTED = "[REDACTED]"


def redact(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {
            key: (_REDACTED if _REDACT_KEYS.search(str(key)) else redact(item))
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item) for item in value]
    return value


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, datefmt="%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in getattr(record, "extra_fields", {}).items():
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(redact(payload), default=str)


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())
    for noisy in ("httpx", "httpcore", "uvicorn.access"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    return logger


def log_context(**fields: Any) -> MutableMapping[str, Any]:
    """Convenience wrapper so callers do logger.info(msg, extra={'extra_fields': ...})."""
    return {"extra_fields": redact(fields)}
