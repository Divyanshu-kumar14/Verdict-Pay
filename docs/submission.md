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
| **Hosted demo** | None. VerdictPay is run locally — there is no hosted deployment. A Render blueprint exists at [render.yaml](../render.yaml) but nothing was deployed from this checkout. |
| **License** | MIT, [LICENSE](../LICENSE) — must be visible in the repo About section (see §6) |

**Built with** (only technologies that appear in a manifest or an import):

```
PayPal REST APIs (Disputes v1, Orders v2, Subscriptions v1, Reporting v1, Notifications v1)
Python 3.12+ · FastAPI · Pydantic v2 · SQLAlchemy 2.0 (async) · SQLite · httpx · ReportLab · pypdf
Next.js 15 · React 19 · TypeScript 5.9 · Tailwind CSS 4 · AG Grid Community 34
OpenAI-compatible Chat Completions API · Ollama (optional local model) · Docker Compose
uv · pnpm · pytest · Vitest · Ruff · ESLint · Postman
```

Not claimed anywhere: Bryntum Scheduler, AG Studio, Elastic Cloud, a hosted URL, or a live PayPal
sandbox transaction. [docs/sponsors.md](sponsors.md) explains each gap in its own row.

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
(`POST /v1/checkout/orders`) and Notifications v1 (`POST /v1/notifications/verify-webhook-signature`). A
protocol-identical simulator ships beside it and is the default gateway, because the demo must run
with zero credentials and the demo path must be the tested path.

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
inside the fence the facts built. The fee-cliff model is the part merchants feel: with 200 sales in
the trailing 90 days, the **third** dispute moves the rolling ratio from 1.0% to 1.5% — exactly onto
PayPal's high-volume threshold — which re-prices the portfolio at $30 per escalated claim plus a $90
three-dispute penalty exposure. By the time the seeded queue is live the ratio sits at 2.5–3.0%, so
every subsequent fight carries the never-refunded fee. VerdictPay prices that crossing and then picks
the action that avoids it — usually a zero-fee evidence-backed inquiry deflection that ends the case
before a claim fee can attach.

**The demo is 60 seconds and it is not a video.** Two panes: a buyer storefront on the left, the
merchant command center on the right. Button 1 checks out a $99 Pro plan. Button 2 burns 42,000
tokens, 15 logins and one signed ZIP. Button 3 files a SNAD claim through the real webhook path and
the case room prices it live: p(win) 90.0%, EV fight -$41.40, EV settle -$99.00, EV offer -$29.70
with the best-EV badge, recommendation DEFLECT_INQUIRY at a $0.00 fee. The CLI variant files INR
instead and asserts p(win) 0.95, EV fight -$35.70. Behind those screens: 291 backend tests, 26
end-to-end assertions against the running simulator, and 24 SDK tests, all reproducible with
`make verify`.

## 3. Tools

**AI used in the project at runtime** (what a judge can observe by running it):

| Layer | What runs | Default | Proof |
|---|---|---|---|
| Narrative | OpenAI-compatible `POST {base}/chat/completions`, `temperature: 0`, `max_tokens: 700` | off (`LLM_MODE=template`) | [openai_provider.py](../backend/app/integrations/llm/openai_provider.py) |
| Local model | Any OpenAI-shaped endpoint; Ollama `http://localhost:11434/v1` (e.g. `llama3.2`) via `LLM_BASE_URL`/`LLM_MODEL` | off | [config.py](../backend/app/config.py), [test_llm_local_endpoint.py](../backend/tests/unit/test_llm_local_endpoint.py) |
| Fallback | Deterministic template narrative, offline, no key, cannot fail | on | [template_provider.py](../backend/app/integrations/llm/template_provider.py) |
| Guard | `validate_narrative()` rejects invented numbers, unverified dates, banned phrases, non-ASCII | always | [narrative.py](../backend/app/domain/evidence/narrative.py) |

No model is called on the demo path. No model touches an EV number, a win probability, a chain hash
or the PDF layout.

**How the codebase was built — disclosed, not implied:** VerdictPay was implemented by an AI coding
agent (DeepSeek-based DSH) working under human direction, with the human owning scope, the frozen
spec and every merge decision. The agent did not self-certify: each phase closed on executable
gates, `make verify` runs Ruff, pytest (291), ESLint, `tsc --noEmit`, `next build`, SDK Vitest (24) and the
26-assertion E2E script, and an adversarial QA pass ([docs/qa/backend-findings.md](qa/backend-findings.md))
filed 36 probes, found 2 HIGH bugs, and those two now have regression tests
(`test_chunked_oversized_body_cannot_bypass_the_cap`,
`test_concurrent_same_idempotency_key_claims_once`).

## 4. Demo video script (2:52, under 3:00)

| Time | On screen | Spoken |
|---|---|---|
| 0:00–0:12 | Title card: "VerdictPay — defend the dispute before the fee" | "PayPal charges $15 to fight a dispute, $30 for a high-volume merchant. VerdictPay decides whether fighting is even worth it." |
| 0:12–0:28 | `/disputes` AG Grid queue, seeded: 5 cases `PP-D-40001…40005`, EV cells, stage/channel badges | "This is a seeded merchant: five open cases, $497 of exposure, a 2.5% rolling dispute ratio against PayPal's 1.5% high-volume threshold." |
| 0:28–0:40 | Back to `/` judge sandbox, both panes visible | "One page. Buyer storefront left, merchant command center right. Nothing on the right is mocked." |
| 0:40–0:55 | Click **1 · Checkout $99 Pro plan**; step log prints order, subscription, payer | "Orders v2 creates the order, Subscriptions v1 binds the plan, and the SDK ties the payer id to the exact Terms-of-Service hash the buyer accepted." |
| 0:55–1:10 | Click **2 · Simulate usage**; ledger shows 4 events, chain badge flips to verified | "Four signed events: ToS, login, delivery with a SHA-256, and 42,000 metered tokens. Each one links to the previous hash. A judge can recompute that chain." |
| 1:10–1:22 | Zoom the chain hash row; click verify | "Change one row and verification reports the exact sequence number that broke. That is the system of record PayPal asks for and SaaS never keeps." |
| 1:22–1:38 | Click **3 · File friendly-fraud dispute**; containment banner, case appears | "The buyer files a SNAD claim. The webhook verifies the signature, the subscription is suspended in under a millisecond, and the fact pack locks." |
| 1:38–1:55 | EV cards: Fight -$41.40, Settle -$99.00, Offer -$29.70 (Best EV) | "Fight is minus $41.40. Settle is the full claim. Offer is minus $29.70 and wins on raw EV — but the policy picks the zero-fee move first." |
| 1:55–2:08 | Click **Deflect inquiry**; result chip `EXECUTED · Send message · 1ms` | "A zero-fee, evidence-backed inquiry deflection through PayPal's send-message endpoint. The HATEOAS guard means we cannot call an action PayPal would reject." |
| 2:08–2:22 | Case room, download **dossier.pdf**; PDF pages scroll: chain table, ToS snapshot, usage ledger, CE 3.0 exhibit | "The dossier is ReportLab, built from the locked facts. Three pages, payer id and chain head printed, no secrets. That is the prove-it artifact." |
| 2:22–2:36 | `/analytics`: queue 6, open exposure $596.00, fees avoided $60.00, ratio 3.00% vs 1.50% | "Six cases, $596 exposure, $60 of fees avoided, and the ratio that decides whether the next dispute costs $15 or $30." |
| 2:36–2:52 | Terminal: `git clone … && cd Verdict-Pay && make install && make stack`, then `make web` — green assertions | "Clone it, make install, make stack, make web. Twenty-six assertions, zero API keys. Everything you just saw runs on your laptop in under a minute." |

**Production checklist**

- [ ] 1920x1080, 30 fps, browser zoom 100%, dark theme, cursor visible.
- [ ] Fresh database before recording (`make reset-db && make seed`) so ids match the script.
- [ ] No third-party music, no PayPal or AG Grid logos, no trademarked UI chrome. Screen recording of our own app only.
- [ ] Cut to 2:52 or shorter; YouTube must show a duration under 3:00.
- [ ] Upload public or unlisted-public on YouTube; paste the link into §1 and the Devpost form.
- [ ] Audio: spoken lines only, normalize to about -16 LUFS.

## 5. Judge run instructions

**Docker (one command, no keys):**

```bash
git clone https://github.com/Divyanshu-kumar14/Verdict-Pay && cd Verdict-Pay
cp .env.example .env
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
make demo                    # seed + boot + 26 assertions + shutdown
make verify                  # ruff + pytest + eslint + tsc + next build + vitest + e2e
curl -s localhost:8000/api/v1/health
```

**What you will see** (fresh seed, simulator gateway; every value comes from [demo.md](demo.md)):

| Field | UI path — third button files **SNAD** | CLI path — `make demo` files **INR** |
|---|---|---|
| Case id | `PP-D-40006` | `PP-D-40006` |
| Reason / stage / channel | SNAD · INQUIRY · INTERNAL | INR · INQUIRY · INTERNAL |
| Claim amount | `$99.00` | `$99.00` |
| p(win) | `90.0%` (SNAD multiplier 0.90) | `95.0%` (INR multiplier 1.00) |
| EV fight / settle / offer | `-$41.40` / `-$99.00` / `-$29.70` (best EV) | `-$35.70` / `-$99.00` / `-$29.70` |
| Recommendation | `DEFLECT_INQUIRY`, fee `$0.00` | `DEFLECT_INQUIRY`, fee `$0.00` |
| Containment | subscription suspended, 0–1 ms | same |
| Telemetry | 4 new events, `logins=15 · tokens=42,000 · assets=1`, chain verified | same, 42,000 tokens |
| Dossier | case room → `/dossier.pdf`, `%PDF`, 3 pages | 7 KB, `%PDF` verified, uploaded via `multipart/related` |
| Reporting | queue 6 · exposure `$596.00` · fees avoided `$60.00` · ratio `3.00%` vs `1.50%` | queue 7 · exposure `$695.00` · fees avoided `$60.00` |

The CLI ends at 7 cases because it escalates a second $99 claim to CHARGEBACK and uploads a dossier.
Latency and timestamps are the only moving values; EV and p(win) are deterministic.

## 6. Compliance checklist

| Devpost requirement | Where it is satisfied |
|---|---|
| Project meaningfully uses PayPal (developer platform, sandbox) | [live.py](../backend/app/integrations/paypal/live.py) — OAuth2, Disputes v1, Subscriptions v1, Reporting v1, Orders v2, webhook verification. [simulator.py](../backend/app/integrations/paypal/simulator.py) — same protocol, deterministic. [protocol.py](../backend/app/domain/protocols.py) — one boundary, two implementations. |
| Project meaningfully uses AI | [openai_provider.py](../backend/app/integrations/llm/openai_provider.py) + [narrative.py](../backend/app/domain/evidence/narrative.py) validator; template fallback in [template_provider.py](../backend/app/integrations/llm/template_provider.py) |
| Project + text description | §1 and §2 of this file |
| Functional demo (run instructions or hosted URL) | §5; [README.md](../README.md) quickstart; [demo.md](demo.md) three-button script. No hosted URL claimed. |
| "Tools" field | §3 |
| Public open-source repo, license visible in About | [LICENSE](../LICENSE) (MIT) at repo root; repo URL in §1 |
| Demo video under 3 minutes on YouTube, showing it working | §4 script; video itself is `[ADD YOUTUBE LINK]` |
| Judging: Technological Implementation | 291 backend tests, 26 E2E assertions, 24 SDK tests, adversarial QA with regressions |
| Judging: Design | [frontend/app/page.tsx](../frontend/app/page.tsx), [SandboxWorkspace.tsx](../frontend/components/sandbox/SandboxWorkspace.tsx), AG Grid queue, EV cards, case room |
| Judging: Potential Impact | EV model + fee-cliff penalty in [ev.py](../backend/app/domain/disputes/ev.py); $15/$30 fees, 1.5% threshold |
| Judging: Innovation / Idea | Pre-dispute chain as system of record, action priced before the fee, air-gapped narrative |
| Judging: Presentation | [demo.md](demo.md) 60-second script; §4 video script |

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
7. **Repo sync — VERIFIED.** The public `main` branch contains every source file, `LICENSE` and
   this pack; the tree is clean and local `HEAD` equals `origin/main`. Re-read the GitHub page
   logged out once more immediately before submitting.

## 7. FAQ for judges

**Is the PayPal integration real?**

The client is real code against the real REST contracts: OAuth2 credentials, Disputes v1, Subscriptions v1, Reporting v1, Orders v2 and webhook signature verification, with idempotency keys and bounded retries. It is covered by recorded HTTP fixtures ([test_paypal_live.py](../backend/tests/unit/test_paypal_live.py)), not by a live sandbox account: this environment had no credentials and no live transaction was run. What we did run is the simulator behind the same protocol.

**Why a simulator by default?**

Because the demo must run on a judge's laptop with no account, and the demo path should be the tested path. `PAYPAL_MODE=simulator` is the default in [config.py](../backend/app/config.py); both implementations satisfy one `PayPalGateway` protocol and the domain never imports `httpx`. Set `PAYPAL_MODE=live` plus credentials and the same calls go to `api-m.sandbox.paypal.com`.

**Where is the AI?**

In the narrative layer only: a chat-completions call writes the seller-protection rebuttal from a locked fact pack, after the deterministic engine has already priced the dispute. It is disabled by default (`LLM_MODE=template`), so the demo never depends on a key. Every EV number, win probability, chain hash and PDF layout is pure code.

**Does it need keys?**

No. The default stack needs no PayPal key, no OpenAI key, no Elastic cluster, no Supabase project. Optional keys only switch adapters: `OPENAI_API_KEY` or `LLM_BASE_URL` for the narrative, `ELASTIC_URL` for the optional search adapter, `PAYPAL_CLIENT_ID`/`SECRET` for live mode.

**Is the data real?**

The 200 trailing-90-day sales, 15 CE 3.0 lookback rows and five seeded disputes are synthetic demo data from [seed_demo.py](../backend/scripts/seed_demo.py), deterministic and not scraped. Every number derived from it is computed live by the EV engine and the reporting endpoint. The chain hashes are real SHA-256 over the stored rows; the PDF is a real PDF.

**What is deterministic and what is generated?**

Deterministic: EV fight/settle/offer, p(win) and its six signal weights, fee-cliff detection, the HATEOAS legality matrix, chain hashes, the fact pack, the dossier layout, the template narrative. Generated: only the prose from the optional LLM, and only when enabled, and its output must pass a token-level validator that rejects any number or date absent from the fact pack, otherwise the template is used.
