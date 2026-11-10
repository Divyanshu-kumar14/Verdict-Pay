"""HMAC-SHA256 ApprovalTokens, issued by the trusted parent on a Sentinel ALLOW.

The isolated Sentinel never holds a key. The parent signs
``{proposal_id, action, dispute_id, expires_at_epoch, manifest_sha256, scope}``
with a key derived from ``VERDICTPAY_SIGNING_SECRET`` and verifies it again
right before the PayPal write, so a write without a fresh, matching token fails.

``scope`` separates the two issuers that hold the same key:

* ``live_gateway`` — issued only by :func:`app.sentinel.bridge.authorize`, the
  single path that fronts a real PayPal write;
* ``veto_lab_preview`` — issued by ``/api/v1/veto-lab/*`` for dry-run evidence.

``verify`` accepts nothing but ``live_gateway``, so a token a caller obtained
from the public Veto Lab endpoints can never authorise a write.
"""

from __future__ import annotations

import contextvars
import hashlib
import hmac
import json
import time
from collections.abc import Mapping
from typing import Any

TOKEN_TTL_SECONDS = 120
_KEY_CONTEXT = b"verdictpay-sentinel-approval-v1"
# The only scope that may authorise a PayPal write. Every other scope is a
# preview: it can be displayed, never redeemed.
SCOPE_LIVE = "live_gateway"
SCOPE_PREVIEW = "veto_lab_preview"

# The token authorising the PayPal write currently in flight (one per task).
current_approval: contextvars.ContextVar[dict[str, Any] | None] = contextvars.ContextVar(
    "sentinel_current_approval", default=None
)


class ApprovalError(PermissionError):
    veto_code = "VETO_MISSING_APPROVAL_TOKEN"


def _key(secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), _KEY_CONTEXT, hashlib.sha256).digest()


def _body(token: Mapping[str, Any]) -> bytes:
    fields = {
        "proposal_id": str(token.get("proposal_id") or ""),
        "action": str(token.get("action") or ""),
        "dispute_id": str(token.get("dispute_id") or ""),
        "expires_at_epoch": int(token.get("expires_at_epoch") or 0),
        "manifest_sha256": str(token.get("manifest_sha256") or ""),
        "scope": str(token.get("scope") or ""),
    }
    return json.dumps(fields, sort_keys=True, separators=(",", ":")).encode("utf-8")


def issue(
    *,
    secret: str,
    proposal_id: str,
    action: str,
    dispute_id: str,
    manifest_sha256: str,
    scope: str,
    now: float | None = None,
) -> dict[str, Any]:
    token: dict[str, Any] = {
        "proposal_id": proposal_id,
        "action": action,
        "dispute_id": dispute_id,
        "expires_at_epoch": int((now or time.time()) + TOKEN_TTL_SECONDS),
        "manifest_sha256": manifest_sha256,
        "scope": scope,
    }
    token["sig_hmac_sha256"] = hmac.new(_key(secret), _body(token), hashlib.sha256).hexdigest()
    return token


def verify(
    token: Mapping[str, Any] | None,
    *,
    secret: str,
    action: str,
    dispute_id: str,
    now: float | None = None,
) -> None:
    """Raise ApprovalError unless the token is genuine, fresh and for this write."""
    if not isinstance(token, Mapping):
        raise ApprovalError("no Sentinel ApprovalToken for this PayPal write")
    expected = hmac.new(_key(secret), _body(token), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, str(token.get("sig_hmac_sha256") or "")):
        raise ApprovalError("ApprovalToken signature is invalid")
    if token.get("scope") != SCOPE_LIVE:
        raise ApprovalError("ApprovalToken was not issued for a live PayPal write")
    if int(token.get("expires_at_epoch") or 0) < int(now or time.time()):
        raise ApprovalError("ApprovalToken expired")
    if token.get("action") != action or token.get("dispute_id") != dispute_id:
        raise ApprovalError("ApprovalToken was issued for a different action or dispute")
