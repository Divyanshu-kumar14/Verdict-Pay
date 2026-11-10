"""Reason-aware narrative composer constrained to locked facts.

The template path is deterministic and fully offline. The validator is the air
gap: every number-like token in generated prose must already exist in the
locked fact pack, so an LLM cannot smuggle an invented figure into a dossier.
"""

from __future__ import annotations

import json
import re
import unicodedata
from collections.abc import Mapping
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

from app.api import schemas

MAX_NARRATIVE_CHARS: Final[int] = 8000
_BANNED_PHRASES: Final[tuple[str, ...]] = ("guarantee", "100%", "we will win")
_TIMESTAMP_RE: Final[re.Pattern[str]] = re.compile(
    r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?"
)
_DATE_RE: Final[re.Pattern[str]] = re.compile(r"\d{4}-\d{2}-\d{2}")
_NUMBER_RE: Final[re.Pattern[str]] = re.compile(r"\d+(?:\.\d+)?")

_COUNT_WORDS: Final[dict[int, str]] = {
    0: "no",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
}


def _ascii(text: str) -> str:
    """Fold text to ASCII, dropping characters with no ASCII equivalent."""
    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii")


def _utc(value: datetime) -> datetime:
    """Return a timezone-aware UTC datetime (naive values are assumed UTC)."""
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _iso(value: datetime) -> str:
    """Render a datetime as a deterministic ISO-8601 UTC string."""
    return _utc(value).strftime("%Y-%m-%dT%H:%M:%SZ")


def _count_word(count: int) -> str:
    """Render a small count as an English word so no invented digit is emitted."""
    return _COUNT_WORDS.get(count, "several")


def build_template_narrative(
    *,
    facts: schemas.CaseFacts,
    reason_code: str,
    stage: str,
    amount_usd: Decimal,
    merchant_name: str,
) -> str:
    """Render a professional four-paragraph seller-protection rebuttal.

    Every cited value comes from the locked fact pack; amounts are deliberately
    not restated because CaseFacts does not carry the disputed amount.
    """
    if not isinstance(facts, schemas.CaseFacts):
        raise TypeError("facts must be a schemas.CaseFacts instance")
    if not reason_code or not stage or not merchant_name:
        raise ValueError("reason_code, stage and merchant_name must be non-empty")
    if not isinstance(amount_usd, Decimal):
        raise TypeError("amount_usd must be a Decimal")
    if amount_usd <= 0:
        raise ValueError("amount_usd must be positive")

    merchant = _ascii(merchant_name).strip() or "The merchant"
    payer_id = _ascii(facts.payer_id)
    reason = _ascii(reason_code)
    stage_label = _ascii(stage)

    opening = (
        f"{merchant} respectfully responds to the PayPal dispute filed by payer "
        f"{payer_id} under reason code {reason} at stage {stage_label}. The disputed amount "
        "is recorded verbatim in the locked fact summary of this dossier and is not "
        "restated here. Every statement below is derived from the merchant's append-only "
        "telemetry ledger and is reproducible from the chain head cited in this response."
    )

    if facts.tos_version or facts.tos_hash:
        contract = (
            "The payer accepted our Terms of Service version "
            f"{_ascii(facts.tos_version) if facts.tos_version else 'not recorded'}, accepted "
            "at "
            f"{_iso(facts.tos_accepted_at) if facts.tos_accepted_at else 'not recorded'}, "
            "with accepted document SHA-256 "
            f"{_ascii(facts.tos_hash) if facts.tos_hash else 'not recorded'}."
        )
    else:
        contract = (
            "No Terms of Service acceptance is recorded in the telemetry ledger for this payer."
        )

    first_seen = _iso(facts.first_seen) if facts.first_seen else "not recorded"
    last_seen = _iso(facts.last_seen) if facts.last_seen else "not recorded"
    chain_status = "valid" if facts.chain_valid else "invalid"
    ledger = (
        f"The ledger holds {facts.event_count} events and {facts.login_count} authenticated "
        f"logins for this payer across {_count_word(len(facts.ips))} distinct IP addresses and "
        f"{_count_word(len(facts.devices))} distinct device fingerprints, first seen "
        f"{first_seen} and last seen {last_seen}. The SHA-256 chain head is "
        f"{_ascii(facts.chain_head) if facts.chain_head else 'not recorded'} and its "
        f"verification status is {chain_status}."
    )

    if facts.deliveries:
        latest = facts.deliveries[0]
        resource_id = _ascii(str(latest.get("resource_id") or "unnamed"))
        resource_hash = _ascii(str(latest.get("sha256") or "not recorded"))
        delivered_at = _ascii(str(latest.get("delivered_at") or "not recorded"))
        delivery = (
            f"Delivery evidence: the most recent delivered asset is resource {resource_id} "
            f"with SHA-256 {resource_hash}, recorded at {delivered_at}."
        )
    else:
        delivery = "No asset delivery is recorded in the telemetry ledger for this payer."

    usage = (
        f"The account consumed {facts.usage_units} metered units across "
        f"{facts.usage_events} usage events, which is consistent with active use of the "
        "purchased product."
    )

    if facts.ce3_matches:
        entries = "; ".join(
            f"{_ascii(str(match.get('transaction_id')))} "
            f"(USD {_ascii(str(match.get('amount_usd')))}, "
            f"{int(match.get('days_ago', 0))} days ago)"
            for match in facts.ce3_matches
        )
        window = (
            f"the {facts.ce3_window_days}-day lookback window"
            if facts.ce3_window_days > 0
            else "the lookback window"
        )
        ce3 = (
            "Visa Compelling Evidence history: the following prior completed transactions "
            f"inside {window} share the payer's IP address or device fingerprint: {entries}. "
            "They establish a stable customer identity well before this dispute."
        )
    else:
        ce3 = (
            "Visa Compelling Evidence history: no prior completed transactions inside the "
            "lookback window share the payer's IP address or device fingerprint."
        )

    if facts.response_due_date is not None:
        deadline = (
            "The seller response is submitted before the response deadline of "
            f"{_iso(facts.response_due_date)}."
        )
    else:
        deadline = (
            "The seller response is submitted before the response deadline set by PayPal "
            "for this stage."
        )

    paragraphs = [
        opening,
        f"{contract} {ledger}",
        f"{delivery} {usage}",
        f"{ce3} {deadline}",
    ]
    text = "\n\n".join(" ".join(paragraph.split()) for paragraph in paragraphs)
    return _ascii(text)


_HEX_DIGEST_RE: Final[re.Pattern[str]] = re.compile(
    r"(?<![0-9A-Za-z])[0-9a-fA-F]{32,64}(?![0-9A-Za-z])"
)
# Fields that hold digests. Their characters are never a source of "allowed
# numbers": a 64-char hex string contains almost every short digit run, which
# used to let an invented figure pass the substring check.
_HASH_FIELDS: Final[frozenset[str]] = frozenset(
    {"chain_head", "tos_hash", "sha256", "sha256_manifest", "resource_hash"}
)


def _hashes(facts: schemas.CaseFacts) -> set[str]:
    found: set[str] = set()
    for value in (facts.chain_head, facts.tos_hash):
        if value:
            found.add(value.lower())
    for delivery in facts.deliveries:
        digest = delivery.get("sha256") if isinstance(delivery, Mapping) else None
        if isinstance(digest, str) and digest:
            found.add(digest.lower())
    proof = facts.ce3_proof or {}
    if isinstance(proof.get("sha256_manifest"), str):
        found.add(proof["sha256_manifest"].lower())
    return found


def _facts_tokens(facts: schemas.CaseFacts) -> tuple[set[str], set[str], set[str]]:
    """Dates, numbers and digests a narrative may cite, from structured fields only.

    Numbers come from numeric fields (counts, completeness, amounts, days) and
    from identifier/date/IP strings, never from digest fields. Membership is
    exact-token, not substring.
    """
    dates: set[str] = set()
    numbers: set[str] = set()

    def walk(value: Any, key: str | None = None) -> None:
        if key in _HASH_FIELDS:
            return
        if isinstance(value, bool) or value is None:
            return
        if isinstance(value, datetime):
            moment = _utc(value)
            dates.add(moment.date().isoformat())
            numbers.update(_NUMBER_RE.findall(_iso(moment)))
        elif isinstance(value, (int, Decimal, float)):
            numbers.add(str(value))
            if isinstance(value, float) and value.is_integer():
                numbers.add(str(int(value)))
        elif isinstance(value, str):
            dates.update(match.group(0) for match in _DATE_RE.finditer(value))
            numbers.update(_NUMBER_RE.findall(value))
        elif isinstance(value, Mapping):
            for item_key, item in value.items():
                walk(item, str(item_key))
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item, key)

    walk(facts.model_dump(mode="python"))
    return dates, numbers, _hashes(facts)


def validate_narrative(text: str, facts: schemas.CaseFacts) -> tuple[bool, str]:
    """Check a narrative against the locked facts; return (ok, reason).

    Rejects empty/oversized text, banned marketing phrases, non-ASCII text, any
    digest that is not one of the fact pack's digests, and any date or number
    token that is not an exact value of a structured fact field.
    """
    if not isinstance(text, str) or not text.strip():
        return False, "empty_narrative"
    if len(text) > MAX_NARRATIVE_CHARS:
        return False, "narrative_too_long"
    lowered = text.lower()
    for phrase in _BANNED_PHRASES:
        if phrase in lowered:
            return False, f"banned_phrase:{phrase}"
    if not text.isascii():
        return False, "non_ascii"
    if not isinstance(facts, schemas.CaseFacts):
        return False, "invalid_facts"

    date_tokens, number_tokens, digests = _facts_tokens(facts)
    scratch = text
    for match in _HEX_DIGEST_RE.finditer(text):
        token = match.group(0)
        if not any(ch.isalpha() for ch in token):
            continue  # a long plain number, judged below
        if token.lower() not in digests:
            return False, f"unverified_digest:{token[:12]}"
    scratch = _HEX_DIGEST_RE.sub(" ", scratch)
    for match in _DATE_RE.finditer(scratch):
        if match.group(0) not in date_tokens:
            return False, f"unverified_date:{match.group(0)}"

    # "SHA-256" is a fixed algorithm label, not a numeric claim.
    scratch = scratch.replace("SHA-256", " ").replace("sha-256", " ")
    for match in _TIMESTAMP_RE.finditer(scratch):
        if match.group(0)[:10] not in date_tokens:
            return False, f"unverified_date:{match.group(0)[:10]}"
    scratch = _TIMESTAMP_RE.sub(" ", scratch)
    scratch = _DATE_RE.sub(" ", scratch)
    for match in _NUMBER_RE.finditer(scratch):
        token = match.group(0)
        if token not in number_tokens:
            return False, f"unverified_number:{token}"
    return True, "ok"


def facts_as_prompt(facts: schemas.CaseFacts) -> str:
    """Render the locked fact pack as a deterministic, LLM-readable prompt block."""
    if not isinstance(facts, schemas.CaseFacts):
        raise TypeError("facts must be a schemas.CaseFacts instance")
    lines = [
        "LOCKED FACTS - the only values allowed in the narrative:",
        f"payer_id={facts.payer_id}",
        f"chain_valid={facts.chain_valid}",
        f"chain_head={facts.chain_head or 'not recorded'}",
        f"event_count={facts.event_count}",
        f"login_count={facts.login_count}",
        f"completeness={facts.completeness}",
        f"tos_version={facts.tos_version or 'not recorded'}",
        f"tos_hash={facts.tos_hash or 'not recorded'}",
        f"tos_accepted_at="
        f"{_iso(facts.tos_accepted_at) if facts.tos_accepted_at else 'not recorded'}",
        f"first_seen={_iso(facts.first_seen) if facts.first_seen else 'not recorded'}",
        f"last_seen={_iso(facts.last_seen) if facts.last_seen else 'not recorded'}",
        f"response_due_date="
        f"{_iso(facts.response_due_date) if facts.response_due_date else 'not recorded'}",
        f"ips={json.dumps(facts.ips)}",
        f"devices={json.dumps(facts.devices)}",
        f"usage_units={facts.usage_units}",
        f"usage_events={facts.usage_events}",
        f"deliveries={json.dumps(facts.deliveries, sort_keys=True)}",
        f"ce3_window_days={facts.ce3_window_days}",
        f"ce3_matches={json.dumps(facts.ce3_matches, sort_keys=True)}",
        f"signals={json.dumps(facts.signals, sort_keys=True)}",
    ]
    return "\n".join(lines)
