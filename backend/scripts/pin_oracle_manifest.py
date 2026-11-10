#!/usr/bin/env python
"""Re-pin the oracle policy manifest digest after a deliberate policy edit.

    uv run --directory backend python scripts/pin_oracle_manifest.py [--check]

``--check`` only verifies (exit 0 ok, exit 2 tampered/missing); without it the
canonical SHA-256 of app/oracle/rules_manifest.json is written into
PINNED_RULES_SHA256 in app/oracle/manifest.py.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.oracle import manifest
from app.oracle.money import strict_loads


def main(argv: list[str]) -> int:
    try:
        rules = strict_loads(manifest.MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print(f"VETO_FAIL_CLOSED_ORACLE_MISSING: {exc}", file=sys.stderr)
        return 2
    actual = manifest.digest(rules)
    if "--check" in argv:
        ok = actual == manifest.PINNED_RULES_SHA256
        print(("ok " if ok else "TAMPERED ") + actual)
        return 0 if ok else 2
    source = Path(manifest.__file__)
    text = re.sub(
        r'^PINNED_RULES_SHA256 = "[0-9a-f]*"',
        f'PINNED_RULES_SHA256 = "{actual}"',
        source.read_text(encoding="utf-8"),
        flags=re.MULTILINE,
    )
    source.write_text(text, encoding="utf-8")
    print(f"pinned {actual}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
