#!/usr/bin/env python3
"""Prove (or disprove) that no credential reaches a judge's browser or an API body.

What this checks
----------------
1. CLIENT BUNDLE — every file Next.js ships to the browser (`frontend/.next/static/**`,
   `frontend/public/**`, plus the rendered HTML of each route, which is the same trust
   boundary). A match here means the secret is downloadable by anyone.
2. SERVER BUNDLE — `frontend/.next/server/**`. Inside the trust boundary, but a leaked
   secret in a build artifact is still a leak worth reporting separately.
3. API RESPONSES — the JSON/PDF bodies of the live demo API. A secret in a response body
   is leaked no matter which bundle produced it.
4. CONFIG HYGIENE — no `NEXT_PUBLIC_*` variable may hold a PayPal secret (a NEXT_PUBLIC_
   value is inlined into the browser bundle by design).

Reported output is only `leaked: yes|no` plus a match count per secret. The secrets
themselves are never printed, never written, and never used as a filename: this script is
safe to run in a recorded demo. A 0-match result is verified by construction — the
search needle is the real value read from .env at runtime.

Exit code: 0 when nothing leaked, 1 when any scope leaked (so CI can gate on it).

Usage
-----
    python3 scripts/qa/secret_leak_check.py                  # API at 127.0.0.1:8000
    python3 scripts/qa/secret_leak_check.py --api http://127.0.0.1:8000
    python3 scripts/qa/secret_leak_check.py --skip-api       # bundle + config only
    python3 scripts/qa/secret_leak_check.py --json           # machine-readable summary
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIR = REPO_ROOT / "frontend"
ENV_FILES = (
    REPO_ROOT / ".env",
    FRONTEND_DIR / ".env.local",
    FRONTEND_DIR / ".env",
    REPO_ROOT / "backend" / ".env",
)

# Secret-ish keys we care about. A value shorter than MIN_SECRET_LEN is treated as a
# placeholder (e.g. "changeme") and skipped, because a 4-char needle matches everything.
SECRET_KEYS = (
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_WEBHOOK_ID",
    "VERDICTPAY_SIGNING_SECRET",
    "VERDICTPAY_WEBHOOK_SECRET",
    "VERDICTPAY_API_KEY",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
)
MIN_SECRET_LEN = 8

# A value the product *must* send from the browser is not a leak; it is the auth header.
# These are allow-listed only when the deployed value still equals the documented demo
# key, so a real key dropped into the same variable is still caught.
PUBLIC_BY_DESIGN = {
    "VERDICTPAY_API_KEY": {"vp_demo_sk_local"},
}
# A NEXT_PUBLIC_* variable may never hold one of these: they are server-side only.
NEVER_PUBLIC = (
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_WEBHOOK_ID",
    "VERDICTPAY_SIGNING_SECRET",
    "VERDICTPAY_WEBHOOK_SECRET",
    "OPENAI_API_KEY",
    "GEMINI_API_KEY",
)

BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".woff", ".woff2", ".ttf"}
TEXT_SUFFIXES = {".js", ".mjs", ".cjs", ".json", ".html", ".css", ".map", ".txt", ".svg", ".xml"}

API_ROUTES: tuple[tuple[str, str], ...] = (
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/disputes?per_page=50"),
    ("GET", "/api/v1/reporting/summary"),
    ("GET", "/api/v1/reporting/transactions?limit=20"),
)


@dataclass
class ScopeResult:
    scope: str
    files_or_bodies_scanned: int = 0
    bytes_scanned: int = 0
    extra: dict[str, object] = field(default_factory=dict)


def load_env_values() -> dict[str, str]:
    """Read secrets from the repo's env files without ever logging them."""
    found: dict[str, str] = {}
    for path in ENV_FILES:
        if not path.is_file():
            continue
        for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key in SECRET_KEYS and len(value) >= MIN_SECRET_LEN:
                found.setdefault(key, value)
    # An exported shell variable wins over a stale file, matching Settings' precedence.
    for key in SECRET_KEYS:
        value = os.environ.get(key, "").strip()
        if len(value) >= MIN_SECRET_LEN:
            found[key] = value
    return found


def iter_bundle_files(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    out: list[Path] = []
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix.lower() in BINARY_SUFFIXES:
            continue
        if path.suffix.lower() in TEXT_SUFFIXES:
            out.append(path)
    return out


def count_matches(haystack: bytes, needle: bytes) -> int:
    return haystack.count(needle) if needle else 0


def is_public_by_design(key: str, value: str) -> bool:
    return value in PUBLIC_BY_DESIGN.get(key, set())


def scan_scope(scope: str, items: list[tuple[str, bytes]], secrets: dict[str, str]) -> dict:
    """Count occurrences of each secret across named blobs."""
    per_secret = {
        key: {
            "leaked": False,
            "matches": 0,
            "public_by_design": is_public_by_design(key, value),
        }
        for key, value in secrets.items()
    }
    offenders: dict[str, list[str]] = {key: [] for key in secrets}
    total_bytes = 0
    for name, blob in items:
        total_bytes += len(blob)
        for key, value in secrets.items():
            hits = count_matches(blob, value.encode("utf-8"))
            if hits:
                # Presence of a public-by-design demo key is recorded, not counted as a leak.
                if not is_public_by_design(key, value):
                    per_secret[key]["leaked"] = True
                per_secret[key]["matches"] += hits
                if len(offenders[key]) < 5:
                    offenders[key].append(name)
    return {
        "scope": scope,
        "scanned": len(items),
        "bytes": total_bytes,
        "secrets": per_secret,
        "offenders": {key: files for key, files in offenders.items() if files},
        "leaked": any(entry["leaked"] for entry in per_secret.values()),
    }


def scan_client_bundle(secrets: dict[str, str], html_by_route: dict[str, bytes]) -> dict:
    items: list[tuple[str, bytes]] = []
    for path in iter_bundle_files(FRONTEND_DIR / ".next" / "static"):
        items.append((str(path.relative_to(FRONTEND_DIR)), path.read_bytes()))
    for path in iter_bundle_files(FRONTEND_DIR / "public"):
        items.append((str(path.relative_to(FRONTEND_DIR)), path.read_bytes()))
    for route, blob in html_by_route.items():
        items.append((f"html:{route}", blob))
    return scan_scope("client_bundle_downloadable_by_a_judge", items, secrets)


def scan_server_bundle(secrets: dict[str, str]) -> dict:
    items = [
        (str(path.relative_to(FRONTEND_DIR)), path.read_bytes())
        for path in iter_bundle_files(FRONTEND_DIR / ".next" / "server")
    ]
    return scan_scope("server_bundle_not_shipped_to_browser", items, secrets)


def http_get(url: str, headers: dict[str, str], timeout: float = 10.0) -> tuple[int, bytes]:
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310
            return response.status, response.read()
    except urllib.error.HTTPError as error:  # a 4xx body is still a body
        return error.code, error.read()
    except (urllib.error.URLError, TimeoutError) as error:
        raise SystemExit(f"API unreachable at {url}: {error}") from error


def scan_api(api_base: str, api_key: str, secrets: dict[str, str]) -> dict:
    headers = {"Accept": "application/json", "X-API-Key": api_key}
    items: list[tuple[str, bytes]] = []

    status, health = http_get(f"{api_base}/api/v1/health", headers)
    items.append(("GET /api/v1/health", health))
    if status != 200:
        raise SystemExit(f"health answered HTTP {status}; start the demo API first")

    for method, path in API_ROUTES[1:]:
        status, body = http_get(f"{api_base}{path}", headers)
        items.append((f"{method} {path} -> {status}", body))

    # A dispute detail + manifest + dossier add the richest payloads the UI shows.
    try:
        status, listing = http_get(f"{api_base}/api/v1/disputes?per_page=5", headers)
        dispute_ids = [
            item["dispute_id"]
            for item in json.loads(listing)["data"][:3]
            if isinstance(item, dict) and "dispute_id" in item
        ]
    except (KeyError, TypeError, json.JSONDecodeError):
        dispute_ids = []
    for dispute_id in dispute_ids:
        quoted = urllib.parse.quote(dispute_id, safe="")
        for suffix in ("", "/dossier/manifest", "/ai"):
            status, body = http_get(f"{api_base}/api/v1/disputes/{quoted}{suffix}", headers)
            items.append((f"GET /disputes/{dispute_id}{suffix} -> {status}", body))
        status, body = http_get(f"{api_base}/api/v1/disputes/{quoted}/dossier.pdf", headers)
        items.append((f"GET /disputes/{dispute_id}/dossier.pdf -> {status}", body))

    return scan_scope("api_response_bodies", items, secrets)


def scan_public_config(secrets: dict[str, str]) -> dict:
    """No NEXT_PUBLIC_* value may hold a PayPal (or signing/webhook) secret.

    ``NEXT_PUBLIC_*`` is inlined into the browser bundle by Next.js, so a PayPal secret
    there is a guaranteed credential leak. The demo API key is different: the browser is
    *supposed* to send it, and it is documented as public in frontend/README.md, so it is
    recorded as ``public_by_design`` instead of a violation — but only while its value
    still equals the documented demo key.
    """
    violations: list[dict[str, object]] = []
    public_by_design: list[dict[str, object]] = []
    for path in ENV_FILES:
        if not path.is_file():
            continue
        for number, raw in enumerate(
            path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1
        ):
            line = raw.strip()
            if not line.startswith("NEXT_PUBLIC_") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            for secret_key, secret_value in secrets.items():
                if not value or value != secret_value:
                    continue
                record = {
                    "file": str(path.relative_to(REPO_ROOT)),
                    "line": number,
                    "public_var": key,
                    "public_var_holds": secret_key,
                }
                if is_public_by_design(secret_key, value):
                    public_by_design.append(
                        {**record, "verdict": "public by design (documented demo key)"}
                    )
                else:
                    violations.append(
                        {
                            **record,
                            "verdict": (
                                "CRITICAL: a server-side secret is inlined into the "
                                "browser bundle"
                            ),
                        }
                    )
    return {
        "scope": "next_public_config_hygiene",
        "violations": violations,
        "public_by_design": public_by_design,
        "leaked": bool(violations),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--api-key", default=os.environ.get("VERDICTPAY_API_KEY", "vp_demo_sk_local"))
    parser.add_argument("--skip-api", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument(
        "--out",
        default=str(REPO_ROOT / "artifacts" / "qa" / "secret-leak-report.json"),
    )
    args = parser.parse_args()

    secrets = load_env_values()
    if not secrets:
        raise SystemExit(
            "No secrets found in .env files. Populate the repo .env first; a leak check "
            "against placeholder values proves nothing."
        )

    # Render each route's HTML with the running UI when available (that HTML is what a
    # judge's browser receives), so a server-rendered leak cannot hide behind a bundle.
    html_by_route: dict[str, bytes] = {}
    web_base = os.environ.get("AUDIT_BASE", "http://127.0.0.1:3000").rstrip("/")
    for route in ("/", "/demo", "/disputes", "/analytics", "/settings", "/veto-lab"):
        try:
            _status, body = http_get(f"{web_base}{route}", {"Accept": "text/html"}, timeout=15.0)
        except SystemExit:
            html_by_route = {}
            break
        html_by_route[route] = body

    report: dict[str, object] = {
        "secrets_checked": sorted(secrets),
        "secret_values_printed": False,
        "web_base": web_base if html_by_route else None,
        "scopes": [],
    }
    scans = [scan_client_bundle(secrets, html_by_route), scan_server_bundle(secrets), scan_public_config(secrets)]
    if not args.skip_api:
        scans.append(scan_api(args.api, args.api_key, secrets))
    report["scopes"] = scans
    leaked = any(scope.get("leaked") for scope in scans)
    report["leaked"] = leaked

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    if args.json:
        print(json.dumps(report, indent=2))
    else:
        print(f"secrets checked ({len(secrets)}): {', '.join(sorted(secrets))}")
        print("values are never printed; only yes/no + match counts\n")
        header = f"{'scope':46} {'files':>6} {'MB':>7}  leaked"
        print(header)
        print("-" * len(header))
        for scope in scans:
            if scope["scope"] == "next_public_config_hygiene":
                print(f"{scope['scope']:46} {'-':>6} {'-':>7}  {'yes' if scope['leaked'] else 'no'}")
                for violation in scope["violations"]:
                    print(f"    VIOLATION {violation}")
                for note in scope["public_by_design"]:
                    print(
                        f"    ok {note['public_var']} in {note['file']} "
                        f"(holds {note['public_var_holds']}, public by design)"
                    )
                continue
            print(
                f"{scope['scope']:46} {scope['scanned']:>6} "
                f"{scope['bytes'] / 1024 / 1024:>7.2f}  {'yes' if scope['leaked'] else 'no'}"
            )
            for key, entry in scope["secrets"].items():
                if entry["leaked"]:
                    print(
                        f"    {key}: leaked=yes matches={entry['matches']} "
                        f"in {scope['offenders'].get(key, [])[:3]}"
                    )
                elif entry["matches"]:
                    print(
                        f"    {key}: public-by-design demo key, present in "
                        f"{entry['matches']} place(s) (not a leak)"
                    )
        print()
        print(f"VERDICT: leaked={'yes' if leaked else 'no'}   report={out_path}")
    return 1 if leaked else 0


if __name__ == "__main__":
    sys.exit(main())
