# VerdictPay — Design Brief

Decision document for the dark "financial control room" UI: Next.js 15 · Tailwind v4 · AG Grid Community · 6 pages. Scope: visual language, tokens, type, layout, component states, motion, charts, accessibility, page composition. No implementation code.

**Source access note (fetched 2026-11-06).** Fetchable and used below: [Geist colors](https://vercel.com/geist/colors), [Radix scale docs](https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), [Grafana theme source](https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/themes/createColors.ts), [Grafana palette](https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/themes/palette.ts), [Tabler Icons](https://tabler.io/icons), [Raycast](https://www.raycast.com/), [Linear](https://linear.app/method), [Mercury](https://mercury.com/), [Ramp](https://ramp.com/), [Bryntum Scheduler](https://bryntum.com/products/scheduler/examples/). Blocked / unusable: [Siteinspire](https://www.siteinspire.com/) (HTTP 429, Vercel checkpoint), [Land-book](https://land-book.com/) (403, Cloudflare), [Dribbble](https://dribbble.com/) (JS challenge), [Mobbin](https://mobbin.com/) (app login-gated), [Stripe dashboard](https://dashboard.stripe.com/) (auth wall — no measurements taken). [Awwwards](https://www.awwwards.com/), [Collect UI](https://collectui.com/), [CSSDA](https://www.cssdesignawards.com/), [One Page Love](https://onepagelove.com/), [Aceternity](https://ui.aceternity.com/), [Magic UI](https://magicui.design/), [React Bits](https://www.reactbits.dev/) load but are JS-driven indexes with no token documentation; they are *effect* libraries (shader, blur, marquee) and are explicitly not a source for this product. [shadcn theming](https://ui.shadcn.com/docs/theming) is client-rendered and not extractable. No pixel value below is attributed to a source unless that source was read.

---

## 1. Art direction

1. VerdictPay looks like a payments operations terminal at 2am: a near-black `#080B0F` canvas, panels exactly one luminance step up at `#0E141B`, and nothing on screen that is not a number, a state, or an action.
2. Every surface is a flat, opaque plane separated by a 1px 7%-white hairline — no blur, no gradient fills, no ambient glow; depth comes from a three-step luminance ladder (`#080B0F` → `#0E141B` → `#121A23`), never from light.
3. Colour is a data channel, not decoration: emerald `#34D399` only for value preserved or verified, amber `#FBBF24` only for a decision still open, rose `#FB7185` only for money at risk — each appears at most twice per viewport, always with a label, never as a background wash.
4. Type is small, exact and mostly uppercase at the edges: 13px Geist Sans for prose, 10px tracked labels for structure, Geist Mono tabular figures for every dollar, percentage and hash, so the eye reads columns rather than sentences.
5. Motion is confined to state confirmation in under 200ms on one easing curve; the only thing permitted to move unprompted is a 6px live dot, because the product's entire promise is that the numbers hold still while the money moves.

---

## 2. Eight reference archetypes

| # | Archetype | URL | What to steal | What NOT to copy |
|---|---|---|---|---|
| 1 | **Linear** | [linear.app/method](https://linear.app/method) | List-first navigation; selection expressed as a filled row surface plus a 2px left accent, never as an outline; one accent colour per viewport; keyboard-first row actions. | Its extreme quietness (barely-there borders, tiny type) only works at low column counts. At 12 columns on a 1560px canvas it becomes mud — we hold 7% hairlines and 44px rows instead. |
| 2 | **Raycast** | [raycast.com](https://www.raycast.com/) | The launcher split: a dense scannable list on the left, a persistent detail pane on the right, and keyboard hints rendered as physical keycaps inline with the row (their site renders real `esc F1…F12` keys). | The command-palette cosplay — blurred backdrop, floating rounded sheet, glow. Our split is two opaque panels on one canvas with a hairline gutter. |
| 3 | **Vercel Geist** | [vercel.com/geist/colors](https://vercel.com/geist/colors) | Their published colour *grammar*: exactly two page backgrounds (1 primary, 2 sparing), component backgrounds 1–3 for default/hover/active, borders 4–6 for default/hover/active, high-contrast pairs 7–8; "draw each border once"; translucent, never opaque, shadows. | Light-mode-first spacing generosity — their panels breathe, ours must carry three times the data per screen. Also their grey-on-grey restraint: we need semantic colour, they don't. |
| 4 | **Radix Colors** | [radix-ui.com/colors](https://www.radix-ui.com/colors) | The 12-step contract as an engineering rule: step 3 = component bg, 4 = hover, 5 = selected, 6 = decorative border, 7 = interactive border/focus ring, 8 = strong border, 11/12 = text; their docs state steps 11–12 are guaranteed APCA Lc 60 / Lc 90 on a step-2 background. | Shipping whole scales. We use one neutral ladder and four accents; anything else is a chart-only ramp. Also: don't inherit their light-mode step numbers — dark mode inverts which step reads as "raised". |
| 5 | **Grafana** | [theme source](https://github.com/grafana/grafana/blob/main/packages/grafana-data/src/themes/createColors.ts) | Named background tiers `canvas / page / primary / secondary / elevated`; borders named by job `weak / medium / strong` ("decoration / widget / active-focused"); hover as a **3%** white wash (`hoverFactor = 0.03`); `contrastThreshold = 3` used to auto-pick text on fills. Their dark `canvas` is `#111217` and `elevated` `#22252b` — the +0x11-per-channel jump is the ladder we copy. | Panel-everywhere dashboards. A card is not a container for a widget; it is a container for a decision, and if it holds no decision it does not get a card. |
| 6 | **Bryntum Scheduler** | [Scheduler examples](https://bryntum.com/products/scheduler/examples/) | Resource-lane × time-axis model with a locked first column and sticky header; zoom as a segmented control (Day / Week / Month); "now" as a single vertical line across lanes. | Their enterprise chrome: toolbar stacks, per-cell grid lines, drag handles, and 1px borders on all four sides of every event. Our timeline is borderless lanes with one accent line. |
| 7 | **Mercury** | [mercury.com](https://mercury.com/) | Money-first hierarchy: the balance leads, metadata recedes, and the wordmark discipline (uppercase, tracked, small) is repeated in-product as the section label. Their "Try the demo" entry keeps marketing and product visually identical. | Their editorial rhythm — generous whitespace and a serif register. That is a bank landing page; this is a control room where 25 rows must fit above the fold. |
| 8 | **Ramp** | [ramp.com](https://ramp.com/) | Statement-row discipline: amount is the only bold element, merchant and date recede, right-aligned figures hold a column edge across thousands of rows. (Their marketing page ships an animated digit-roll "number-flow" ticker; we take the tabular alignment only.) | The rolling counter. A number that moves on its own in a dispute console reads as unreliability — EV values must land settled in one frame. |

Tooling references for later sections: [AG Grid theming params](https://www.ag-grid.com/react-data-grid/theming-compactness/) (row height / header height are theme params, so density is a token, not CSS overrides) and [Tabler Icons](https://tabler.io/icons) (24×24 viewBox, `stroke-width: 2`, round caps — verified in their served SVG, so all icons stay optically matched at 14/16/20px).

---

## 3. Design tokens

Measured with the WCAG 2.x relative-luminance formula against panel `#0E141B` unless stated. Ratios are computed, not sampled from a design tool; re-verify if any hex changes. AA normal text = 4.5:1, AA non-text/UI = 3:1 ([1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)).

| Token (Tailwind `@theme`) | Hex | Job | Contrast on panel | Verdict |
|---|---|---|---|---|
| `--color-void` | `#080B0F` | App canvas, page background | — | n/a |
| `--color-panel` | `#0E141B` | Panels, grid body, cards | — | n/a |
| `--color-raised` | `#121A23` | Menus, popovers, tooltips, nested cards | — | n/a |
| `--color-chrome` | `#0B1117` | Top bar, sidebar, table header, grid chrome | — | consolidates today's `#0a0f14` / `#0b1117` split |
| `--color-row-alt` | `#0C1219` | Even-row stripe | — | 1.02:1 vs panel: depth cue only |
| `--color-border` | `rgba(255,255,255,0.07)` | Hairlines, dividers, panel edges | 1.19:1 (composited `#1F242B`) | decorative by design — never the sole indicator |
| `--color-border-strong` | `#5A6B7F` | Input edges, focusable control boundaries, table frame | **3.39:1** | passes 1.4.11 |
| `--color-text` (`ink`) | `#E6EDF3` | Primary text, KPI values, table cell emphasis | **15.66:1** | AAA |
| `--color-muted` | `#93A1B0` | Secondary text, column heads, descriptions | **7.02:1** | AAA |
| `--color-dim` | `#74869B` | Micro labels, timestamps, disabled-adjacent meta | **4.96:1** | AA — do not go below 11px or lighter than this |
| `--color-positive` | `#34D399` | Verified chain, EV preserved, win, "valid" | **9.63:1** | AAA |
| `--color-warning` | `#FBBF24` | Open decision, deadline imminent, simulator mode | **11.09:1** | AAA |
| `--color-danger` | `#FB7185` | Money at risk, illegal action, chain break | **6.88:1** | AA normal, AAA large |
| `--color-info` | `#7DD3FC` | Neutral system facts, links, live telemetry | **11.10:1** | AAA |
| `--color-focus` | `#A7B6C6` | Focus ring, 2px + 2px offset | **8.95:1** | passes 2.4.13; deliberately *not* emerald |

**Why focus is not emerald.** Emerald means "value preserved" everywhere else in this UI. A focus ring in the same hue makes an active element read as a successful outcome. Steel `#A7B6C6` is the only high-contrast neutral that never collides with a data colour, and at 8.95:1 it clears the 3:1 focus-appearance requirement with margin.

**Tinted chips.** Status chips = 12% accent over panel + accent text: positive `#132B2A` (text 7.77:1), warning `#2A291C` (8.78:1), danger `#2A1F28` (5.89:1), info `#1B2B36` (8.71:1). Never use a solid accent fill for a chip except the single "selected action" button, where text is `#04140D` on emerald (9.83:1).

**Selection.** Selected grid row `#12251F` with text 13.57:1; hover is the panel + 4% white (`#181D24`), matching Grafana's 3–4% wash convention rather than a new hue.

---

## 4. Type system

**Families.** UI = **Geist Sans**; data = **Geist Mono**. Both already ship with the installed `geist@1.9.1` package (exports `geist/font/sans`, `geist/font/mono` — verified in `node_modules/geist/package.json`), so there is no second font request and no fallback flash. Stacks: `ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` / `ui-monospace, "SFMono-Regular", Menlo, monospace`. Only two families, ever; no serif, no display face, no third weight family.

| Role | Size / line-height | Tracking | Weight | Case | Where |
|---|---|---|---|---|---|
| display | 28 / 32 | −0.02em | 600 | sentence | Analytics hero number-pair, settings title |
| h1 | 22 / 28 | −0.015em | 600 | sentence | Page title (`PageHeader`) |
| h2 | 16 / 24 | −0.01em | 600 | sentence | Panel title |
| h3 | 13.5 / 20 | −0.005em | 600 | sentence | Card / section title |
| body | 13 / 20 | 0 | 400 | sentence | Default prose, descriptions |
| body-sm | 12 / 18 | 0 | 400 | sentence | Table cells, secondary copy |
| label | 10 / 12 | **+0.16em** | 600 | UPPERCASE | Kickers, column heads, panel eyebrows |
| micro | 11 / 16 | +0.01em | 500 | sentence | Timestamps, helper text, badge text |
| numeric | 12 / 16 | −0.01em | 450 | — | Table money, p(win), ratios |
| numeric-lg | 22 / 26 | −0.02em | 500 | — | KPI tiles, EV totals |
| numeric-xl | 32 / 36 | −0.03em | 500 | — | Sandbox headline EV, exposure total |

**Numeric rules.**
- `font-variant-numeric: tabular-nums` + `font-feature-settings: "tnum" 1` on every figure that shares a column, plus `font-family: var(--font-mono)`. If Geist Sans ever fails to expose `tnum`, the mono stack is the fallback — never proportional digits in a table.
- Money: `Intl.NumberFormat("en-US", {style:"currency", currency:"USD", minimumFractionDigits:2, maximumFractionDigits:2})` → `-$1,234.50`. Negative uses the typographic minus from the formatter, not parentheses, not red alone.
- EV deltas always carry an explicit sign (`+$12.00` / `-$65.34`); raw EV totals never do (they are costs).
- Percentages: 1 decimal, `69.2%`. p(win) is shown as a percentage in tables and as a 0–1 decimal only inside the derivation panel, where the weights sum visibly (0.10 + 0.15 + 0.12 + 0.18 + 0.15 − … ). Never mix the two in one column.
- Right-align money, p(win), ratios and counts — *including the header cell*. Left-align ids, stages, reasons. Never centre a number in a table.
- Hashes/ids: mono, first 8 + `…` + last 4 (`a91f3c02…7de1`), full value on hover title and copy. Latency reads `312ms`; timestamps read `6 Nov 2026, 14:03` (24h, no seconds except the step log).

---

## 5. Spacing, grid and layout

**Scale** — 4px base: `4 8 12 16 20 24 32 40 48 64`. Only 2px (icon nudges) and 6px (label→field, icon→text) may sit off-scale, and only for optical reasons. No 10/14/18 anywhere; if a gap looks wrong, change the container, not the scale.

**Shell.** Sidebar 232px fixed ≥1024px, 56px icon rail 768–1023, bottom tab bar <768. Content max-width 1560px. Page gutters 12 / 20 / 28px at <640 / ≥640 / ≥1024. Top bar 56px, sticky.

**Panel anatomy.** Outer radius 10, inner 8, controls 6, chips 4 — a child never has a larger radius than its parent. Header 40px (12px vertical padding, 16px horizontal, label + optional right-side meta + 28px icon buttons); body padding 16 dense / 20 default; footer 44px with a hairline on top only. Elevation is a hex step, never a shadow; the only shadow allowed is `0 8px 24px rgba(0,0,0,0.45)` on `--color-raised` popovers.

**Tables (AG Grid).** Header 34px, body row 44px (36px "compact" for analytics only), cell horizontal padding 10 → 12 for money columns, vertical dividers off, horizontal row border `rgba(255,255,255,0.045)`, row hover `#181D24`, selection `#12251F` + 2px emerald left inset. 25 rows/page (matches `PER_PAGE` in `components/disputes/DisputesWorkspace.tsx`). Header labels 10px/600/+0.16em uppercase muted. Density is a theme param, not a CSS override — see [AG Grid theming params](https://www.ag-grid.com/react-data-grid/theming-compactness/).

**Split screen (judge sandbox).** 46 / 54 at ≥1024px; today's implementation is `0.95fr / 1.05fr` ≈ 47.5/52.5 — keep the 16px gutter and 1px hairline divider, no vertical rule colour. Left panel min-width 420px. Below 1024px it stacks storefront → command center, in that order, with the step log pinned under the storefront. Left panel scrolls independently; the right panel's action rail is sticky to the panel bottom.

**Rhythm.** Between page sections 20; between sibling panels 16; between panel header and body 12; inside forms 12; between label and field 6.

**Breakpoints.** 640 / 768 / 1024 / 1280 / 1536. 1024 is the only structural break (rail collapse, split → stack). 1280 is where the dispute grid gains its EV-breakdown column; 1536 is where the case room gains its right rail.

---

## 6. Data-dense component patterns

| Component | Structure | States | The one thing that makes it feel premium |
|---|---|---|---|
| **KPI tile** | 10px label row + 22px mono value + 11px delta line + optional 24px sparkline, all inside a 1px hairline box with 16px padding | idle · loading (skeleton, same height) · stale (label dot amber + "as of 14:03") · alert (value turns danger, label keeps muted) | The label is *always* the same 10px tracked uppercase — the value is the only thing that changes weight or colour, so scanning 6 tiles is free. |
| **EV waterfall bar** | Horizontal diverging bars from a pinned zero line at 38% width; bar 10px tall, 2px radius, 2px gap; label left of zero, value right, mono | normal · recommended (emerald 1px outline + "RECOMMENDED" chip) · illegal at stage (dashed 1px border, 40% opacity, lock glyph) · over-domain (clip + chevron) | Illegal actions are *shown and disabled*, never omitted. A judge sees what the state machine refused — that is the product's whole thesis. |
| **Signal checklist row** | 20px status glyph + 12px signal name + mono weight (`+0.18`) right-aligned + 11px evidence micro-line | hit (emerald check) · miss (dim dash) · partial (amber half) · unavailable (dashed box, "no telemetry") | The weight column is visible and sums in the footer to the displayed p(win) — the score is auditable on screen, not asserted. |
| **Stage / channel badge** | 20px tall, 4px radius, 12% tint fill, 1px same-hue border at 20%, 10px uppercase tracked text | INQUIRY / CHARGEBACK / PRE_ARBITRATION / RESOLVED × INTERNAL / EXTERNAL; hover shows the legal-action matrix as a tooltip | Stage and channel are two chips, not one compound string — the eye can filter one axis at a time. |
| **Action chip (allowed vs blocked)** | 28px tall, glyph + verb ("Send message", "Make offer", "Provide evidence"), cost suffix in mono (`$0`, `-$29.70`) | allowed (border-strong, ink text) · primary (emerald fill, dark ink) · blocked (no border, dim text, lock glyph, tooltip with the 422 reason) · pending (spinner replaces glyph, label unchanged) · done (check + dim) | Blocked chips keep their full label and show *why* in a tooltip quoting the machine reason (`illegal_dispute_action`), so refusal reads as competence. |
| **Evidence fact row** | 2-column definition list: 11px dim key above 13px value (or mono for ids), 1px row separator | present · missing ("—" + dim "not captured") · copied (key flashes emerald 400ms) · verified-link (external-link glyph) | Missing facts are rendered as `—` with a reason, never blank — the absence of evidence is itself evidence in a dispute. |
| **Chain-hash row** | mono 12px `a91f3c02…7de1` + sequence `#004` + 1px emerald "linked" glyph + 24px copy button | linked · head (no link glyph) · broken (rose, the row and every row after it get a 2px rose left inset) · copied ("Copied" live-region announcement) | The hash is truncated *in the middle*, not the end, so both the prefix and the last 4 chars stay verifiable by eye. |
| **Timeline bar** | Lane = resource (case/merchant), 28px lane height, 20px bar with squared ends, 1px "now" line across all lanes, time axis pinned 28px at top | upcoming (info tint) · due-soon ≤24h (amber) · breached (rose + 1px top hatch) · resolved (dim, 60%) · hover (bar lifts to raised, tooltip with due date + stage) | Bars carry no border and no shadow; only the "now" line is allowed to be a different colour from the bars, so breach state is unambiguous. |
| **Empty state** | 32px Tabler glyph (24-unit viewBox scaled, stroke kept at 2) + 13px line + one action button + 11px hint | first-run (illustrative copy) · filtered-to-zero (offers "Clear filters") · error-adjacent (offers Retry) · no-permission (no action) | Copy names the *next action* ("Run the sandbox to create the first case"), never "No data". |
| **Error banner** | 1px rose border at 30% + 12% rose tint, 20px alert glyph, 13px message, mono `request_id` at 11px, dismiss + one retry | inline (inside panel) · page-level (top of content) · toast (bottom-right, 8s) · fatal (full-panel, keeps nav usable) | It always shows the `request_id` in mono — a judge sees engineering discipline in the failure path, which is where demos usually die. |
| **Confirm dialog** | 440px `raised` panel, centred, radius 10 (matches panels, not controls); h3 title, body with the EV consequence line, destructive action right, cancel left, Esc closes | idle · submitting (button spinner, dialog non-dismissable) · failed (inline banner inside dialog, dialog stays open) · irreversible (type-to-confirm for ACCEPT_CLAIM) | The dialog restates the *money* ("Accepting forfeits $99.00; fighting risks $65.34"), so confirmation is an informed decision, not a speed bump. |
| **Skeleton** | Same box model as the real component, `rgba(255,255,255,0.045)` fill, 4px radius, 1.6s shimmer | loading · slow (>3s adds "still loading…" micro line) · replacing (cross-fade 120ms) | Skeletons match final dimensions exactly — zero layout shift when data lands, which is what separates a product from a demo. |

---

## 7. Motion spec

One curve family, three state durations (120 / 180 / 240ms) and two ambient loops. No spring, no bounce, no parallax.

| Trigger | Duration | Easing | Property |
|---|---|---|---|
| Hover / press on any control | 120ms | `cubic-bezier(0.2, 0, 0, 1)` | background-color, border-color (never transform scale) |
| Row hover / selection | 120ms | same | background-color only |
| Panel / popover enter | 180ms | `cubic-bezier(0.2, 0, 0, 1)` | opacity 0→1, translateY 4px→0 |
| Popover exit | 120ms | `cubic-bezier(0.4, 0, 1, 1)` | opacity only |
| Sandbox step advance (log row appears) | 240ms | `cubic-bezier(0.2, 0, 0, 1)` | opacity + 4px rise, 40ms stagger between rows, max 3 rows |
| EV bar / KPI value update | 180ms | same | bar width only; **digits never tween** |
| Confirm dialog | 180ms in / 120ms out | same | opacity + 2px rise |
| Live dot pulse | 2400ms loop | `ease-out` | box-shadow ring only |
| Skeleton shimmer | 1600ms loop | `ease-in-out` | background-position |

**Never animate:** numeric values (no count-up, no digit roll — see Ramp), table row reorder, column widths, page transitions, chart axes, the EV number when polling refreshes (values swap in place; a 120ms colour flash may confirm the change but the glyph does not move), and anything on an interval under 1s.

**Reduced motion.** `@media (prefers-reduced-motion: reduce)`: all transitions ≤1ms, shimmer replaced by a static 6% fill, live dot becomes a static emerald dot, step-log rows appear without stagger, popovers appear without translate. No information may exist *only* in an animation.

---

## 8. Chart and data-viz rules

**Palette assignment.** One meaning per hue, product-wide: emerald = fought/won or preserved; amber = open decision or fee; rose = at-risk/lost; info sky = neutral/system; `#B0B4BA` (Radix step-11 neutral, verified) = "everything else" series. Cap at 5 series; a 6th becomes "Other".

**Colour-blind safety.** These four hues are not distinguishable by hue alone under deuteranopia. Therefore: (a) every series also carries a direct text label or a glyph; (b) series are ordered by relative luminance — amber/sky ≈ 0.58, emerald 0.50, rose 0.34 — so the greyscale print still separates; (c) forbidden: emerald next to rose in a stacked bar without a 2px gap and a label; (d) run one deuteranopia check on the analytics canvas before sign-off.

**Grid and axes.** Horizontal gridlines only, 1px `rgba(255,255,255,0.04)`, no vertical grid. Zero line 1px `#5A6B7F` (3.39:1 on panel — visible without competing with data). Axis labels 10px mono muted, never rotated, max 6 ticks. No chart borders, no background fills behind the plot, no 3D, no dual y-axes, no gradients under lines.

**Bars vs sparkline.** Bars when the comparison *is* the point (EV fight/settle/offer, fee-cliff before/after); sparkline when direction is the point and the exact value is shown elsewhere (7-day exposure trend in a KPI tile). Never both for the same series. Bars 10px thick, 2px radius, 2px gap; horizontal for anything with dollar labels longer than 4 characters.

**Labels.** Value labels sit at the bar end, mono, 11px, in ink — not inside the bar (dark bars make text unreadable); category labels left-aligned at the zero line; never a legend for ≤3 series, use direct labels.

**Numbers the demo must visualise (all from the frozen EV spec, recomputed here):**

| Case | Stage / reason | A | p(win) | EV fight | EV settle | EV offer | Decision |
|---|---|---|---|---|---|---|---|
| A | INQUIRY / SNAD | $99 | 0.69 | −$65.34 | −$99.00 | −$29.70 | DEFLECT (free) — offer is the fallback bar |
| B | CHARGEBACK / INR, high-volume (S=250, D=3), crosses 1.5% | $25 | 0.42 | −$105.40 | −$40.00 | −$7.50 | ACCEPT_CLAIM; the money shot: the $30 fee is never refunded, so a *won* $25 claim still nets −$5 |
| C | CHARGEBACK / INR | $299 | 0.81 | −$89.66 | −$314.00 | −$89.70 | PROVIDE_EVIDENCE — offer sits $0.04 from fight, so it never wins the comparison |

- p(win) axis 0–1 with bands: 0–0.35 weak, 0.35–0.55 coin-flip, 0.55–0.75 likely, 0.75–1 strong (band tints at 6%, labels only).
- Fee cliff: S=250, D=3 → ratio_before 1.2%, ratio_after 1.6%, threshold 1.5%, penalty $90 (3 × $30, i.e. three future $30 fees). Render as three markers on a 0–2.0% track with the threshold as a 1px amber rule and the penalty as a jumped bar, not a tooltip.
- Amount axis $0–$300, ticks $0/$75/$150/$225/$300, covering the $25–$299 demo range.
- If the cheapest bar is illegal at the current stage (case B, offer), keep it visible and dashed — never silently drop it.
- Bar labels are shown to the cent, never rounded to whole dollars: case C's decision turns on $0.04, and a rounded axis would render fight and offer identical.

---

## 9. Accessibility checklist

- **Focus order, split screen.** Skip link → sidebar → storefront (3 step buttons in order) → step log → command center header → case summary → action rail. The right panel never steals focus when polling updates; only a user action moves focus, and after an action focus returns to the action that was pressed.
- **Live regions.** Sandbox step log is `role="log"` + `aria-live="polite"` (already in `StepLog`), one announcement per step, max ~2 sentences, no repeated re-announcement on poll. Errors use `role="alert"` (assertive) exactly once per occurrence. Copy-hash confirmation posts "Chain hash copied" to a polite region — never a toast alone.
- **Table keyboard nav (AG Grid).** Tab enters the grid once; arrows move cells; `Enter` opens the case room; `Esc` returns focus to the grid; `Home/End` row ends; `Ctrl+Home` first cell. No focus trap, no roving-tabindex escape hatch that requires a mouse. Row actions are reachable without opening a cell editor.
- **Target size.** 24×24 CSS px minimum for every pointer target ([WCAG 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)); icon buttons are 28×28 with 6px gaps, table row actions 24×24 with 8px gaps.
- **Contrast.** All text tokens ≥4.5:1 on their actual surface (table above: lowest is dim at 4.96:1). Non-text boundaries for inputs use `border-strong` (3.39:1), not the hairline. Chart gridlines are decorative and must never be the only way to read a value.
- **Focus appearance.** 2px `#A7B6C6` ring, 2px offset, on every interactive element including grid cells and chips; visible against panel, raised and chrome ([2.4.13](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)).
- **Reduced motion.** Honoured globally; the "live" pulse and skeleton shimmer degrade to static, and no status becomes ambiguous when they do.
- **Colour is never alone.** Every emerald/amber/rose state also has a word ("valid", "due in 6h", "breached") or a glyph; the chain-broken state adds a rose inset bar, not just colour.
- **Zoom / reflow.** 200% at 1280px must not clip the EV table — money columns may wrap to two lines before they truncate; never truncate a dollar value.
- **Screen-reader names.** Badges announce "Stage: Chargeback, Channel: Internal"; the EV bar chart has an adjacent `<table>` alternative or an `aria-label` with all three values; hash rows announce the full hash, not the truncated string.
- **Errors.** Every error surfaces `code` + human message + `request_id`, and the retry action is keyboard-reachable; no error is only a colour change.

---

## 10. Anti-patterns

1. **Purple/indigo gradients anywhere** — the single fastest way to read as a generic AI-generated dashboard; this palette has no purple, and "AI product" is not the brand.
2. **Glassmorphism / backdrop blur panels** — blur destroys the flat-plane hierarchy and makes 12px text shimmer over moving content; depth is a hex step.
3. **Equal-weight KPI soup** (six identical cards with no hierarchy) — judges cannot tell which number matters; one tile is the headline (numeric-xl), the rest are secondary.
4. **Colour-only status** (green/red dots, no word) — fails 1.4.1 and fails a projector; every state carries text or a glyph.
5. **Animated counters and digit rolls** — implies the number is still settling; in a dispute console, a moving EV reads as an estimate, not a verdict.
6. **Modals for everything** (confirm on every action, stacked dialogs) — the sandbox is a 3-click narrative; a dialog on click 2 breaks the story. Confirm only irreversible or money-moving actions.
7. **Full-bleed charts with no baseline or axis** — decorative area charts imply trend with no scale; every chart here is comparative and must carry a zero line and values.
8. **Hairline + radius + shadow applied to every container** ("card-ification") — when everything is a card, nothing is a decision. Only decision containers get the 10px panel; data rows are separated by 1px lines inside one panel.

---

## 11. Screenshot composition per page

**/ — Judge sandbox (split screen).** *First 2s:* two opaque panels, left a storefront with three numbered step buttons, right a live case with a big mono EV and an emerald "SIMULATOR" chip — the eye reads "buyer left, merchant right" before reading a word. *Above the fold:* both panel headers, all three step buttons, the step log's first two rows, the recommended action chip. *Focal element:* the right panel's **recommended-action chip with its dollar consequence** ("Send message · $0 fee").

**/disputes — Triage queue.** *First 2s:* four KPI tiles on top, then a 25-row grid with right-aligned mono EV columns and coloured stage chips receding into a regular rhythm. *Above the fold:* tile row + 8–10 grid rows + the filter/search row + pagination meta. *Focal element:* the grid's **EV column**, read as a vertical ladder of negatives — default sort is due date ascending, so the EV ladder sits inside a deadline order rather than replacing it.

**/disputes/[id] — Case room.** *First 2s:* a three-band composition — case header with stage/channel chips, EV waterfall with one recommended bar outlined, evidence checklist below — and a persistent action rail on the right. *Above the fold:* header, full waterfall (3–4 bars), p(win) with its signal sum, the action rail with allow/blocked chips. *Focal element:* the **EV waterfall's recommended bar**, the only outlined shape on the page.

**/timeline — SLA command board.** *First 2s:* horizontal lanes with thin bars and one vertical "now" line, amber/rose bars clustered near it — a wall of deadlines, not a Gantt chart. *Above the fold:* 5–7 lanes, the time axis, the zoom segmented control, the "next breach in 4h 12m" callout. *Focal element:* the **"now" line and the nearest breached bar**, the only rose object in the viewport.

**/analytics — Exposure canvas.** *First 2s:* a large dark plot area with one amber threshold rule and three labelled bars, plus a compact AG Grid below — the fee cliff is legible as geometry. *Above the fold:* the cliff chart, exposure total (numeric-xl), win-rate trend sparkline, the analytics grid's first rows. *Focal element:* the **1.5% threshold rule with the jumped penalty bar** crossing it.

**/settings — Connection.** *First 2s:* a short, calm page: gateway mode card with a large SIMULATOR/LIVE word, health rows, webhook status — the visual opposite of the dense pages, which is the point. *Above the fold:* gateway mode + API base URL + last webhook + version. *Focal element:* the **gateway mode word**, set at display size with the mode-appropriate tone (amber for simulator).
