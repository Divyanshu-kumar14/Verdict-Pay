# VerdictPay brand guide

A forensic instrument in a sealed evidence room: calibrated, machined and readable
under load. Dark only — one accent does the talking, everything else is a hairline.
`docs/design/direction.md` is the authoritative record of the interface; this file
covers the mark, the lockup, the social card and the token set, which mirrors the
shipped tokens in `frontend/app/globals.css`.

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

The mark is one `evenodd` path on a 24-unit grid. At 16 px it reads as shield plus
check and nothing else; do not add detail below that size. Its fill is `#5fc39c`,
or `#ffffff`, on a `#171719` plate — the app ships exactly that at
`frontend/app/icon.svg` and `frontend/public/favicon.svg`.

---

## 2. Asset inventory

| File | viewBox | Purpose | Colour behaviour |
|---|---|---|---|
| `design/logo-mark.svg` | `0 0 24 24` | Primary mark, app UI, avatars, footers | `currentColor`; inherits text colour. No background. |
| `design/logo-lockup.svg` | `0 0 200 40` | Header, decks, partner pages | Mark + wordmark both `currentColor`, default `color="#E6EDF3"` on the root. |
| `design/favicon.svg` | `0 0 32 32` | Browser tab, PWA icon | Fixed: `#5fc39c` mark on a `#171719` rounded square with a 10% white rim. |
| `design/og-image.svg` | `0 0 1200 630` | Open Graph / Twitter card | Fixed dark composition. `width`/`height` set for scrapers. |
| `design/tokens.css` | n/a | Colour, type, spacing, radius, shadow, motion, z-index | Dark only; mirrors `frontend/app/globals.css`. Tailwind v4 `@theme` mapping documented in the file. |
| `design/validate-assets.py` | n/a | Re-runnable static checks | See section 9. |

All SVGs are hand-authored: no raster, no `<image>`, no scripts, no external
fonts, no `@import`, no external URLs. The OG card keeps every word as a live
`<text>` element so copy can be edited without a design tool.

---

## 3. Clear space

**Mark.** Keep a margin equal to 25% of the mark's height on all four sides.
At 24 px that is 6 units; at 16 px it is 4 px. Nothing — text, rule, border, edge
of a card — enters that zone.

**Lockup.** Keep 12 px of clear space around the 200 x 40 box (0.3x the lockup
height). The wordmark already carries 24 px left and right padding inside the box;
do not crop into it.

**Favicon.** The rounded square is the boundary. Never place the mark on a light
square without the `#171719` plate behind it.

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

- Render the mark in a single flat colour: `#5fc39c` on `#171719`, `#ffffff`
  on `#171719`, or `#171719` on a light surface.
- Keep the aspect ratio locked to the viewBox.
- Use the mark alone when the brand is already established on the page.
- Keep colour semantic. `#44a282` means value preserved or chain intact;
  `#4a8ad6` is the 1px selection line and nothing else; `#5fc39c` is the brand
  tint and never body copy.
- Let hairlines do the separating: `--color-line` (`#222224`) at 1 px.

**Don't**

- Don't rotate, skew, outline, bevel, glow or drop-shadow the mark.
- Don't stretch it non-uniformly, or rebuild it from separate shapes in Figma.
- Don't add a second accent colour to the mark or put it on a photo without a dark
  plate behind it.
- Don't use the carved check on its own as a logo, icon or bullet.
- Don't recolour the favicon plate; it is a fixed mark-on-ground tile.
- Don't set the wordmark in another weight, case, or font. It is uppercase, weight
  600, tracking 0.125em.
- Don't put the mark in the same visual weight as a status badge; if it appears next
  to a status dot, the dot wins.

---

## 6. Colour tokens

The shipped palette is Tailwind v4 `@theme` tokens in
`frontend/app/globals.css`; `design/tokens.css` mirrors it. Dark only by
design: VerdictPay is a control room, not a document.

| Token | Value | Role | Contrast on ground |
|---|---|---|---|
| `--color-ground` | `#171719` | The page. Everything sits on it. | — |
| `--color-surface` | `#131217` | A card. Deliberately darker than the ground. | — |
| `--color-raised` | `#212023` | Hover, control fill, popover. | — |
| `--color-line` | `#222224` | The 1px edge of a panel. | 1.13:1 |
| `--color-rule` | `#1b1a1f` | A divider between rows, inside a surface. | 1.08:1 |
| `--color-control` | `#3a3a3e` | Input and control boundaries. | 1.58:1 |
| `--color-ink` | `#ffffff` | Every figure and every title. | 17.90:1 |
| `--color-muted` | `#8a8c92` | Labels, sublines, axis ticks, dates. | 5.33:1 |
| `--color-accent` | `#4a8ad6` | The selection line, and nothing else. | 5.03:1 |
| `--color-positive` | `#44a282` | Value preserved, chain intact, containment held. | 5.74:1 |
| `--color-warning` | `#d9a441` | A decision still open, fee exposure. | 7.96:1 |
| `--color-negative` | `#e5566f` | Money at risk, a broken chain, a failure. | 5.02:1 |
| `--color-chart-1` | `#f2f2f3` | Chart marks when a chart needs three series. | — |
| `--color-chart-2` | `#e5566f` | Second chart series. | — |
| `--color-chart-3` | `#4a8ad6` | Third chart series. | — |

**Pills.** A status word is a tinted ground with readable ink on it — never a
hairline border and never a bare hue:

| Pill | Ground | Ink | Ratio |
|---|---|---|---|
| positive | `#1b2828` | `#5fc39c` | 7.08:1 |
| negative | `#2c1a20` | `#e5566f` | 4.62:1 |
| warning | `#2a2416` | `#d9a441` | 6.85:1 |
| neutral | `#212023` | `#bdbdc0` | 8.65:1 |
| accent | `#1b2233` | `#7fb0ef` | 7.07:1 |

The accent pill exists because `--color-accent` on `--color-raised` is 4.55:1:
it passes, but with no margin worth shipping inside a small pill. `#7fb0ef` on
`#1b2233` is the same hue family at 7.07:1.

**Text floors.** Every text pair clears WCAG AA 4.5:1 on its own surface, and every
control boundary clears 3:1. The tightest text pair in the system is
`--color-negative` on `--color-raised` at 4.55:1.

**Focus.** The focus ring is a 2px `--color-accent` outline at a 2px offset, set
in `frontend/app/globals.css`; there is no separate focus token.

**Numbers.** Figures are tabular (`font-variant-numeric: tabular-nums`) wherever a
value can change under the reader, and money, p(win), ratios and counts are
right-aligned — including the header cell. A sign lives in the text (`+$25.00`,
`-$30.00`), not in a colour; colour is the second encoding, never the only one.

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
// the brand tint on the dark ground
<VerdictPayMark className="size-6 text-positive" />

// inherits the surrounding text colour, no prop needed
<a className="flex items-center gap-2 text-ink" href="/">
  <VerdictPayMark className="size-6" />
  <span className="text-sm font-semibold">VerdictPay</span>
</a>
```

With Tailwind v4 the `text-positive` class comes from `--color-positive` in
`@theme`; with plain CSS use `style={{ color: "var(--color-positive)" }}` or
`color: var(--color-accent)` on the svg.

Because the default is `currentColor`, a bare `logo-mark.svg` opened outside a
CSS context renders in the inherited colour — black. Set `color` on the svg, the
parent, or the document before judging it. The lockup is the exception: it declares
`color="#E6EDF3"` on its root so it is visible standalone, and CSS targeting the
svg element overrides it. A parent's `color` will not, because the presentation
attribute is a declaration on the element itself.

---

## 8. Wordmark caveat (read before shipping the lockup)

The wordmark is live `<text>`: `font-family="Public Sans, Inter, ui-sans-serif,
system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif"`,
`font-size="16"`, `font-weight="600"`, `letter-spacing="2"`. It is **not
converted to outlines**.

What that means:

- With Public Sans installed, the lockup is the intended design.
- Without it, the fallback system sans renders a different wordmark: glyph shapes,
  stroke contrast and total width all change. The 200 x 40 box absorbs common
  fallbacks (the copy is centred with 24 px of slack on each side), but the right
  edge will not land in the same place on every machine, and the result is *a correct
  lockup*, not the same lockup.
- Consequence: do not use the live-text lockup for print, paid media, merchandise,
  or anywhere the wordmark must be pixel-identical. Convert it to paths first
  (Inkscape: select the text, *Path > Object to Path*; Illustrator: *Type > Create
  Outlines*), or export a PNG at 2x from a machine with Public Sans installed.
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
# PASS  353 checks across 4 SVGs + tokens.css
```

It asserts, per file: well-formed XML, an `<svg>` root, a `viewBox`, no fixed
`width`/`height` except the OG card, no `<image>`/`<script>`/
`<foreignObject>`, no `data:` URIs, no `@import`, no external URLs, only
`currentColor` / `none` / `url(#...)` / documented palette hexes for every
`fill`, `stroke` and `stop-color`, non-empty `d` on every path, one single
path in the mark, the `#171719` rounded square and `#5fc39c` mark in the favicon,
real `<text>` for every OG string, and then that `tokens.css` defines every
`var()` it uses and every shipped token.

The SVG palette is exactly: `#171719`, `#131217`, `#212023`, `#222224`,
`#4a8ad6`, `#44a282`, `#d9a441`, `#e5566f`, `#5fc39c`, `#ffffff`,
`#8a8c92`, `#E6EDF3` (the lockup's standalone default), and `#FFFFFF`
(white is only ever used with an opacity, for hairlines).

---

## 10. Editing rules

- Re-run the validator after any change; a red check means the asset does not ship.
- Keep the mark on the 24-unit grid and keep the path count at one. If a variant
  needs more detail, it is a different asset, not a tweak to this one.
- New colours go into `frontend/app/globals.css` first, then `design/tokens.css`,
  then this table, then the SVG palette in `validate-assets.py`. Never introduce a
  hex that only exists in one file.
- No invented vanity metrics: every figure on screen is served by the API.
- No new runtime dependency without a named reason in the commit.
- `frontend/` owns application layout; `design/` owns brand. Do not edit frontend
  styles from here, and do not fork the mark into an inline copy in a component:
  import it and tint it with `currentColor`.