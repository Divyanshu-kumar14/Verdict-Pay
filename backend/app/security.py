"""Authentication, signing and abuse-control primitives.

Kept dependency-free (stdlib only) so every layer can use it without cycles.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from collections import deque


def hash_api_key(api_key: str) -> str:
    return hashlib.sha256(api_key.encode("utf-8")).hexdigest()


def constant_time_equals(left: str, right: str) -> bool:
    return hmac.compare_digest(left.encode("utf-8"), right.encode("utf-8"))


def compute_signature(secret: str, timestamp: str, body: bytes) -> str:
    """HMAC-SHA256 over '<timestamp>.<body>' — the SDK's canonical signing rule."""
    message = timestamp.encode("utf-8") + b"." + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_signature(
    *,
    secret: str,
    timestamp: str,
    body: bytes,
    signature: str,
    tolerance_seconds: int = 300,
    now: float | None = None,
) -> tuple[bool, str | None]:
    try:
        issued_at = int(timestamp)
    except (TypeError, ValueError):
        return False, "malformed_timestamp"
    current = time.time() if now is None else now
    if abs(current - issued_at) > tolerance_seconds:
        return False, "timestamp_outside_tolerance"
    expected = compute_signature(secret, timestamp, body)
    if not constant_time_equals(expected, signature.strip().lower()):
        return False, "signature_mismatch"
    return True, None


class SlidingWindowLimiter:
    """In-process per-key limiter. Single-instance only; good enough for the demo."""

    def __init__(self, *, limit: int, window_seconds: float = 60.0) -> None:
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str, *, now: float | None = None) -> tuple[bool, int]:
        current = time.monotonic() if now is None else now
        hits = self._hits.setdefault(key, deque())
        cutoff = current - self.window_seconds
        while hits and hits[0] < cutoff:
            hits.popleft()
        if len(hits) >= self.limit:
            return False, 0
        hits.append(current)
        return True, self.limit - len(hits)
