# 🛡️ VerdictPay

**Pre-dispute telemetry + autonomous PayPal inquiry deflection and claim defense for SaaS, digital goods and metered AI apps.**

VerdictPay turns a merchant's own product telemetry into a cryptographically chained **system of record**, prices every PayPal dispute with a **deterministic expected-value model**, and takes the **cheapest correct action** through PayPal's HATEOAS dispute state machine — before the $15/$30 dispute fee attaches.

```
Judge sandbox (left)                         Merchant command center (right)
buyer checkout  →  usage  →  dispute   →     webhook → containment → EV triage → action
```

**The whole demo runs with zero PayPal credentials.** The simulator is not a mock in the test
suite — it is the gateway the demo itself uses, and the E2E script asserts every number on screen.

---

## ⚡ 60-second judge quickstart

### Option A — one command, no keys

```bash
git clone <repo> && cd verdict-pay
make install          # uv sync + pnpm install

# terminal 1 — seeds the DB, boots the API, asserts the whole flow, keeps the API up
make stack

# terminal 2 — the command center
make web              # → http://localhost:3000
```

`make stack` prints a green assertion for every step of the three-button flow, then leaves the
API running so the UI can talk to it. Want a one-shot proof without a server left behind?
`make demo` runs the same 26 assertions and exits. Both use the deterministic PayPal simulator,
SQLite and the template narrative generator — no network, no keys.

### Option B — Docker

```bash
cp .env.example .env      # defaults already work
docker compose up --build
# frontend http://localhost:3000 · API http://localhost:8000/docs
```

### Option C — manual

```bash
# backend
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000

# frontend (new terminal)
cd frontend && pnpm install && pnpm dev
```

Open **http://localhost:3000** and use the three buttons on the left.

---

## 🚨 Why this exists

PayPal's January 2026 Seller Protection rules leave digital merchants exposed:

| Blind spot | What it costs |
|---|---|
| **SNAD is excluded** from seller protection | a checkout receipt cannot prove a SaaS product was consumed |
| **INR / UNAUTHORIZED need a system of record** | PayPal requires IP, device, delivery time and access proof |
| **Card-funded chargebacks (EXTERNAL)** follow Visa CE 3.0 | you need 2+ prior undisputed transactions sharing IP/device |
| **$15 standard / $30 high-volume fees** | fighting a $25 claim and *winning* can lose **-$5 net** |
| **Subscription bleed** | a chargeback left on an active subscription becomes a second chargeback in 30 days |

VerdictPay closes all five with one pipeline.

---

## 💡 How it works

1. **Telemetry SDK** (`@verdictpay/sdk`) records four signed lifecycle events keyed to the PayPal
   `payer_id` / `order_id`: ToS acceptance (with SHA-256 of the ToS text), authenticated session
   (IP, ASN, device), digital delivery (resource + SHA-256), metered usage (tokens/API units).
2. **Append-only hash chain** — every event is linked as
   `chain_hash = sha256(prev_hash : event_type : payer_id : created_at : payload_hash)`
   per customer stream. A single mutated row is reported at its exact sequence number.
3. **Ingestion + containment** — the PayPal webhook (or the sandbox button) opens the case and
   suspends the recurring subscription within the 500 ms budget, isolated so a PayPal failure
   never blocks triage.
4. **Deterministic HATEOAS triage** — the returned `links[]` plus the lifecycle stage decide which
   actions are even legal; then the EV engine prices fight vs. settle vs. offer. No LLM touches a
   number.
5. **Action** — free inquiry deflection (`send-message`), a calculated `make-offer`, an
   `accept-claim`, or an evidence dossier uploaded via `multipart/related`.

### The EV model (deterministic, auditable)

```
ratio_before  = D / max(S, 1)                 S = 3-month sales, D = 3-month disputes
ratio_after   = (D + 1) / max(S, 1)
high_volume   = S >= 100 and ratio_after >= 0.015
crosses_cliff = high_volume and ratio_before < 0.015 <= ratio_after

ev_fight  = p * (-30) + (1 - p) * (-A - 15 - 30 - penalty)   # 30 is never refunded
ev_settle = -(A + 15)  if a claim fee has attached, else -A
ev_offer  = -(0.30 * A)
```

`p(win)` is scored from six evidence signals (ToS hash, IP match, delivery receipt, metered usage,
chain integrity, Visa CE 3.0 history) with reason-specific multipliers — all constants live in
`backend/app/domain/disputes/` and are covered by exact-value unit tests.

### The air-gap

Deterministic code builds an **immutable fact pack** from the ledger and the PayPal reporting API.
Only then may a narrative layer write prose, and its output is validated against the fact pack
(any number not present in the facts is rejected). **ReportLab** renders the PDF. Facts are never
model-generated.

---

## 🧱 Repository layout

```
verdict-pay/
├── backend/                FastAPI · async SQLAlchemy · simulator-first PayPal gateway
│   ├── app/domain/         telemetry chain · disputes (EV, state machine) · evidence (PDF, multipart)
│   ├── app/integrations/   paypal (simulator + live) · llm · search (optional Elastic)
│   ├── app/api/            routers + FROZEN schemas.py contract
│   ├── scripts/            init_db · seed_demo · e2e_demo · run_demo
│   └── tests/              unit (pure domain) + integration (real simulator)
├── frontend/               Next.js 15 · Tailwind 4 · AG Grid Community · judge sandbox
├── packages/verdictpay-sdk TypeScript SDK (@verdictpay/sdk)
├── postman/                collection + local environment
└── docs/                   demo script · architecture · sponsor mapping · ADRs
```

---

## 🔌 API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/health` | status, gateway mode, version |
| POST | `/api/v1/telemetry/events` | ingest single/batch signed events (API key) |
| GET | `/api/v1/telemetry/chain/{payer_id}/verify` | recompute the hash chain |
| GET | `/api/v1/customers/{payer_id}/timeline` | ordered events + aggregates + chain proof |
| POST | `/api/v1/sandbox/checkout` | Orders v2 checkout (simulator) |
| POST | `/api/v1/sandbox/usage` | 4 chained telemetry events |
| POST | `/api/v1/sandbox/dispute` | open a dispute through the real webhook path |
| POST | `/api/v1/webhooks/paypal` | signature-verified, replay-safe ingest |
| GET | `/api/v1/disputes` | paginated triage queue |
| GET | `/api/v1/disputes/{id}` | case room: EV, signals, facts, allowed actions |
| POST | `/api/v1/disputes/{id}/triage` | recompute the decision |
| POST | `/api/v1/disputes/{id}/actions/{action}` | SEND_MESSAGE / MAKE_OFFER / ACCEPT_CLAIM / PROVIDE_EVIDENCE |
| GET | `/api/v1/disputes/{id}/dossier.pdf` | seller-protection dossier |
| GET | `/api/v1/reporting/summary` | exposure, fees avoided, win rate, high-volume status |

Errors always use one envelope:

```json
{"error": {"code": "illegal_dispute_action", "message": "...", "details": [], "request_id": "..."}}
```

---

## 🔐 Security model

- **SDK → API**: API key + HMAC-SHA256 over `<timestamp>.<body>`, ±300 s window, replay guard.
- **PayPal → API**: PayPal `verify-webhook-signature` in live mode, HMAC in simulator mode;
  unsigned traffic is rejected unless explicitly enabled in `local`.
- Secrets come from the environment only, are redacted from logs, and the app **refuses to boot in
  production with the documented dev defaults**.
- Ingestion is capped (256 KB body, 500 events/batch) and rate-limited per merchant.
- The dossier contains only facts PayPal already holds, and a test asserts the API key never
  appears in the rendered PDF.

---

## 🚦 Gateway modes

| `PAYPAL_MODE` | Behaviour |
|---|---|
| `simulator` (default) | deterministic in-memory PayPal: orders, disputes, HATEOAS links, offers, evidence, suspension, CE 3.0 history, signed webhooks. Persisted cases rehydrate the simulator on restart. |
| `live` | real PayPal REST calls: OAuth token cache, retries with idempotency, Disputes v1, Subscriptions v1, Reporting v1, webhook verification, `multipart/related` evidence upload. Requires `PAYPAL_CLIENT_ID`/`SECRET`. |

The domain never imports httpx — both implementations satisfy the same `PayPalGateway` protocol.

---

## ✅ Verification

```bash
make verify      # ruff + pytest + eslint + tsc + next build + sdk vitest + E2E demo
make demo        # the 60-second judge flow alone (26 assertions, green/red)
```

Individual gates:

```bash
make test        # backend unit + integration
make lint        # ruff + eslint
make typecheck   # tsc --noEmit (frontend + SDK)
make e2e         # three-button flow against a running API
```

---

## 🏆 Sponsor tooling — honest mapping

| Tool | What is actually implemented |
|---|---|
| **PayPal** | Disputes v1 (get, list, send-message, make-offer, accept-claim, provide-evidence, require-evidence), Subscriptions v1 suspend, Orders v2, Reporting v1 transactions, webhook signature verification. Live client + protocol-identical simulator. |
| **AG Grid** | Community grid powers the triage queue, analytics table, custom badges/EV cells, sorting, filtering. |
| **APIMatic** | The PayPal integration is modelled on the official PayPal OpenAPI schema; request/response models are validated by Pydantic and documented in `backend/app/integrations/paypal/`. |
| **Elastic** | A complete optional `SearchIndex` adapter (`ELASTIC_URL`) that indexes NDJSON via `_bulk`, with a no-op default. SQL is authoritative and the judge demo never requires it; the adapter is selected at startup and is intended as a drop-in integration point rather than an active mirror. |
| **Postman** | `postman/` collection + environment covering telemetry, webhook, dispute and evidence calls. |
| **Render** | `render.yaml` blueprint for api + web with health checks. |
| **Bryntum / AG Studio** | Not licensed for redistribution. The SLA board uses a **Bryntum-shaped events/resources model** (swap documented in `docs/sponsors.md`), and the analytics canvas is built on AG Grid Community. We say this instead of faking a license. |

---

## ⚠️ Known limitations

- The demo is single-merchant; production would derive the merchant from the API key (the schema
  already carries `merchant_id` everywhere).
- SQLite is the default store. Postgres works through `DATABASE_URL` but is not shipped as a
  managed migration.
- PPE/agentic flows beyond the dispute lifecycle (refunds, pre-arbitration filings) are out of scope.
- The simulator's in-memory state is rebuilt from the database at startup; multi-worker deployments
  should use the live gateway.

---

## 📄 License

MIT — see [LICENSE](./LICENSE).
