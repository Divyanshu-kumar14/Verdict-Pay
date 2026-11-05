# VerdictPay — Merchant Command Center

The judge-facing frontend for VerdictPay: a dark financial control room that turns a
$99 PayPal friendly-fraud dispute into a priced, containment-aware, defensible response
in under 60 seconds.

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 (CSS-first
`@theme`) · AG Grid Community · zod · lucide-react. No other UI kit, no framer-motion,
no state library.

---

## Quickstart

From the repository root:

```bash
# 1. API (simulator mode — no PayPal keys)
make api            # http://localhost:8000
make seed           # optional: demo merchant + CE 3.0 history

# 2. Web
pnpm -C frontend install
pnpm -C frontend dev     # http://localhost:3000
```

The app points at `http://localhost:8000` and sends the demo API key as `X-API-Key`.

### Environment

```bash
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000   # default
NEXT_PUBLIC_VERDICTPAY_API_KEY=vp_demo_sk_local  # default
```

Both are build-time `NEXT_PUBLIC_*` values. See `.env.example`.

> **Demo-only public key.** `NEXT_PUBLIC_VERDICTPAY_API_KEY` is compiled into the browser
> bundle by design so a judge can run the demo with zero setup. It authorises a single
> demo merchant against the deterministic simulator. For any deployment that holds real
> merchant funds, rotate the key server-side and never expose it to the client.

---

## Pages

| Route | Surface | What it proves |
|---|---|---|
| `/` | Judge sandbox | Three buyer actions on the left, the merchant case on the right, live from the API: containment latency, EV fight/settle/offer, recommendation, four chained telemetry events, one-click HATEOAS action. |
| `/disputes` | Triage queue | AG Grid Community queue with right-aligned mono EV columns, mini p(win) bars, stage/reason/channel chips, relative due dates with absolute tooltips, default sort by seller deadline, dossier indicator. |
| `/disputes/[id]` | Case room | EV waterfall with fee annotations and blocked-at-stage paths shown dashed; six win-probability signals with deltas; frozen fact pack; action rail with confirm dialog and `allowed_actions`-driven disabled states; PDF dossier preview and download. |
| `/timeline` | SLA command board | 14-day forward window, one lane per open case, bars from now to `seller_response_due_date`, urgency colours, overdue-first ordering. CSS grid/SVG — no scheduler runtime. |
| `/analytics` | Exposure canvas | KPI tiles, cases-by-recommendation SVG bar chart, rolling dispute ratio vs the 1.5% fee cliff, compact AG Grid snapshot. |
| `/settings` | Connection | Gateway/LLM/database modes, live health check, signed-webhook notes, API map, explicit "Simulator mode — no PayPal credentials required" callout. |

Below 1024px the split screen stacks storefront → command center; dense grids scroll
horizontally instead of squashing.

---

## Architecture

```
app/                server shells + one client workspace per route
components/
  ui/               hand-built primitives (Panel, Badge, Button, ErrorBanner, …)
  sandbox/          Storefront, StepLog, CommandCenter, SandboxWorkspace
  disputes/         AG Grid queue, case room panels, action rail, dossier
  timeline/         SLA board
  analytics/        charts, KPI canvas
  settings/         connection surface
lib/
  api.ts            the only network module: typed request<T>(), ApiError, blob fetch
  types.ts          zod mirrors of backend/app/api/schemas.py (FROZEN contract)
  format.ts         money / probability / hash / deadline formatting (pure)
  ev.ts             EV annotations shared by the command center and case room
  vocab.ts          one badge vocabulary for every state
  hooks/            usePolledQuery, useSandboxFlow, useNow
```

**Contract discipline.** Every response is parsed with zod. Money arrives as JSON strings
(`"99.00"`) and is coerced exactly once at the boundary; `any` is disallowed by ESLint and
`tsc` strict mode. A drifted payload becomes an `ApiError` with code `invalid_response`
instead of a broken render. Failures always surface code + message + `request_id`.

**Polling.** One primitive (`usePolledQuery`) guarantees a single in-flight request,
pauses while the tab is hidden, aborts on unmount and on manual refresh, and only polls
the routes that need it (2s for live queues and the case, 5s for analytics snapshots,
15–20s for health).

**Simulator first.** The UI is coded against the real simulator API. No PayPal calls,
mocks or fixtures are embedded in the frontend; the demo path is the tested backend path.

---

## Design system

Tokens are mapped into Tailwind v4 `@theme` from `design/tokens.css` and the design brief:

- Surfaces: `#080B0F` void → `#0E141B` panel → `#121A23` raised → `#0B1117` chrome.
- Weight `#E6EDF3` / `#8B98A5` / `#74869B`; accents emerald `#34D399` (preserved),
  amber `#FBBF24` (open decision / fee), rose `#FB7185` (money at risk), sky `#7DD3FC`
  (system facts).
- Focus ring is steel `#A7B6C6`, never emerald: emerald means "value preserved", and a
  green focus ring would read as a successful outcome.
- One-pixel hairlines `rgba(255,255,255,0.07)`; control boundaries use
  `#5A6B7F` (3.39:1) so a control edge is never conveyed by the 1.19:1 hairline alone.
- Geist Sans for UI, Geist Mono for ids/hashes/money/EV; `tabular-nums` everywhere.
- Reduced motion is honoured globally; the live dot becomes static, the skeleton shimmer
  is suppressed, and no information exists only in an animation.
- Every async surface has a skeleton, an empty state that names the next action, and an
  error banner with code + message + request id.

Brand assets live in `public/` (`logo-mark.svg`, `logo-lockup.svg`, `og-image.svg`) and
`app/icon.svg` is the favicon. The sidebar mark is inlined so it inherits `currentColor`.

**AG Grid is Community only.** No enterprise modules are registered. Theming uses the v34
Theming API (`themeQuartz.withParams`); no global AG Grid CSS import is required.

---

## Verification

```bash
cd frontend
pnpm install
pnpm lint       # eslint, max warnings 0, no-console, no any, no non-null assertions
pnpm typecheck  # tsc --noEmit
pnpm build      # next build (ESLint + type checking enabled)
pnpm format     # prettier
```

The frontend intentionally has no runtime dependency on PayPal credentials. If the API is
down, every page stays navigable and explains the failure with its request id.

## Honest limitations

- The SLA board is a custom CSS grid renderer over a Bryntum-shaped resource/event model.
  Bryntum is commercially licensed; it is not bundled, emulated or faked. The swap path is
  documented in the root `docs/`.
- AG Studio is not publicly installable, so the analytics canvas is AG Grid Community plus
  a hand-built SVG chart.
- The demo API key is public (see above). It is safe for this simulator demo only.