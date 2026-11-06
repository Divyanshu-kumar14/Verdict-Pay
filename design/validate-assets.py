#!/usr/bin/env python3
"""Static validation for the VerdictPay brand assets.

Run from the repo root:  python3 design/validate-assets.py
Exit code 0 = every check passed.
No third-party dependencies.

Checks the shipped palette (docs/design/direction.md): the assets in this
folder and design/tokens.css must carry no colour the app does not ship, and
tokens.css must define every token the shipped app defines.
"""

from __future__ import annotations

import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent
SVGS = ["logo-mark.svg", "logo-lockup.svg", "favicon.svg", "og-image.svg"]

# Every colour allowed inside an SVG: currentColor, none, an internal url(#id),
# or one of these documented palette hexes.
PALETTE = {
    "#171719",  # ground / page
    "#131217",  # surface (a card, darker than the ground)
    "#212023",  # raised
    "#222224",  # line
    "#1B1A1F",  # rule
    "#3A3A3E",  # control boundary
    "#4A8AD6",  # accent - the selection line
    "#44A282",  # positive
    "#D9A441",  # warning
    "#E5566F",  # negative
    "#5FC39C",  # the mark's fill / positive pill ink
    "#FFFFFF",  # ink, and the hairline base (always drawn with an opacity)
    "#8A8C92",  # muted
    "#E6EDF3",  # logo-lockup.svg standalone default (see docs/design/brand.md)
}

# The palette the rebuild replaced. None of it may survive in an asset.
SUPERSEDED = (
    "#080B0F", "#0B1117", "#0E141B", "#121A23", "#0C1219", "#06090C",
    "#1B2430", "#5A6B7F", "#34D399", "#FBBF24", "#FB7185", "#7DD3FC",
    "#8B98A5", "#74869B", "#A7B6C6", "#93A1B0",
)

COLOUR_ATTRS = ("fill", "stroke", "stop-color", "flood-color", "lighting-color")

failures: list[str] = []
checks = 0


def check(condition: bool, message: str) -> None:
    global checks
    checks += 1
    if not condition:
        failures.append(message)


def local(tag: str) -> str:
    return tag.split("}")[-1]


def scan_svg(path: pathlib.Path) -> None:
    name = path.name
    text = path.read_text(encoding="utf-8")
    upper = text.upper()

    # 1. Well-formed XML ---------------------------------------------------
    try:
        tree = ET.parse(path)
    except ET.ParseError as exc:  # pragma: no cover - hard failure
        check(False, f"{name}: XML parse error: {exc}")
        return
    check(True, f"{name}: parses as XML")

    root = tree.getroot()
    check(local(root.tag) == "svg", f"{name}: root element is <svg>")
    check("viewBox" in root.attrib, f"{name}: has a viewBox")

    # 2. No fixed width/height except the social card -----------------------
    if name != "og-image.svg":
        check("width" not in root.attrib, f"{name}: no fixed width attribute")
        check("height" not in root.attrib, f"{name}: no fixed height attribute")
    else:
        check(root.attrib.get("width") == "1200", "og-image.svg: width 1200")
        check(root.attrib.get("height") == "630", "og-image.svg: height 630")

    # 3. No raster, script, or external references --------------------------
    forbidden_tags = {"image", "script", "foreignObject", "iframe", "video", "audio"}
    for el in root.iter():
        tag = local(el.tag)
        check(tag not in forbidden_tags, f"{name}: no <{tag}> element")
        for attr, value in el.attrib.items():
            if local(attr) == "href":
                check(value.startswith("#"), f"{name}: href must be internal, found {value!r}")
    check("data:" not in text, f"{name}: no data: URI / embedded raster")
    check("@import" not in text, f"{name}: no @import")
    without_ns = text.replace("http://www.w3.org/2000/svg", "")
    check("http" not in without_ns, f"{name}: no external URLs")

    # 4. Colours: shipped palette only --------------------------------------
    for el in root.iter():
        for attr in COLOUR_ATTRS:
            value = el.attrib.get(attr)
            if value is None:
                continue
            value = value.strip()
            if value in {"none", "currentColor", "transparent"}:
                continue
            if value.startswith("url(#"):
                check(value.endswith(")"), f"{name}: malformed url() colour {value!r}")
                continue
            check(
                value.upper() in PALETTE,
                f"{name}: colour {value!r} on <{local(el.tag)}> is not in the shipped palette",
            )
        style = el.attrib.get("style", "")
        for prop in re.findall(r"(?:fill|stroke|stop-color)\s*:\s*([^;]+)", style):
            value = prop.strip()
            if value in {"none", "currentColor", "transparent"} or value.startswith("url(#"):
                continue
            check(value.upper() in PALETTE, f"{name}: style colour {value!r} not in palette")
    for hex_value in SUPERSEDED:
        check(hex_value not in upper, f"{name}: superseded colour {hex_value} is still present")

    # 5. Geometry -----------------------------------------------------------
    for el in root.iter():
        tag = local(el.tag)
        if tag == "path":
            d = el.attrib.get("d", "").strip()
            check(bool(d), f"{name}: <path> has a non-empty d attribute")
            check(bool(re.search(r"[0-9]", d)), f"{name}: <path> d has coordinates")
        if tag == "rect":
            check(
                all(k in el.attrib for k in ("width", "height")),
                f"{name}: <rect> has width and height",
            )

    # 6. Per-file rules -----------------------------------------------------
    if name == "logo-mark.svg":
        paths = [el for el in root.iter() if local(el.tag) == "path"]
        others = [el for el in root.iter() if local(el.tag) not in {"svg", "path"}]
        check(len(paths) == 1, "logo-mark.svg: exactly one path")
        check(not others, "logo-mark.svg: contains only the path (no background element)")
        check(paths[0].attrib.get("fill") == "currentColor", "logo-mark.svg: fill is currentColor")
    if name == "logo-lockup.svg":
        check(
            root.attrib.get("color") == "#E6EDF3",
            "logo-lockup.svg: standalone default colour is #E6EDF3",
        )
    if name == "favicon.svg":
        rects = [el for el in root.iter() if local(el.tag) == "rect"]
        base = rects[0] if rects else None
        check(base is not None, "favicon.svg: has a background rect")
        if base is not None:
            check(
                base.attrib.get("fill", "").upper() == "#171719",
                "favicon.svg: rounded square is #171719",
            )
            check("rx" in base.attrib, "favicon.svg: rounded square has rx")
        check("#5FC39C" in upper, "favicon.svg: mark is #5fc39c")
    if name == "og-image.svg":
        texts = [el for el in root.iter() if local(el.tag) == "text"]
        check(len(texts) >= 6, "og-image.svg: copy is real <text> (>= 6 elements)")
        joined = " ".join("".join(el.itertext()) for el in texts)
        for phrase in (
            "Win the dispute before",
            "the fee attaches.",
            "0-fee deflection",
            "$15/$30 fee-cliff EV",
            "SHA-256 chain of custody",
        ):
            check(phrase in joined, f"og-image.svg: headline/chip text {phrase!r} present")


def scan_tokens() -> None:
    path = ROOT / "tokens.css"
    raw = path.read_text(encoding="utf-8")
    css = re.sub(r"/\*.*?\*/", "", raw, flags=re.S)
    defined = set(re.findall(r"(--[A-Za-z0-9_-]+)\s*:", css))
    used = set(re.findall(r"var\(\s*(--[A-Za-z0-9_-]+)", css))
    missing = sorted(used - defined)
    check(not missing, f"tokens.css: every var() is defined (missing: {missing})")
    check(not re.search(r"@import", css), "tokens.css: no @import")
    check("color-scheme: dark" in css, "tokens.css: declares color-scheme dark")
    check(
        "frontend/app/globals.css" in raw,
        "tokens.css: names frontend/app/globals.css as the source of truth",
    )
    for required in (
        "--color-ground",
        "--color-surface",
        "--color-raised",
        "--color-line",
        "--color-rule",
        "--color-control",
        "--color-ink",
        "--color-muted",
        "--color-accent",
        "--color-positive",
        "--color-warning",
        "--color-negative",
        "--color-chart-1",
        "--color-chart-2",
        "--color-chart-3",
        "--color-pill-positive",
        "--color-pill-positive-ink",
        "--color-pill-negative",
        "--color-pill-negative-ink",
        "--color-pill-warning",
        "--color-pill-warning-ink",
        "--color-pill-neutral",
        "--color-pill-neutral-ink",
        "--color-pill-accent",
        "--color-pill-accent-ink",
        "--radius-card",
        "--radius-control",
        "--shadow-float",
        "--font-sans",
        "--text-2xs",
        "--text-xs",
        "--text-sm",
        "--text-base",
        "--text-md",
        "--text-lg",
        "--text-xl",
        "--spacing-row",
        "--spacing-control",
        "--spacing-rail",
        "--spacing-pad",
        "--spacing-gap",
        "--ease-snap",
        "--z-modal",
    ):
        check(required in defined, f"tokens.css: defines {required}")
    check("--color-ground: #171719" in css, "tokens.css: ground is #171719")
    check("--color-surface: #131217" in css, "tokens.css: surface is #131217")
    for hex_value in SUPERSEDED:
        check(hex_value not in raw.upper(), f"tokens.css: superseded colour {hex_value} still present")


def main() -> int:
    for svg in SVGS:
        scan_svg(ROOT / svg)
    scan_tokens()

    for line in failures:
        print(f"FAIL  {line}")
    if failures:
        print(f"\n{len(failures)} failure(s) across {checks} checks")
        return 1
    print(f"PASS  {checks} checks across {len(SVGS)} SVGs + tokens.css")
    return 0


if __name__ == "__main__":
    sys.exit(main())
