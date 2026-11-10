# VerdictPay — Devpost submission pack

Every claim below points at a file in this repository; numbers come from the frozen model, the
seeded database and the test gates. Placeholders a human must fill are marked `[ADD ...]`.

## 1. Form fields (copy-paste ready)

| Field | Value |
|---|---|
| **Project name** | VerdictPay |
| **Tagline** (104 chars) | Hash-chained product telemetry, deterministic EV triage, and an AI rebuttal that cannot invent a number. |
| **Repo** | https://github.com/Divyanshu-kumar14/Verdict-Pay |
| **Demo video** | [ADD YOUTUBE LINK] |
| **Hosted demo** | https://verdictpay-web.onrender.com — API at https://verdictpay-api.onrender.com (`/api/v1/health`). Both free-plan Docker services are live and auto-deploy from `main`. The free tier sleeps after ~15 min idle: warm the health URL first, then open the app. See [deploy-render.md](deploy-render.md). |
| **License** | MIT, [LICENSE](../LICENSE) — must be visible in the repo About section (see §6) |

**Built with** (only technologies that appear in a manifest or an import):

```
PayPal REST APIs (Disputes v1, Orders v2, Subscriptions v1, Reporting v1, Notifications v1)
Python 3.12+ · FastAPI · Pydantic v2 · SQLAlchemy 2.0 (async) · SQLite · httpx · ReportLab · pypdf
Next.js 15 · React 19 · TypeScript 5.9 · Tailwind CSS 4 · AG Grid Community 34
Google Gemini (google-genai, gemini-2.5-flash) · OpenAI-compatible Chat Completions API · Ollama (optional local model) · Docker Compose
uv · pnpm · pytest · Vitest · Playwright · Ruff · ESLint · Postman
```

Not claimed anywhere: Bryntum Scheduler, AG Studio, Elastic Cloud, or a live PayPal sandbox
*transaction* (the sandbox REST APIs are proven live in [live-mode.md](live-mode.md); no funded
buyer account exists to push a real dispute through). [docs/sponsors.md](sponsors.md) explains each gap in its own row.

## 2. Text description

**PayPal's January 2026 seller-protection rules are written for people who ship boxes.** A SaaS or
metered-AI merchant ships bytes and API calls, so the standard evidence packet has nothing to
attach to. SNAD ("significantly not as described") is excluded from seller protection outright: a
checkout receipt proves a payment, never that the product was consumed. INR and UNAUTHORIZED
claims are winnable, but only against a system of record that can show IP, device, delivery time
and access proof — evidence most subscription products never keep in an admissible shape. Card
funded chargebacks on the EXTERNAL channel follow Visa Compelling Evidence 3.0, which requires two
or more prior undisputed transactions sharing an IP or device fingerprint. And every one of these
fights carries a fee: $15 standard, $30 for high-volume merchants, non-refundable. Fight a $25
claim, win it, and the merchant is still down $5. Worse, a chargeback left open on a live
subscription becomes a second chargeback within 30 days — the buyer keeps access while PayPal keeps
billing them.

**VerdictPay closes those gaps in one pipeline and it prices the fight before the fee attaches.**
A merchant drops the `@verdictpay/sdk` into its product and records four signed lifecycle events keyed to
the PayPal payer id: Terms-of-Service acceptance with the SHA-256 of the exact text the buyer saw,
an authenticated session with IP and device, digital delivery with the delivered resource's SHA-256,
and metered usage. Each event is appended to a per-payer SHA-256 chain
(`sha256(prev_hash : event_type : payer_id : created_at : payload_hash)`), so a single mutated row is
reported at its exact sequence number. When PayPal opens a case, the webhook path verifies the
signature, persists the case, suspends the recurring subscription inside a 500 ms budget, locks an
immutable fact pack, and runs a deterministic expected-value model over fight, settle and offer.
Then it takes the cheapest correct action, and only an action PayPal's own HATEOAS links allow.

**PayPal is the substrate, not a checkbox.** The live client in
[backend/app/integrations/paypal/live.py](../backend/app/integrations/paypal/live.py) speaks OAuth2
client credentials (`POST /v1/oauth2/token`, cached token, 60 s refresh margin, 3 bounded retries with
`PayPal-Request-Id` idempotency and `Retry-After` honouring), Disputes v1 (`GET /v1/customer/disputes`,
`GET /v1/customer/disputes/{id}`, `POST .../send-message`, `.../make-offer`, `.../accept-claim`,
`.../provide-evidence` as RFC 2387 `multipart/related`, `.../require-evidence`, and case creation with a
`PayPal-Auth-Assertion` header), Subscriptions v1 (`POST /v1/billing/subscriptions/{id}/suspend`),
Reporting v1 (`GET /v1/reporting/transactions` for the CE 3.0 lookback), Orders v2
(`POST /v2/checkout/orders`) and Notifications v1 (`POST /v1/notifications/verify-webhook-signature`).
The sandbox gateway is the default, because the demo path must be the tested path
and every demo order is a real sandbox order.

**AI drafts the rebuttal; deterministic code owns every number.** The fact pack is built by pure
functions from the ledger and the reporting API, then frozen. Only after that does a narrative
provider run: an OpenAI-compatible `/chat/completions` call at `temperature: 0`, pointed at OpenAI or at
any local endpoint through `LLM_BASE_URL` (Ollama at `http://localhost:11434/v1` is covered by tests). Its
output is re-validated against the fact pack token by token: any number or date that is not present
in the serialized facts fails with `unverified_number`, banned marketing phrases fail, non-ASCII fails,
and a failure of any kind falls back to the deterministic template. The model adds register and
compression; it cannot add a figure. That is the difference between a credible legal filing and a
plausible one.

**What is novel is the ordering.** Most dispute tools generate prose first and check it later, or
price a dispute after the fee is already attached. VerdictPay inverts both: the money is decided by
a pure EV function whose constants are unit-tested to the cent, and the prose is generated last,
inside the fence the facts built. The fee-cliff model is the part merchants feel, and it is
dollar-weighted: `disputed_amount_minor_3m / net_sales_minor_3m` against PayPal's 1.5% line.
An INQUIRY that crosses carries a $45.00 penalty — `($30 − $15) × 3` — while a claim-stage
crossing is sunk and unpriced. A lost $99 claim in the high-volume tier costs `-(99 + 30) − 45`;
a won one still costs the never-refunded $30. VerdictPay prices that crossing and then picks
the action that avoids it — usually a zero-fee evidence-backed inquiry deflection that ends the case
before a claim fee can attach.

**CliffGuard is the second gate.** The same two-axis cliff (`TwoAxisCliffs`: HVD dollars, Visa VAMP
counts) is enforced by an isolated Sentinel subprocess (`python -I -B`, no sockets, CPU/memory/file
limits) that returns EXIT CODE 0/2 before any PayPal write. An ALLOW carries a signed HMAC
`ApprovalToken`; a VETO blocks with machine-checkable codes. The `/veto-lab` page runs three
executable negative controls (naive float triage, the recorded `@paypal/agent-toolkit@1.11.0` trace,
a live LLM attack) against the real Sentinel and shows each veto with its exit code. The policy
constants the gate enforces live in `app/oracle/rules_manifest.json`, pinned by
`python scripts/pin_oracle_manifest.py` at boot.

**The demo is seven steps and it is not a video.** Two panes: a buyer storefront on the left, the
merchant command center on the right. The steps run checkout, telemetry, chain verification, dispute
creation, deterministic triage, Gemini analysis and dossier verification, each showing its real
identifiers and response data. Every claim prices live from the two-tier fee model: in PayPal's high-volume tier the $30 fee
replaces the $15 fee (a lost $100 claim costs -$130, a won one still costs -$30), accepting in
INQUIRY is fee-free, and the policy recommendation is shown next to a decision-comparison panel that
names the cheapest modelled loss separately from the policy choice. A PayPal Wallet INR scores 5 of 6
telemetry signals (Visa CE 3.0 applies only to unbranded-card 10.4 fraud). Behind those screens: the
backend pytest suite, the frontend unit and component suites, the HTTP contract tests that drive a real
server, the SDK tests and the 26 end-to-end assertions against PayPal Sandbox, all reproducible
with `make test` (offline, using a test-only fake gateway) and `make demo` (sandbox credentials from `.env`).

## 3. Tools

**AI used in the project at runtime** (what a judge can observe by running it):

| Layer | What runs | Default | Proof |
|---|---|---|---|
| Narrative | OpenAI-compatible `POST {base}/chat/completions`, `temperature: 0`, `max_tokens: 700` | off (`LLM_MODE=template`) | [openai_provider.py](../backend/app/integrations/llm/openai_provider.py) |
| Local model | Any OpenAI-shaped endpoint; Ollama `http://localhost:11434/v1` (e.g. `llama3.2`) via `LLM_BASE_URL`/`LLM_MODEL` | off | [config.py](../backend/app/config.py), [test_llm_local_endpoint.py](../backend/tests/unit/test_llm_local_endpoint.py) |
| Fallback | Deterministic template narrative, offline, no key, cannot fail | on | [template_provider.py](../backend/app/integrations/llm/template_provider.py) |
| Guard | `validate_narrative()` rejects invented numbers, unverified dates, banned phrases, non-ASCII | always | [narrative.py](../backend/app/domain/evidence/narrative.py) |

`LLM_MODE=template` skips only the dossier-time LLM prose; Step 6 of the demo still invokes
`gemini-2.5-flash` and falls back to the deterministic template when Gemini is unavailable (see
[Gemini AI layer](#gemini-ai-layer-classify-and-draft-never-decide)). No model touches an EV number, a win probability, a chain hash
or the PDF layout.

### Gemini AI layer: classify and draft, never decide

A second model path sits on the dispute itself behind `POST /api/v1/disputes/{id}/ai/analyze`
(re-read with idempotent `GET /api/v1/disputes/{id}/ai`). Given the locked fact pack, Gemini
(`GEMINI_MODEL`, default `gemini-2.5-flash`) classifies the buyer's claim into one of five
categories and drafts a grounded evidence narrative plus a plain-language explanation of the
deterministic EV decision. Classification maps to a PayPal reason code through a frozen table the
model cannot override, and low-confidence output is demoted to the conservative `other` bucket.

What it is forbidden to do is the whole point: the model cannot set, scale or nudge win
probability, expected value, the recommendation or the verdict, and it cannot introduce a number,
name or date that is not already in the fact pack — the grounding validator rejects the draft and
the deterministic keyword classifier plus template narrative take over. The dossier PDF, the fee
math and the chain hashes are byte-identical whether Gemini answers or not.

The air gap is what makes the fallback honest instead of silent. With `AI_ENABLED=false`, no
`GEMINI_API_KEY`, a timeout (`AI_TIMEOUT_MS`, default 12000 ms, `AI_MAX_RETRIES` 1) or any
model failure, the endpoint still returns a complete, correct analysis marked `degraded=true`
with a reason — never an error, never a hallucinated number. Every generation is recorded as an
append-only `AI_GENERATION` event in the per-payer SHA-256 chain, so provenance is itself
verifiable. Sandbox credentials are required; the default path uses PAYPAL_SANDBOX
against api-m.sandbox.paypal.com.

**How the codebase was built — disclosed, not implied:** VerdictPay was implemented by an AI coding
agent (DeepSeek-based DSH) working under human direction, with the human owning scope, the frozen
spec and every merge decision. The agent did not self-certify: each phase closed on executable
gates, `make verify` runs Ruff, pytest (471), ESLint, `tsc --noEmit`, `next build`, Vitest (230 frontend + 36 SDK) and the
26-assertion E2E script, and an adversarial QA pass ([docs/qa/backend-findings.md](qa/backend-findings.md))
filed 36 probes, found 2 HIGH bugs, and those two now have regression tests
(`test_chunked_oversized_body_cannot_bypass_the_cap`,
`test_concurrent_same_idempotency_key_claims_once`).

## 4. Demo video script (2:52, under 3:00)

| Time | On screen | Spoken |
|---|---|---|
| 0:00–0:12 | Title card: "VerdictPay — defend the dispute before the fee" | "PayPal charges $15 to fight a dispute, $30 for a high-volume merchant. VerdictPay decides whether fighting is even worth it." |
| 0:12–0:28 | `/disputes` AG Grid queue, seeded: 6 cases with `PP-D-TEST-…` ids, EV cells, stage/channel badges | "This is a seeded merchant: six cases on file — five open ($497.00 of exposure) plus one resolved inquiry ($15.00 fee avoided) — a 1.37% rolling dispute ratio against PayPal's 1.5% high-volume threshold." |
| 0:28–0:40 | Back to `/` judge sandbox, both panes visible | "One page. Buyer storefront left, merchant command center right. Nothing on the right is mocked." |
| 0:40–0:55 | Click **1 · Checkout $99 Pro plan**; step log prints order, subscription, payer | "Orders v2 creates the order, Subscriptions v1 binds the plan, and the SDK ties the payer id to the exact Terms-of-Service hash the buyer accepted." |
| 0:55–1:10 | Click **Record usage**; ledger shows 4 events, chain badge flips to verified | "Four signed events: ToS, login, delivery with a SHA-256, and 42,000 metered tokens. Each one links to the previous hash. A judge can recompute that chain." |
| 1:10–1:22 | Zoom the chain hash row; click verify | "Change one row and verification reports the exact sequence number that broke. That is the system of record PayPal asks for and SaaS never keeps." |
| 1:22–1:38 | Click **Open dispute**; origin badge, containment result, case appears | "The buyer files an INR claim. If PayPal sent a webhook for this order we use it; otherwise the API opens the case and labels its origin. Containment tries to suspend the subscription and reports PayPal's answer, and the fact pack locks." |
| 1:38–1:55 | EV cards: Fight -$58.80, Settle -$99.00, Offer -$29.70 (Best EV) | "Fight is minus $58.80 — a $99 claim that crosses the 1.5% cliff with the $45 penalty. Settle is the full claim. Offer is minus $29.70 and wins on raw EV — but the policy picks the zero-fee move first." |
| 1:55–2:08 | Click **Deflect inquiry**; result chip `SKIPPED · Send message` for an `internal_test_event` case (`EXECUTED` for a `paypal_sandbox` case) | "A zero-fee, evidence-backed inquiry deflection through PayPal's send-message endpoint. This case exists only in VerdictPay, so nothing is sent to PayPal and the action is recorded as skipped. The HATEOAS guard means we cannot call an action PayPal would reject." |
| 2:08–2:20 | Case room, download **dossier.pdf**; PDF pages scroll: chain table, ToS snapshot, usage ledger, CE 3.0 exhibit | "The dossier is ReportLab, built from the locked facts. Three pages, payer id and chain head printed, no secrets. That is the prove-it artifact." |
| 2:20–2:34 | `/veto-lab`: run all three; EXIT CODE 2 vetoes and dry-run ALLOWs | "CliffGuard: three negative controls against the isolated Sentinel. Unguarded proposals are vetoed with exit code 2; hardened alternatives get a signed token. Crime versus exorcism, on one page." |
| 2:34–2:44 | `/analytics` (the 1:22 UI dispute is still open): 6 open cases (7 cases on file), $596.00 open exposure, $15.00 fees avoided, ratio 1.37% vs 1.50% | "Six open cases, $596 exposure, $15 of fees avoided. The ratio still reads 1.37%: an unescalated inquiry does not count toward PayPal's high-volume ratio, and that ratio decides whether the next dispute costs $15 or $30." |
| 2:44–2:58 | Terminal: `git clone … && cd Verdict-Pay && make install && make stack`, then `make web` — green assertions | "Clone it, make install, make stack, make web. Twenty-six assertions, sandbox credentials required. Everything you just saw runs with real sandbox orders." |

**Production checklist**

- [ ] 1920x1080, 30 fps, browser zoom 100%, dark theme, cursor visible.
- [ ] Fresh database before recording (`make reset-db && make seed`) so ids match the script.
- [ ] No third-party music, no PayPal or AG Grid logos, no trademarked UI chrome. Screen recording of our own app only.
- [ ] Cut to 2:52 or shorter; YouTube must show a duration under 3:00.
- [ ] Upload public or unlisted-public on YouTube; paste the link into §1 and the Devpost form.
- [ ] Audio: spoken lines only, normalize to about -16 LUFS.

## 5. Judge run instructions

**Docker (one command, sandbox credentials required):**

```bash
git clone https://github.com/Divyanshu-kumar14/Verdict-Pay && cd Verdict-Pay
cp .env.example .env         # then fill PAYPAL_SANDBOX_CLIENT_ID / PAYPAL_SANDBOX_CLIENT_SECRET
docker compose up --build
# frontend http://localhost:3000 · API docs http://localhost:8000/docs
```

**Local (no Docker):**

```bash
git clone https://github.com/Divyanshu-kumar14/Verdict-Pay && cd Verdict-Pay
make install                 # uv sync + pnpm install
make stack                   # seeds, boots :8000, asserts the flow, stays up
make web                     # second terminal -> http://localhost:3000
```

**Proof without leaving a server behind:**

```bash
make demo                    # seed + boot + assert the full flow + shutdown
make verify                  # ruff + pytest + eslint + tsc + next build + vitest + demo
curl -s localhost:8000/api/v1/health
```

**What you will see** (fresh seed, sandbox gateway; every value comes from [demo.md](demo.md)):

| Field | UI path — third button files **INR** (no `reason_code` sent) | CLI path — `make demo` files **INR** |
|---|---|---|
| Case id | `PP-D-TEST-…` (origin `internal_test_event`), or a PayPal id if PayPal creates it (`paypal_sandbox`) | same |
| Reason / stage / channel | INR · INQUIRY · INTERNAL | INR · INQUIRY · INTERNAL |
| Claim amount | `$99.00` | `$99.00` |
| p(win) | `80.0%` (INR multiplier 1.00, 5 of 6 signals — Visa CE 3.0 is card-only) | `80.0%` (INR multiplier 1.00, 5 of 6 signals — Visa CE 3.0 is card-only) |
| EV fight / settle / offer | `-$58.80` / `-$99.00` / `-$29.70` — a $99 inquiry that crosses the 1.5% line with the $45.00 penalty | `-$58.80` / `-$99.00` / `-$29.70` — a $99 inquiry that crosses the 1.5% line with the $45.00 penalty |
| Recommendation | `DEFLECT_INQUIRY`, fee `$0.00` | `DEFLECT_INQUIRY`, fee `$0.00` |
| Containment | `suspended=false` with PayPal's error (the demo payer's fallback subscription `I-BW452GLLEP1G` does not exist in the sandbox) | same |
| Seller action | `SKIPPED` for `internal_test_event` (nothing sent to PayPal); `EXECUTED` for `paypal_sandbox` | same |
| Telemetry | 4 new events, `logins=15 · tokens=42,000 · assets=1`, chain verified | same, 42,000 tokens |
| Dossier | case room → `/dossier.pdf`, `%PDF`, 3 pages | 7 KB, `%PDF` verified; uploaded via `multipart/related` for a `paypal_sandbox` case, upload `SKIPPED` for `internal_test_event` |
| Reporting | 6 open cases (7 on file) · exposure `$596.00` · fees avoided `$15.00` · ratio `1.37%` vs `1.50%` | queue 8 · exposure `$695.00` · fees avoided `$15.00` |

The CLI adds 2 E2E $99 cases on top of the 6 seeded cases (its escalated claim + its own dispute):
8 cases / $695 exposure. Fees avoided stays $15.00 — the one seeded historical inquiry.
Latency and timestamps are the only moving values; EV and p(win) are deterministic.

## 6. Compliance checklist

| Devpost requirement | Where it is satisfied |
|---|---|
| Project meaningfully uses PayPal (developer platform, sandbox) | [live.py](../backend/app/integrations/paypal/live.py) — OAuth2, Disputes v1, Subscriptions v1, Reporting v1, Orders v2, webhook verification. [protocols.py](../backend/app/domain/protocols.py) — one boundary, two gateway modes (`PAYPAL_SANDBOX`, `PAYPAL_LIVE`). The offline test suite swaps in [FakePayPalGateway](../backend/tests/fakes/paypal_gateway.py), which the app never uses. |
| Project meaningfully uses AI | [openai_provider.py](../backend/app/integrations/llm/openai_provider.py) + [narrative.py](../backend/app/domain/evidence/narrative.py) validator; template fallback in [template_provider.py](../backend/app/integrations/llm/template_provider.py) |
| Project + text description | §1 and §2 of this file |
| Functional demo (run instructions or hosted URL) | Hosted at https://verdictpay-web.onrender.com, or run locally per §5; [README.md](../README.md) quickstart; [demo.md](demo.md) seven-step script. |
| "Tools" field | §3 |
| Public open-source repo, license visible in About | [LICENSE](../LICENSE) (MIT) at repo root; repo URL in §1 |
| Demo video under 3 minutes on YouTube, showing it working | §4 script; video itself is `[ADD YOUTUBE LINK]` |
| Judging: Technological Implementation | Backend pytest suite, frontend vitest suite, SDK vitest suite, the HTTP contract suite and the `make demo` end-to-end assertions, plus adversarial QA with regressions. Run `make test` and `make demo` for current counts. |
| Judging: Design | [frontend/app/page.tsx](../frontend/app/page.tsx), [SandboxWorkspace.tsx](../frontend/components/sandbox/SandboxWorkspace.tsx), AG Grid queue, EV cards, case room |
| Judging: Potential Impact | EV model + fee-cliff penalty in [ev.py](../backend/app/domain/disputes/ev.py); $15/$30 fees, 1.5% threshold |
| Judging: Innovation / Idea | Pre-dispute chain as system of record, action priced before the fee, air-gapped narrative |
| Judging: Presentation | [demo.md](demo.md) seven-step script; §4 video script |

### UNVERIFIED / ACTION REQUIRED

1. **Official Rules page — UNVERIFIED.** The rules URL was Cloudflare-blocked at authoring time
   (2026-11-06). Eligibility terms, IP assignment, team rules, judging weights and the exact
   submission field list could not be read from the source. Read the rules page in a normal browser
   before submitting and reconcile this file against it.
2. **Eligibility, age and country — UNVERIFIED.** The repo contains no entrant metadata. Confirm the
   registered Devpost account holder is of age, in an eligible country, and not excluded by the
   rules; nothing in this repository can prove that.
3. **Team size — UNVERIFIED.** The code has no team manifest. The Devpost form must list every
   human contributor; the AI coding agent is disclosed in §3 and is not a teammate. Decide the
   roster and enter it.
4. **YouTube link — ACTION REQUIRED.** `[ADD YOUTUBE LINK]` is a placeholder. Record per §4, upload,
   verify the public URL plays and the duration reads under 3:00, then replace the placeholder in §1.
5. **License in About — VERIFIED, one visual check left.** `LICENSE` is at the repo root and the
   public GitHub API reports `license.spdx_id: MIT`
   (https://api.github.com/repos/Divyanshu-kumar14/Verdict-Pay), so the About panel renders the MIT
   badge. Open the repo logged out and screenshot it for the submission.
6. **Submission window — UNVERIFIED locally.** The stated period is October 1 to November 12, 2026.
   Confirm the deadline and timezone on the Devpost page, and submit with margin.
7. **Repo sync — VERIFY BEFORE SUBMITTING.** Push `cliffguard-upgrade` only when the exit gate
   in §5 is green, merge to `main` via the hosting remote, then re-read the GitHub page logged out
   immediately before submitting. Do not claim sync while unpushed.

## 7. FAQ for judges

**Is the PayPal integration real?**

Yes. `backend/scripts/verify_paypal_sandbox.py` runs against `https://api-m.sandbox.paypal.com` with real sandbox credentials and proves three things live: an OAuth2 client-credentials token from `POST /v1/oauth2/token`, a real order from `POST /v2/checkout/orders` (`intent=CAPTURE`, USD 99.00), and an authoritative `GET /v2/checkout/orders/{id}` re-read. Evidence is committed-adjacent at `artifacts/paypal-sandbox-proof.json` and `artifacts/paypal-sandbox-proof.log` — order `0BN11980TR384063M`, status `CREATED`, a real `sandbox.paypal.com/checkoutnow` approval URL, and the PayPal `debug_id` for each call.

What is **not** claimed: the capture. Buyer approval in the sandbox requires a human to open the approval URL and log in as the sandbox buyer, so the script reports `"result": "pass_order_creation_capture_blocked"` and exits 0 with an explicit `blocker` field instead of fabricating a `capture_id`. Run it yourself with `--wait-for-approval 120` to complete the lifecycle by hand.

The client is real code against the real REST contracts: OAuth2, Disputes v1, Subscriptions v1, Reporting v1, Orders v2 and webhook signature verification, with idempotency keys and bounded retries. The offline suite replays those calls with recorded HTTP fixtures ([test_paypal_live.py](../backend/tests/unit/test_paypal_live.py)).

**Is there an offline or mock mode?**

No. The demo runs against real sandbox orders. `PAYPAL_MODE=PAYPAL_SANDBOX` is the default in [config.py](../backend/app/config.py), and `PAYPAL_LIVE` is the only other mode; any other value, including the removed `LOCAL_SIMULATOR`, fails config validation at boot. Both modes satisfy one `PayPalGateway` protocol and the domain never imports `httpx`. Missing credentials yield an `UnconfiguredGateway`: the app boots and `/health` reports `unconfigured` with named blockers, but every payment call returns 502 rather than silently degrading. The only fake gateway lives in the test suite (`backend/tests/fakes/paypal_gateway.py`).

PayPal's Disputes API (`POST /v1/customer/disputes`) returns 401 for standard sandbox apps, so `POST /api/v1/sandbox/dispute` builds the case locally with a `PP-D-TEST-…` id and origin `internal_test_event` when PayPal refuses. The case runs through the same dedup, triage, EV, containment, AI and dossier code; seller actions on it are recorded as `SKIPPED` because nothing exists at PayPal to act on.

**Where is the AI?**

Gemini, `gemini-2.5-flash` by default, does two things: classify the buyer's claim into one of five categories, and draft the seller-protection narrative from a locked fact pack. A deterministic validator then rejects any draft containing a number or date that is not in the facts. It never sets the win probability, the EV figures, the recommended action or PayPal eligibility — those are computed before the model is reached. With no `GEMINI_API_KEY` the same endpoint returns a correct result from a keyword classifier and a template narrative, marked `degraded=true` with a reason. Full disclosure: [ai-disclosure.md](ai-disclosure.md).

**Does it need keys?**

Sandbox credentials are required: `PAYPAL_SANDBOX_CLIENT_ID` / `PAYPAL_SANDBOX_CLIENT_SECRET` (or `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`). No Gemini key, no OpenAI key, no Elastic cluster, no Supabase project is needed. Optional keys only switch adapters: `GEMINI_API_KEY` for the dispute AI layer (without it, a labelled deterministic fallback), `OPENAI_API_KEY` or `LLM_BASE_URL` for the dossier narrative provider, `ELASTIC_URL` for the optional search adapter, `PAYPAL_SANDBOX_WEBHOOK_ID` to receive real PayPal dispute webhooks at a public URL.

**Is the data real?**

The 200 trailing-90-day sales and 15 CE 3.0 lookback rows are synthetic demo data from [seed_demo.py](../backend/scripts/seed_demo.py), labelled `source="seed"`, not scraped. The seed's checkouts are real PayPal sandbox orders, and its five disputes go through `POST /api/v1/sandbox/dispute`. Every number derived from it is computed live by the EV engine and the reporting endpoint. The chain hashes are real SHA-256 over the stored rows; the PDF is a real PDF.

**What is deterministic and what is generated?**

Deterministic: EV fight/settle/offer, p(win) and its six signal weights, fee-cliff detection, the HATEOAS legality matrix, chain hashes, the fact pack, the dossier layout, the template narrative. Generated: only the prose from the optional LLM, and only when enabled, and its output must pass a token-level validator that rejects any number or date absent from the fact pack, otherwise the template is used.
