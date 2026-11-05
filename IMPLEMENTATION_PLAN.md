# VerdictPay — Phase-Wise Implementation Plan

**Hackathon build plan for the pre-dispute telemetry SDK + autonomous PayPal inquiry-deflection and claim-defense engine.**

Status: living document · Owner: Team Lead · Quality bar: zero known bugs, deterministic core, demo runs with **no external keys required**.

---

## 0. Mission and judge contract

A judge opens the app, clicks **three buttons on the left**, and watches a **PayPal dispute get deflected or defended on the right** — in under 60 seconds, on a laptop, with **no PayPal account, no Elastic cluster, no Supabase project, no LLM key**.

> VerdictPay turns a merchant's own product telemetry into a cryptographically chained **system of record**, prices every dispute with a **deterministic EV model**, and takes the **cheapest correct PayPal action** through a HATEOAS state machine.

### The three-button demo (the contract we build to)

| Step | Buyer side (left) | Merchant side (right) |
|---|---|---|
| 1 | Checkout $99 Pro plan (PayPal Orders v2 / Subscriptions v1) | Case created, payer → order mapped |
| 2 | Burn usage: 42k LLM tokens, 15 logins, ZIP download | 4 signed events land in the hash-chained ledger, chain verified |
| 3 | File "Item Not Received / SNAD" friendly-fraud dispute | Webhook → containment → EV triage → deflection message **or** PDF dossier upload |

**Exit criterion:** one command boots both services, runs the flow end to end, and prints a green assertion per step.

---

## 1. Constraints that shape every decision

| Constraint | Consequence |
|---|---|
| No PayPal sandbox credentials in this environment | Every PayPal call sits behind a **PayPalGateway** protocol with a **deterministic simulator** implementation. The live client is still written and tested against recorded fixtures. |
| Judges run docker compose up or make dev | SQLite by default, zero mandatory infra. Elastic / Supabase / Postgres are **optional adapters**, never required. |
| Bryntum is commercially licensed; AG Studio 3.0 is not publicly installable | Ship a **custom SLA timeline** over a Bryntum-shaped data model, and an **Analytics Canvas** on AG Grid Community. Document the swap path; never fake a license. |
| Legal filings must never hallucinate | Evidence generation is **air-gapped**: deterministic fact pack → optional LLM narrative constrained to locked facts → renderer. No LLM in the number path. |
| "Zero bugs" is a verification claim, not vibes | Merge gate: pytest, ruff, tsc --noEmit, next build, vitest, plus the E2E demo script. |

### Non-goals

- Multi-tenant RBAC / SSO (one demo merchant, one API key).
- Real pre-arbitration filing or Visa CE 3.0 submission to a bank.
- Elastic Cloud deployment; the adapter is exercised against a local fake transport.
- Bryntum / AG Studio proprietary runtimes. Mobile-native client.

---

## 2. Architecture

    FRONTEND (Next.js 15 App Router)
      /                 Judge sandbox: storefront left x command center right
      /disputes         AG Grid triage queue: EV cells, HATEOAS badges, dossier preview
      /disputes/[id]    Case room: EV waterfall, evidence facts, action rail, PDF
      /timeline         SLA command board (Bryntum-shaped resources/events)
      /analytics        Exposure + win-rate canvas (AG Grid Community)
      /settings         Gateway mode (simulator|live), connectivity, webhook health
            |
            | REST + 2s polling, typed zod client
            v
    BACKEND (FastAPI, Python 3.12, async SQLAlchemy)
      api/              routers: telemetry - sandbox - disputes - evidence - webhooks - reporting
      domain/
        telemetry/      canonical JSON -> SHA-256 chain (per payer stream) -> verify
        disputes/       HATEOAS state machine - EV + win probability - triage policy
        evidence/       immutable fact pack -> narrative -> ReportLab PDF -> multipart/related
        subscriptions/  containment circuit breaker
      integrations/
        paypal/         protocol.py - live.py (httpx) - simulator.py - factory.py
        llm/            protocol.py - locked-facts narrative - null provider
        search/         TelemetryIndex protocol - SQL implementation - Elastic adapter (optional)
      db/               SQLAlchemy 2.0 models; SQLite default, Postgres optional

    @verdictpay/sdk (TypeScript): trackCheckout / trackDelivery / trackUsage, batched + retried

### ADR-001 — Simulator-first gateway, not mocks in tests
The PayPal boundary is a Protocol with two real implementations. **SimulatorGateway** powers the demo **and** the E2E tests; **LiveGateway** is selected by PAYPAL_MODE=live. Unit tests never monkeypatch PayPal internals.
*Why:* the demo path is the tested path.

### ADR-002 — SQLite default, Postgres optional
DATABASE_URL defaults to sqlite+aiosqlite:///./verdictpay.db; schema is portable (no vendor types). *Why:* judge friction is the number-one killer.

### ADR-003 — Determinism owns the money, LLM owns the prose
ev.py, win_probability.py and the fact pack are pure, I/O-free functions. The narrative layer receives a read-only Facts object and returns text only. *Why:* an EV number in a legal filing must be reproducible bit-for-bit.

### ADR-004 — Hash chain per payer stream
chain_hash = sha256(prev_hash | event_type | payer_id | created_at | payload_hash), scoped per (merchant_id, payer_id) with sequence unique per stream. *Why:* a global chain serializes ingestion and makes per-customer verification impossible.

---

## 3. Repository layout

    verdict-pay/
    ├── IMPLEMENTATION_PLAN.md
    ├── README.md                      judge-facing quickstart, API map, sponsor notes
    ├── Makefile                       dev / test / demo / verify
    ├── docker-compose.yml             api + web, healthchecks, judge mode
    ├── render.yaml                    3-service blueprint
    ├── .env.example
    ├── backend/
    │   ├── pyproject.toml             uv-managed, Python 3.12
    │   ├── app/{config,main,errors,deps}.py
    │   ├── app/db/{models,session}.py
    │   ├── app/api/schemas.py         FROZEN response contract
    │   ├── app/api/routers/*.py
    │   ├── app/domain/{telemetry,disputes,evidence,subscriptions}/
    │   ├── app/integrations/{paypal,llm,search}/
    │   ├── scripts/seed_demo.py
    │   └── tests/{unit,integration}/
    ├── frontend/                      Next.js 15 + Tailwind 4 + AG Grid Community
    ├── packages/verdictpay-sdk/       TypeScript SDK (tsup + vitest)
    ├── postman/                       collection + local environment
    └── docs/                          ADRs, demo script, sponsor notes

---

## 4. Phase plan

Each phase ends at a **gate** that must be green before the next starts. Gates are commands, not opinions.

### Phase 0 — Foundations and frozen contracts (blocks everything)

**Goal:** one command boots an API returning /health; every shared type is frozen so parallel work cannot diverge.

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 0.1 | Repo skeleton, Makefile, .env.example, .gitignore | root files | make help lists targets |
| 0.2 | Backend package + pyproject (uv, Python 3.12), config, JSON logging, error envelope | app/config.py, app/errors.py | python -c "from app.config import settings" |
| 0.3 | DB schema: merchants, telemetry_ledger, paypal_transactions, dispute_cases, dispute_actions, webhook_events | app/db/models.py | init_db creates 6 tables |
| 0.4 | Frozen enums, gateway/LLM/index protocols, Pydantic response schemas | app/domain/enums.py, app/api/schemas.py | ruff check; imports resolve |
| 0.5 | App factory with routers mounted, CORS, request-id middleware, exception handlers | app/main.py | curl :8000/api/v1/health -> {"status":"ok"} |

**Gate 0:** make api boots; make check (ruff + import check) green.

### Phase 1 — System of record (telemetry + sandbox intake)

**Goal:** the cryptographic ledger exists and the judge storefront can populate it.

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 1.1 | Canonical JSON + SHA-256 chain + append under a per-stream asyncio lock | domain/telemetry/hashing.py, service.py | known-vector hashes; concurrent append keeps sequence monotonic |
| 1.2 | Chain verification that reports the exact broken index | verify_chain() | mutate a row -> valid=false at that index |
| 1.3 | API-key auth + POST /telemetry/events (single + batch), GET /telemetry/chain/{payer}/verify, GET /customers/{payer}/timeline | routers/telemetry.py | 4 events -> chain valid; bad key -> 401 |
| 1.4 | Sandbox storefront: POST /sandbox/checkout, /sandbox/usage, /sandbox/dispute | routers/sandbox.py | 3 calls -> dispute exists with 4 telemetry rows |
| 1.5 | Seed: demo merchant, PayPal payer/order fixtures, 120–365d CE 3.0 history | scripts/seed_demo.py | make seed -> reporting summary non-zero |

**Gate 1:** pytest backend/tests -q green; make seed && make api; chain verify returns valid=true.

### Phase 2 — Adjudication brain (the differentiator)

**Goal:** deterministic EV + a state machine that can never issue an illegal PayPal action.

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 2.1 | PayPalGateway protocol + simulator (disputes, messages, offers, evidence, suspend, transaction search, webhook HMAC, sandbox order/dispute creation) | integrations/paypal/simulator.py | full lifecycle; every call recorded; idempotent on replay |
| 2.2 | Live gateway: OAuth token cache, retries with idempotency, Disputes v1, Subscriptions v1, Reporting v1, verify-webhook-signature | integrations/paypal/live.py | respx fixtures; no live network in CI |
| 2.3 | HATEOAS state machine: capability from links[] + stage/channel; provide-evidence rejected in pure INQUIRY | domain/disputes/state_machine.py | table-driven tests for every stage x channel x action |
| 2.4 | Deterministic win probability from telemetry signals (weights frozen in §6) | domain/disputes/win_probability.py | exact expected floats; missing telemetry lowers score |
| 2.5 | EV engine per §5 + fee-cliff penalty + recommendation with documented tie-breaks | domain/disputes/ev.py, triage.py | $25/mo high-volume -> fighting loses money -> settle path |
| 2.6 | Containment circuit breaker: suspend subscription + merchant hook, < 500ms budget, failure isolated | domain/subscriptions/containment.py | suspend failure does not block triage; latency asserted |
| 2.7 | Dispute service: webhook -> persist -> triage -> persist decision | services/dispute_service.py | webhook -> case row with recommendation |

**Gate 2:** EV + state-machine + triage suites green; coverage on domain/disputes >= 90%.

### Phase 3 — Evidence engine

**Goal:** a seller-protection dossier that passes a real PayPal evidence call, generated without hallucination.

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 3.1 | Immutable fact pack: telemetry rows, chain proof, CE 3.0 matches, ToS hash, delivery + usage aggregates | domain/evidence/facts.py | snapshot equality; facts are frozen dataclasses |
| 3.2 | Reason-aware narrative composer; LLM optional and constrained to facts; deterministic template fallback | domain/evidence/narrative.py | narrative cites only fact values; no key -> template path |
| 3.3 | ReportLab dossier: cover, timeline, chain table, ToS snapshot, usage ledger, CE 3.0 exhibit, signature footer | domain/evidence/pdf.py | %PDF magic; >= 2 pages; pypdf text contains payer_id + chain hash |
| 3.4 | RFC 2387 multipart/related builder: "input" JSON part + "file1" PDF part, exact boundary, byte round-trip | domain/evidence/multipart.py | email.parser round-trip asserts parts, headers, body hash |
| 3.5 | Evidence API: build, upload, persist dossier URL, idempotency header | routers/evidence.py, services/evidence_service.py | POST -> 202; replay same id -> 200, same action id |

**Gate 3:** PDF + multipart suites green; curl dossier returns a valid PDF.

### Phase 4 — Command Center (frontend)

**Goal:** the 60-second demo is visually undeniable and reads from real APIs.

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 4.1 | App shell: dark command-center theme, sidebar nav, connection badge, error + loading states | app/layout.tsx, components/* | next build |
| 4.2 | Judge sandbox split screen: storefront buttons stream step results; live ledger + case panel | / page | build + docs/demo.md script |
| 4.3 | AG Grid triage queue: EV cells, stage/channel badges, HATEOAS action chips, row selection | /disputes | renders seeded cases; sort/filter works |
| 4.4 | Case room: EV waterfall, win-probability breakdown, evidence facts, action rail with confirm, PDF preview | /disputes/[id] | actions call API and update state |
| 4.5 | SLA command board + analytics canvas | /timeline, /analytics | dates render; no NaN |
| 4.6 | API client with zod parsing, 2s polling, optimistic action states | lib/api.ts | tsc --noEmit |

**Gate 4:** pnpm build + tsc --noEmit + eslint green; manual demo run against the seeded API.

### Phase 5 — Hardening, packaging, pitch

| # | Task | Deliverable | Verify |
|---|---|---|---|
| 5.1 | E2E script for the full three-button flow, asserting every promise, plus a boot wrapper | scripts/e2e_demo.py, scripts/run_demo.py | make demo exits 0, prints per-step OK |
| 5.2 | Docker: multi-stage, non-root, healthchecks; one-command compose | backend/Dockerfile, frontend/Dockerfile, docker-compose.yml | docker compose config + build |
| 5.3 | Postman collection + environment (webhook, telemetry, dispute, evidence) | postman/*.json | newman run (optional CI job) |
| 5.4 | TypeScript SDK with batching, retry, HMAC signing + vitest suite | packages/verdictpay-sdk | pnpm test && pnpm build |
| 5.5 | README, ADRs, demo script, sponsor mapping (honest about Bryntum/AG Studio) | root docs | links resolve |
| 5.6 | Hardening: ingestion rate limit, body caps, SSRF-safe config, no secrets in logs, ruff clean | backend | make check |

**Gate 5 (Definition of Done):**

    ruff check backend && pytest backend -q
    pnpm -C frontend lint && pnpm -C frontend typecheck && pnpm -C frontend build
    pnpm -C packages/verdictpay-sdk test && pnpm -C packages/verdictpay-sdk build
    python scripts/e2e_demo.py

---

## 5. Deterministic EV specification (frozen)

Money is Decimal, quantized to cents at the boundary. Inputs: claim amount A, win probability p, high-volume flag, 3-month sales S and disputes D.

Fees: standard Fs = 15 (refunded on win); high-volume Fh = 30 (never refunded, only for high-volume merchants); ratio threshold tau = 0.015.

    ratio_before  = D / max(S, 1)
    ratio_after   = (D + 1) / max(S, 1)
    high_volume   = S >= 100 and ratio_after >= tau     # spec: 100+ sales over 3 months
    crosses_cliff = high_volume and ratio_before < tau <= ratio_after
    penalty_ratio = Fh * 3  if crosses_cliff else 0    # risk of $30 on the next 3 disputes

    ev_fight  =  p * (-Fh) + (1 - p) * (-A - Fs - Fh - penalty_ratio)
    ev_settle = -(A + Fs)  if claim_fee_attached       # CHARGEBACK / PRE_ARBITRATION
                  else -A                           # still INQUIRY: no claim fee yet
    ev_offer  = -(offer_ratio * A)                     # offer_ratio default 0.30

**Recommendation (first match wins)**

| Condition | Action |
|---|---|
| INQUIRY + INTERNAL + completeness >= 0.6 + p >= 0.55 | DEFLECT_INQUIRY (send-message, $0 fee) |
| INQUIRY + make-offer allowed + ev_offer > ev_fight | MAKE_OFFER (settle cheaper than fighting) |
| INQUIRY + send-message allowed | DEFLECT_INQUIRY (free evidence-backed message) |
| CHARGEBACK or PRE_ARBITRATION + ev_fight > ev_settle + p >= 0.35 | PROVIDE_EVIDENCE |
| CHARGEBACK or PRE_ARBITRATION + ev_fight <= ev_settle | ACCEPT_CLAIM |
| otherwise | MONITOR |

Rationale for the INQUIRY rows: every EV is negative in absolute terms, so the comparison must be
**between actions** (offer vs fight), never against zero. An INQUIRY cannot attract the claim fee,
so sending the free evidence message dominates accepting; offering 30% is chosen when fighting is
projected to cost more than the offer.

Tie-break: higher EV wins; then the cheaper-fee action; then the earlier row. Every branch is a unit test.

---

## 6. Win-probability weights (frozen)

p = clamp(0.10 + sum(signals), 0.02, 0.95)

| Signal | Delta |
|---|---|
| ToS accepted, hash matches shown version | +0.15 |
| Session IP matches checkout IP | +0.12 |
| Asset delivered with resource SHA-256 | +0.18 |
| Metered usage > 0 | +0.15 |
| Chain verified intact | +0.10 |
| Visa CE 3.0: >= 2 prior undisputed txns sharing IP/device (120–365d) | +0.20 |

Reason multipliers: INR 1.00, SNAD 0.90, UNAUTHORIZED 0.75. Applied after the sum, before the clamp.

---

## 7. HATEOAS state machine (frozen)

| Stage | send-message | make-offer | accept-claim | provide-evidence |
|---|---|---|---|---|
| INQUIRY / INTERNAL | yes | yes | yes | no (unless PayPal added a require-evidence action) |
| INQUIRY / EXTERNAL | yes | yes | yes | no |
| CHARGEBACK | yes | yes | yes | yes |
| PRE_ARBITRATION | no | no | yes | yes |
| RESOLVED / CLOSED | no | no | no | no |

PayPal's returned links[] is authoritative; our table is the guard that produces a **422 with a machine-readable reason**, never a silent 200.

---

## 8. Data model

Six tables (portable SQL, no vendor types):

1. merchants — id, name, api_key_hash, created_at.
2. telemetry_ledger — append-only; unique (merchant_id, payer_id, sequence) and (merchant_id, event_id); prev_hash, chain_hash, canonical payload JSON, typed IP/device/resource/units columns. ORM before_update/before_delete guards + a service-level test.
3. paypal_transactions — CE 3.0 lookback cache: transaction_id, payer_id, amount, status, IP, device, source, created_at.
4. dispute_cases — dispute id PK, stage/channel/reason/status, amounts, p_win, ev_fight/settle/offer, recommended_action, action_rationale JSON, subscription_suspended, dossier_pdf_url, due_date, facts_snapshot JSON, paypal_links JSON.
5. dispute_actions — audit log: action, status, idempotency key (unique), request/response JSON, latency.
6. webhook_events — event_id unique (replay-safe), type, verified flag, payload, received_at.

---

## 9. API surface (v1)

    GET  /api/v1/health                        -> {status, mode, version}
    POST /api/v1/telemetry/events              -> ingest single|batch (API key)
    GET  /api/v1/telemetry/chain/{payer_id}/verify
    GET  /api/v1/customers/{payer_id}/timeline
    POST /api/v1/sandbox/checkout              -> order + payer + subscription
    POST /api/v1/sandbox/usage                 -> 4 chained events
    POST /api/v1/sandbox/dispute               -> opens INQUIRY through the real webhook path
    POST /api/v1/webhooks/paypal               -> verified ingest, replay-safe
    GET  /api/v1/disputes                      -> paginated triage queue
    GET  /api/v1/disputes/{id}                 -> case + EV breakdown + allowed actions
    POST /api/v1/disputes/{id}/triage          -> recompute
    POST /api/v1/disputes/{id}/actions/{action}
    GET  /api/v1/disputes/{id}/dossier.pdf
    GET  /api/v1/reporting/summary             -> exposure, win rate, fee saved
    GET  /api/v1/reporting/transactions?payer_id=

Error envelope is always {"error": {"code", "message", "details"?, "request_id"}} — no bare 500s, no leaked internals.

---

## 10. Security model

- SDK -> API: X-API-Key + HMAC-SHA256 over the canonical body (X-VerdictPay-Signature, ±300s timestamp window, replay cache on event_id).
- PayPal -> API webhook: PayPal verify-webhook-signature in live mode; HMAC with VERDICTPAY_WEBHOOK_SECRET in simulator mode. Unsigned traffic rejected unless ALLOW_UNSIGNED_WEBHOOKS=true and APP_ENV=local.
- Secrets: environment only, redacted in logs, never in the dossier, never in error responses.
- Evidence PDF: no PII beyond what PayPal already holds; IPs are required by seller protection; a test asserts no API key appears.
- Ingestion: 256 KB body cap, 500 events/request, per-merchant token bucket.

---

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| PayPal live creds absent at demo time | certain | demo blocked | simulator is the default and the tested path |
| multipart/related shape rejected by PayPal | medium | evidence path dead | byte-level round-trip test + APIMatic schema check + fallback flag |
| ReportLab font issues | low | render error | core fonts only, ASCII-first text, PDF test in CI |
| SQLite contention during demo | low | flaky append | WAL, per-stream lock, unique (merchant, payer, seq) |
| Frontend/backend contract drift | medium | broken demo | frozen schemas.py + zod parsing + contract fixture |
| Scope sprawl across seven sponsor surfaces | high | nothing polished | phases gate on the three-button demo; adapters optional |

---

## 12. Definition of Done

- [ ] make demo runs the three-button flow with zero external credentials and exits 0.
- [ ] make verify (ruff, pytest, tsc, next build, vitest, e2e) green from a clean clone.
- [ ] EV, win probability, chain, state machine, multipart and PDF each have unit tests with exact expected values.
- [ ] Every API error maps to a documented envelope; no stack traces leak.
- [ ] README quickstart works verbatim with Node 20+/Python 3.12+/Docker.
- [ ] Sponsor claims are accurate; unimplementable proprietary runtimes are named, not faked.
- [ ] docs/demo.md is a 60-second script anyone can read aloud.

---

## 13. Implementation record (what actually shipped)

Post-implementation review notes, kept because they change how the frozen spec should be read.

### Frozen-spec amendments made during the build

| # | Change | Why |
|---|---|---|
| 1 | **Six** tables, not five: added `paypal_transactions` | Visa CE 3.0 lookbacks and the 3-month sales/dispute ratio need a durable transaction cache; the simulator also exposes the same rows through `synthetic_transactions`. |
| 2 | `RecommendedAction.SEND_MESSAGE` removed | It duplicated `DEFLECT_INQUIRY` and collided with the `DisputeAction` of the same name; a recommendation is not an action. |
| 3 | INQUIRY make-offer branch is `ev_offer > ev_fight`, not `> max(ev_fight, 0)` | Every EV is negative; comparing to zero made the branch unreachable. An INQUIRY cannot attract the claim fee, so send-message dominates accepting. |
| 4 | `ev_settle = -(A + Fs)` only when a claim fee has attached | Accepting during INQUIRY costs the amount, not the amount plus a fee that does not exist yet. |
| 5 | High-volume fee applies only when `high_volume` is true; `crosses_cliff = high_volume and ratio_before < tau <= ratio_after` | The $30 fee is a high-volume-merchant fee; a small merchant never pays it. The penalty only applies to the dispute that crosses the cliff. |
| 6 | `disputes_3mo` counts **prior** disputes (excluding the case under triage) | The EV engine applies its own `D + 1`; counting the current case doubled the increment. |
| 7 | Telemetry ingest **requires** the SDK HMAC signature (`require_signed_telemetry`) | The plan claimed it; the first implementation only checked the API key. |
| 8 | ASGI body cap counts bytes, not just `Content-Length` | A chunked 300 KB upload bypassed the header check. |
| 9 | Per-credential rate limiting middleware added | The plan and README promised a token bucket; `SlidingWindowLimiter` was otherwise dead code. |
| 10 | Simulator hydrates from `dispute_cases` at startup | The simulator is in-memory; without hydration a restart listed cases it could not act on. |
| 11 | Triage state machine: stage matrix is primary; PayPal `links[]` gate only the INQUIRY `require-evidence` trap | Documented deviation. The simulator always returns complete links, so the demo is unaffected; live mode still relies on PayPal rejecting illegal calls. |

### Verification snapshot

| Gate | Result |
|---|---|
| `uv run pytest -q` | 282+ passed, 0 failed |
| `uv run ruff check app tests scripts` | clean |
| `pnpm lint` / `tsc --noEmit` / `next build` | clean, six routes |
| SDK `vitest` | 24 passed |
| `scripts/e2e_demo.py` | 26 assertions passed against a live simulator |
| Adversarial QA | 36 checks; 2 HIGH bugs found (both fixed with regressions) |

### Judge-demo numbers (seeded DB, simulator)

- Seeded queue: 5 disputes (`PP-D-40001..40005`), 215 cached transactions, 200 of them recent sales.
- UI third button files SNAD ($99): p(win) 0.90, EV_fight -$41.40, EV_settle -$99.00, EV_offer -$29.70.
- `make demo` asserts the INR variant: p(win) 0.95, EV_fight -$35.70, dossier 7 KB, 26/26 checks.
- The $30 high-volume fee appears once the rolling ratio crosses 1.5% (third dispute with 200 sales): fee 30.00, penalty 90.00.
