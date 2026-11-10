"""Typed application errors mapped to a single, documented HTTP envelope."""

from __future__ import annotations

from typing import Any


class VerdictPayError(Exception):
    code = "internal_error"
    status_code = 500
    default_message = "An unexpected error occurred."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: list[dict[str, Any]] | None = None,
        code: str | None = None,
        status_code: int | None = None,
    ) -> None:
        self.message = message or self.default_message
        self.details = details or []
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        super().__init__(self.message)


class ValidationFailedError(VerdictPayError):
    code = "validation_error"
    status_code = 422
    default_message = "Request validation failed."


class UnauthorizedError(VerdictPayError):
    code = "unauthorized"
    status_code = 401
    default_message = "Missing or invalid credentials."


class ForbiddenError(VerdictPayError):
    code = "forbidden"
    status_code = 403
    default_message = "You are not allowed to perform this action."


class NotFoundError(VerdictPayError):
    code = "not_found"
    status_code = 404
    default_message = "Resource not found."


class ConflictError(VerdictPayError):
    code = "conflict"
    status_code = 409
    default_message = "Conflict with the current state of the resource."


class RateLimitedError(VerdictPayError):
    code = "rate_limited"
    status_code = 429
    default_message = "Too many requests."


class UpstreamError(VerdictPayError):
    code = "upstream_error"
    status_code = 502
    default_message = "Upstream PayPal call failed."

    def __init__(
        self,
        message: str | None = None,
        *,
        details: list[dict[str, Any]] | None = None,
        code: str | None = None,
        status_code: int | None = None,
        issues: list[str] | None = None,
        upstream_status: int | None = None,
    ) -> None:
        super().__init__(message, details=details, code=code, status_code=status_code)
        # Machine-readable PayPal ``details[].issue`` tokens, so callers can
        # branch on ORDER_NOT_APPROVED rather than parsing the message text.
        self.issues = issues or []
        self.upstream_status = upstream_status

    def has_issue(self, issue: str) -> bool:
        """True when PayPal reported this exact issue token."""
        return issue in self.issues


class IllegalDisputeActionError(VerdictPayError):
    code = "illegal_dispute_action"
    status_code = 422
    default_message = "That action is not allowed in the dispute's current state."


class WebhookVerificationError(VerdictPayError):
    code = "webhook_verification_failed"
    status_code = 401
    default_message = "Webhook signature could not be verified."


class SentinelVetoError(VerdictPayError):
    """The Sentinel returned exit code 2: the PayPal write is blocked."""

    code = "sentinel_veto"
    status_code = 422
    default_message = "EXIT CODE 2 - VETO: the Sentinel blocked this PayPal write."
