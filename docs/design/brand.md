# VerdictPay brand guide

Dark financial control room. One accent does the talking, everything else is a
hairline. This folder is the source of truth for the mark, the lockup, the social
card and the token set; `frontend/` consumes it, never the other way round.

---

## 1. What the mark means

| Element | Meaning |
|---|---|
| Shield silhouette | Seller protection. The thing standing between the merchant and the fee. |
| Two 45-degree chevron flanks | The shield is built from two chevron planes that meet at the point: forward motion, a decisive edge. |
| Carved check (negative space) | The verdict. Deterministic adjudication, not a suggestion. The check is cut out of the plate, not laid on top, because a verdict is not decoration. |
| Mitered check vertex | The chain joint: evidence is linked and sealed, and the check is the thing that makes it legible. |

Deliberately absent: gavels, scales of justice, handshakes, padlocks, PayPal marks.
PayPal is a trademark and never appears in our assets.

The mark is one evenodd path on a 24-unit grid. At 16 px it reads as shield plus
check and nothing else; do not add detail below that size.

---

## 2. Asset inventory

| File | viewBox | Purpose | Colour behaviour |
|---|---|---|---|
| `design/logo-mark.svg` | `0 0 24 24` | Primary mark, app UI, avatars, footers | `currentColor`; inherits text colour. No background. |
| `design/logo-lockup.svg` | `0 0 200 40` | Header, decks, partner pages | Mark + wordmark both `currentColor`, default `color="#E6EDF3"` on the root. |
| `design/favicon.svg` | `0 0 32 32` | Browser tab, PWA icon | Fixed: emerald mark on a `#080B0F` rounded square with a 10% white rim. |
| `design/og-image.svg` | `0 0 1200 630` | Open Graph / Twitter card | Fixed dark composition. `width`/`height` set for scrapers. |
| `design/tokens.css` | n/a | Colour, type, spacing, radius, shadow, focus, z-index | Dark only. Tailwind v4 `@theme` mapping documented in the file. |
| `design/validate-assets.py` | n/a | Re-runnable static checks | See section 9. |

All SVGs are hand-authored: no raster, no `<image>`, no scripts, no external
fonts, no `@import`, no external URLs. The OG card keeps every word as a live
`<text>` element so copy can be edited without a design tool.

---

## 3. Clear space

**Mark.** Keep a margin equal to 25% of the mark's height on all four sides.
At 24 px that is 6 units; at 16 px it is 4 px. Nothing (text, rule, border, edge
of a card) enters that zone.

**Lockup.** Keep 12 px of clear space around the 200 x 40 box (0.3x the lockup
height). The wordmark already carries 24 px left and right padding inside the box;
do not crop into it.

**Favicon.** The rounded square is the boundary. Never place the mark on a light
square without the `#080B0F` plate behind it.

---

## 4. Minimum sizes

| Asset | Digital minimum | Print minimum |
|---|---|---|
| Mark | 16 px | 8 mm |
| Lockup | 100 px wide (20 px tall) | 30 mm wide |
| Favicon | 16 px rendered from the 32 px viewBox | n/a |
| OG card | ship at 1200 x 630 only | n/a |

Below 100 px, drop the lockup and use the mark alone. Below 16 px, use the favicon
variant (the check is already widened from 2.9 to 3.3 units for that case).

---

## 5. Do / Don't

**Do**

- Render the mark in a single flat colour: `#34D399` on `#080B0F`, `#E6EDF3` on
  `#080B0F`, or `#080B0F` on a light surface.
- Keep the aspect ratio locked to the viewBox.
- Use the mark alone when the brand is already established on the page.
- Pair the emerald mark with ink text; emerald is for the mark, positive states and
  primary actions, not for body copy.
- Let hairlines do the separating: `rgba(255,255,255,0.07)` at 1 px.

**Don't**

- Don't rotate, skew, outline, bevel, glow or drop-shadow the mark.
- Don't stretch it non-uniformly, or rebuild it from separate shapes in Figma.
- Don't add a second accent colour to the mark or put it on a photo without a dark
  plate behind it.
- Don't use the carved check on its own as a logo, icon or bullet.
- Don't recolour the favicon plate; it is a fixed emerald-on-void tile.
- Don't set the wordmark in another weight, case, or font. It is uppercase, weight
  600, tracking 0.125em.
- Don't put the mark in the same visual weight as a status badge; if it appears next
  to a status dot, the dot wins.

---

## 6. Colour tokens

Defined in `design/tokens.css`. Dark only by design: VerdictPay is a control room,
not a document.

| Token | Value | Use |
|---|---|---|
| `--color-void` | `#080B0F` | Page ground, SVG canvas, favicon plate |
| `--color-chrome` | `#0B1117` | Top bar, sidebar, table header |
| `--color-panel` | `#0E141B` | Cards, panels, OG dossier cards |
| `--color-raised` | `#121A23` | Popovers, menus, active rows |
| `--color-row-alt` | `#0C1219` | Even-row stripe (depth cue only) |
| `--color-sunken` | `#06090C` | Wells, code blocks |
| `--color-border` | `rgba(255,255,255,0.07)` | Default 1 px hairline |
| `--color-border-strong` | `#5A6B7F` | Input edges, control boundaries, table frame (3.39:1) |
| `--color-line` | `#1B2430` | Solid decorative rule |
| `--color-ink` | `#E6EDF3` | Primary text, wordmark |
| `--color-muted` | `#8B98A5` | Secondary text, column heads |
| `--color-dim` | `#74869B` | Micro labels, timestamps |
| `--color-emerald` | `#34D399` | Value preserved, verdict pass, primary accent |
| `--color-amber` | `#FBBF24` | Fee exposure, decision still open |
| `--color-rose` | `#FB7185` | Money at risk, rejection, chain break |
| `--color-sky` | `#7DD3FC` | System fact, chain state, links |
| `--color-focus` | `#A7B6C6` | Focus ring, 2 px + 2 px offset |
| `--color-*-soft` | accent @ 12% | Tinted backgrounds, chips |

Semantic aliases (what components should use): `--color-positive`,
`--color-warning`, `--color-danger`, `--color-info`, `--color-bg`,
`--color-surface`, `--color-text`, `--color-accent`. Type roles live in the
same file: `--text-display`, `--text-h1`, `--text-h2`, `--text-h3`,
`--text-body`, `--text-body-sm`, `--text-label`, `--text-micro`,
`--text-numeric`, each with line-height, tracking and weight companions.

Contrast on `#080B0F` (WCAG AA needs 4.5:1 body, 3:1 large):

| Pair | Ratio |
|---|---|
| `#E6EDF3` on `#080B0F` | 16.69:1 |
| `#8B98A5` on `#080B0F` | 6.70:1 |
| `#74869B` on `#080B0F` | 5.28:1 |
| `#34D399` on `#080B0F` | 10.26:1 |
| `#FBBF24` on `#080B0F` | 11.81:1 |
| `#FB7185` on `#080B0F` | 7.33:1 |
| `#A7B6C6` on `#080B0F` | 8.95:1 |
| `#080B0F` on `#34D399` | 10.26:1 |

**Why the focus ring is steel, not emerald.** Emerald means "value preserved"
everywhere else. A focus ring in the same hue makes the *active* element read as a
*successful outcome*. `#A7B6C6` is the only high-contrast neutral that never
collides with a data colour, and it clears the 3:1 focus-appearance requirement
with margin.

**Reconciliation with `docs/design/brief.md`.** The brief and this file agree on
every value except one: the brief (and the shipped `frontend/app/globals.css`)
uses `--color-muted: #93A1B0` (7.02:1 on panel); the brand palette is
`#8B98A5` (6.70:1). They are four RGB points apart and visually
indistinguishable; `tokens.css` ships `#8B98A5`. If the app keeps
`#93A1B0`, change that one line in `tokens.css` and this table — do not let both
values exist. Everything else (chrome, row-alt, border-strong, focus steel, type
roles) follows the brief so there is a single system to adopt.

---

## 7. Inlining the mark in React with `currentColor`

`logo-mark.svg` is `currentColor` on purpose: one component, any context, no
duplicate files per theme.

```tsx
// components/verdictpay-mark.tsx
import type { SVGProps } from "react";

const MARK_PATH =
  "M5.4 2.4H18.6L20.4 4.2V13.2L12 21.6L3.6 13.2V4.2Z " +
  "M6.17 12.73L10.3 16.85L17.83 9.33L15.77 7.27L10.3 12.75L8.23 10.67Z";

export function VerdictPayMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
      {...props}
    >
      <path fill="currentColor" fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}
```

```tsx
// emerald on the dark shell
<VerdictPayMark className="size-6 text-emerald" />

// inherits the surrounding text colour, no prop needed
<a className="flex items-center gap-2 text-ink" href="/">
  <VerdictPayMark className="size-6" />
  <span className="text-sm font-semibold tracking-[0.125em]">VERDICTPAY</span>
</a>
```

With Tailwind v4 the `text-emerald` class comes from `--color-emerald` in
`@theme`; with plain CSS use `style={{ color: "var(--color-emerald)" }}` or
`color: var(--color-accent)` on the svg.

Because the default is `currentColor`, a bare `logo-mark.svg` opened outside a
CSS context renders in the inherited colour (black). Set `color` on the svg, the
parent, or the document before judging it. The lockup is the exception: it declares
`color="#E6EDF3"` on its root so it is visible standalone, and CSS targeting the
svg element overrides it (a parent's `color` will not, because the presentation
attribute is a declaration on the element itself).

---

## 8. Wordmark caveat (read before shipping the lockup)

The wordmark is live `<text>`: `font-family="Inter, ui-sans-serif, system-ui,
-apple-system, 'Segoe UI', Roboto, Arial, sans-serif"`, `font-size="16"`,
`font-weight="600"`, `letter-spacing="2"`. It is **not converted to outlines**.

What that means:

- With Inter installed, the lockup is the intended design.
- Without Inter, the fallback system sans renders a different wordmark: glyph shapes,
  stroke contrast and total width all change. The 200 x 40 box absorbs common
  fallbacks (the copy is centred with 24 px of slack on each side), but the right
  edge will not land in the same place on every machine, and the result is *a correct
  lockup*, not the same lockup.
- Consequence: do not use the live-text lockup for print, paid media, merchandise,
  or anywhere the wordmark must be pixel-identical. Convert it to paths first
  (Inkscape: select the text, *Path > Object to Path*; Illustrator: *Type > Create
  Outlines*), or export a PNG at 2x from a machine with Inter installed.
- In-product, prefer the React snippet in section 7 with a CSS wordmark next to the
  mark: it uses the app's already-loaded font and never depends on this file's text
  metrics.

If the wordmark is re-typeset by hand, the rules are fixed: uppercase
`VERDICTPAY`, weight 600, tracking 0.125em, cap height centred on the mark's
optical centre.

---

## 9. Validation

`design/validate-assets.py` is dependency-free and re-runnable from the repo root:

```bash
python3 design/validate-assets.py
# PASS  248 checks across 4 SVGs + tokens.css
```

It asserts, per file: well-formed XML, `<svg>` root, a `viewBox`, no fixed
`width`/`height` except the OG card, no `<image>`/`<script>`/
`<foreignObject>`, no `data:` URIs, no `@import`, no external URLs, only
`currentColor` / `none` / `url(#...)` / documented palette hexes for every
`fill`, `stroke` and `stop-color`, non-empty `d` on every path, one single
path in the mark, the `#080B0F` rounded square in the favicon, real `<text>` for
every OG string, and then that `tokens.css` defines every `var()` it uses.

The SVG palette is exactly: `#080B0F`, `#0E141B`, `#121A23`, `#1B2430`,
`#34D399`, `#FBBF24`, `#FB7185`, `#7DD3FC`, `#E6EDF3`, `#8B98A5`,
`#74869B`, `#FFFFFF` (white is only ever used with an opacity for hairlines).

---

## 10. Editing rules

- Re-run the validator after any change; a red check means the asset does not ship.
- Keep the mark on the 24-unit grid and keep the path count at one. If a variant
  needs more detail, it is a different asset, not a tweak to this one.
- New colours go into `tokens.css` first, then into this table, then into the SVG
  palette in `validate-assets.py`. Never introduce a hex that only exists in one
  file.
- `frontend/` owns application layout; `design/` owns brand. Do not edit frontend
  styles from here, and do not fork the mark into an inline copy in a component:
  import it and tint it with `currentColor`.
