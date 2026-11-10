"""SHA-256 pinned policy manifest (``rules_manifest.json``).

The digest is computed over the *canonical* JSON form (sorted keys, no
whitespace, floats rejected), so reformatting the file does not change it but
editing any threshold does. ``PINNED_RULES_SHA256`` is the expected digest;
``scripts/pin_oracle_manifest.py`` rewrites it after a deliberate policy edit.

Stdlib only (imported by the isolated Sentinel subprocess).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.oracle.money import FloatRejectedError, strict_loads

MANIFEST_PATH = Path(__file__).with_name("rules_manifest.json")
PINNED_RULES_SHA256 = "e1da6d35bafe7b281d57347a5fe32fe3608e46cc16805d3e01f6070464239082"
EXIT_FAIL_CLOSED = 2


class ManifestError(RuntimeError):
    """The manifest is missing, unparsable, float-bearing or tampered."""

    veto_code = "VETO_FAIL_CLOSED_ORACLE_MISSING"


@dataclass(frozen=True, slots=True)
class RulesManifest:
    rules: dict[str, Any]
    sha256: str

    def section(self, name: str) -> dict[str, Any]:
        value = self.rules.get(name)
        if not isinstance(value, dict):
            raise ManifestError(f"manifest section {name!r} missing")
        return value


def canonical_bytes(rules: Any) -> bytes:
    return json.dumps(rules, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def digest(rules: Any) -> str:
    return hashlib.sha256(canonical_bytes(rules)).hexdigest()


def load_manifest(
    path: Path | str = MANIFEST_PATH, *, expected_sha256: str = PINNED_RULES_SHA256
) -> RulesManifest:
    """Load and verify the manifest; raise ManifestError on any doubt."""
    target = Path(path)
    try:
        raw = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise ManifestError(f"rules manifest unreadable: {target.name}") from exc
    try:
        rules = strict_loads(raw)
    except FloatRejectedError as exc:
        raise ManifestError("rules manifest contains a float literal") from exc
    except ValueError as exc:
        raise ManifestError("rules manifest is not valid JSON") from exc
    if not isinstance(rules, dict):
        raise ManifestError("rules manifest must be a JSON object")
    actual = digest(rules)
    if actual != expected_sha256:
        raise ManifestError(
            f"rules manifest digest mismatch (expected {expected_sha256[:12]}…, got {actual[:12]}…)"
        )
    return RulesManifest(rules=rules, sha256=actual)


_CACHE: dict[str, RulesManifest] = {}


def get_manifest() -> RulesManifest:
    """Process-wide verified manifest (verified once, then cached)."""
    cached = _CACHE.get("default")
    if cached is None:
        cached = load_manifest()
        _CACHE["default"] = cached
    return cached
