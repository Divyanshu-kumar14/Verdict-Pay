# VerdictPay — Design Philosophy

> **Forensic Instrument.** The interface is not a SaaS dashboard. It is a precision
> instrument in a sealed evidence room: calibrated, machined, and readable under load.

Derived from the subject. VerdictPay adjudicates PayPal disputes using cryptographic
evidence and deterministic pricing. The product's own words are *chain of custody*,
*locked fact pack*, *verdict*, *exposure*. The visuals follow those words rather than
the statistical centre of the web (centred headline, soft gradient, three icon cards).

---

## 1. The three laws

**1. Depth is optical, not decorative.**
Glass means *sealed / under inspection*. It appears in exactly three places: the hero
statement, the evidence pane, and the live verdict. Everywhere else depth is a
luminance step between `--color-abyss → --color-void → --color-panel → --color-raised`.
Stacking blur on every panel is the single loudest tell of generated UI.

**2. One hue, one meaning.**
`emerald` = value protected. `amber` = a decision is still open. `rose` = money at
risk. `ice` = the instrument itself — calibration marks, beams, measured rules, never
a status. A colour that carries no meaning is removed, not toned down.

**3. Motion has mass.**
Springs (`motion`), never linear easing on anything the user perceives as physical.
Motion exists to confirm state: a number resolving, a beam travelling along the
custody path, a panel settling. Nothing loops for decoration. Everything is disabled
under `prefers-reduced-motion`.

---

## 2. Typography

Two families, strictly separated by job:

| Face | Job | Treatment |
|---|---|---|
| **Geist Sans** | Statements and prose | `--text-display` 44px / `--text-hero` 32px, letter-spacing `-0.03em`, weight 500–600 |
| **Geist Mono** | Evidence: hashes, ids, money, timestamps | `tnum` tabular figures always, so columns never wobble |

Labels are `10px`, uppercase, `0.18em` tracking, in `--color-dim`. This is the
machined seam that makes dense data readable. Never sentence case for a label.

---

## 3. Composition rules

- **One display statement per view.** A second one halves the weight of the first.
- **The rule carries information.** `FieldLabel rule` draws a hairline from a bright
  ice origin point across the panel, tying label to value.
- **Calibration substrate.** `instrument-grid` (56px) sits *under* glass and *behind*
  hero content only. It reads as graph paper, not as a pattern.
- **Grain.** A 0.28-opacity fractal overlay on large dark fields, so black has
  texture instead of banding.
- **Numbers are the hero.** Money and probabilities are the largest type on any data
  card. Prose never outranks a measurement.

---

## 4. Component grammar

| Primitive | Meaning | Where |
|---|---|---|
| `LiquidGlass` | sealed / under inspection | hero verdict, evidence pack, live case summary |
| `SpotlightCard` | dense, repeated, scannable | queue rows, metric tiles |
| `AnimatedBeam` | evidence in transit | custody path ledger → dispute → PayPal |
| `ShaderBackdrop` | living depth | hero only, never behind data |
| `NumberTicker` | a value resolving | headline metrics only |
| `Reveal` / `Stagger` | a section settling | one per section |
| `FieldLabel` | measured structure | above every measured value |

---

## 5. Anti-patterns (banned)

1. Purple/indigo gradient washes.
2. Glassmorphism on every surface.
3. Emoji in UI chrome.
4. Icon in a tinted rounded square as the only content of a card.
5. Centred hero over a soft gradient with three feature cards.
6. Colour as the only signal — every hue is paired with an icon or a word.
7. Looping decorative animation with no state meaning.
8. Charts in default library colours.
9. Invented vanity metrics; every number on screen is served by the API.
10. Two display statements competing in one viewport.

---

## 6. Non-negotiables

- Contrast ≥ 4.5:1 for text, ≥ 3:1 for control boundaries. The 7% hairline is never
  the only affordance.
- Focus ring is steel `#a7b6c6`, 2px, 2px offset — never emerald, which means "won".
- Numerals tabular; money right-aligned; strings of money never jitter.
- `prefers-reduced-motion` disables every entrance, ticker and shader.
- No new runtime dependency without a named reason in the commit.
