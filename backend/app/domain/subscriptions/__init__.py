"""Subscription lifecycle domain: containment of a disputed payer's billing."""

from app.domain.subscriptions.containment import ContainmentResult, contain_subscription

__all__ = ["ContainmentResult", "contain_subscription"]
