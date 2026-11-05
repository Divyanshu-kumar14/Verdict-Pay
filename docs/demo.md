# 60-second demo script

The judge opens one page and clicks three buttons. Everything on the right is read from the
API — no mocked panels, no pre-recorded video. This script is written to be read aloud.

## Before the clock starts (30 seconds)

```bash
# Option A — Docker (builds both images, seeds on first boot)
cp .env.example .env          # defaults already work; no PayPal keys needed
docker compose up --build
# open http://localhost:3000

# Option B — local, one command for the API side
make install
make stack                     # seeds + boots API + asserts the flow, keeps :8000 up
make web                       # second terminal (UI on :3000)

# Option B2 — manual
make install
make seed                      # 5 seeded disputes + 200 sales + CE 3.0 history
make api                       # terminal 1  (API on :8000)
make web                       # terminal 2  (UI on :3000)
```

**Recording tip for the AI requirement:** start a free local model before recording so the
dossier footer shows the AI path, not the template fallback:

```bash
ollama pull llama3.2
LLM_MODE=openai LLM_BASE_URL=http://localhost:11434/v1 LLM_MODEL=llama3.2 make stack
# dossier footer then reads: "Narrative source: ai:llama3.2. ... model prose is validated
# against the fact pack ..."
```

Without a model the same pipeline runs and the footer honestly reads
`Narrative source: template`. Both are correct; only one demonstrates the AI requirement on camera.

Both paths start in **simulator gateway mode**. If the API is running but the merchant has no
cases, the right panel shows "No dispute on file" until step 3 — that is expected.

The CLI variant `make demo` seeds a clean database, boots the API, runs
`backend/scripts/e2e_demo.py` and prints **ALL 26 ASSERTIONS PASSED**. Its numbers are listed
at the bottom, because it files an INR dispute while the UI button files SNAD.

---

## The 60 seconds

| Clock | Click | Say |
|---|---|---|
| 0:00–0:08 | Open **http://localhost:3000** | "This is a $99/month SaaS product sold through PayPal. The buyer is about to commit friendly fraud." |
| 0:08–0:20 | **1 · Checkout $99 Pro plan** (left) | "PayPal Orders v2 creates the order and subscription, and the SDK binds the payer id to the exact Terms-of-Service hash the buyer saw." |
| 0:20–0:35 | **2 · Simulate usage** | "Four signed lifecycle events — ToS, login, delivery and metered usage via <code>@verdictpay/sdk</code> (server-side <code>/api/sdk/usage</code>) — land in an append-only SHA-256 chain. A judge can verify that chain, not just trust it." |
| 0:35–0:50 | **3 · File friendly-fraud dispute** | "The buyer files a SNAD claim through the real PayPal webhook path. VerdictPay suspends the subscription, locks the fact pack and prices the dispute." |
| 0:50–0:58 | **Deflect inquiry** (button under Recommendation) | "The cheapest correct action is the zero-fee inquiry deflection. It goes through PayPal's HATEOAS guard, so we can never call an action the API would reject." |
| 0:58–1:00 | Point at the EV cards | "Fighting this claim costs more than offering, and the high-volume fee makes it worse. That is the whole product." |

## What must be on screen

Freshly seeded stack (`make seed` or `docker compose up`); numbers measured from the running
system.

### Step 1 — checkout

| Field | Expected |
|---|---|
| Order id | `5O14B26DBBB1A5529` (deterministic for a fresh seed) |
| Subscription id | `I-BW2BDCA160D9` |
| Payer id | `YRZ829104KLA` |
| Amount | `$99.00` USD |

The step log adds `order … · payer … · $99.00 USD` and `subscription … bound to order`.

### Step 2 — telemetry

| Field | Expected |
|---|---|
| Events returned | `4` |
| Totals | `logins=15 · tokens=42,000 · assets=1` |
| Chain badge | **Chain verified** |
| Payer ledger rows | `8` total (4 seeded history + 4 just generated) |

The four new events are `TOS_ACCEPTED`, `SESSION_AUTH`, `ASSET_DELIVERED` (with the export's
SHA-256) and `USAGE_METERED` (42,000 units). The ledger footer reads
`8 events · append-only · sequence 1..8`. On an unseeded database it is `4 events`.

### Step 3 — dispute and triage

| Field | Expected |
|---|---|
| Case id | `PP-D-40006` on a freshly seeded stack (queue already holds `PP-D-40001…40005`) |
| Reason / stage / channel | SNAD · INQUIRY · INTERNAL |
| Claim amount | `$99.00` |
| p(win) | `90.0%` (SNAD multiplier 0.90, all six signals present) |
| Completeness | `100%` |
| EV · Fight | `-$41.40` |
| EV · Settle | `-$99.00` |
| EV · Offer | `-$29.70` (best EV badge on this card) |
| High-volume fee | `$30.00` applied; ratio `2.5%` → `3.0%`; cliff not crossed, penalty `$0.00` |
| Recommendation | `DEFLECT_INQUIRY` → button **Deflect inquiry**, fee `$0.00` |
| Containment banner | **Subscription suspended in 0ms** (0–1 ms measured) |
| Ledger | **Chain verified**, head hash shown short |

Every rationale line is served by the API, e.g.
`p_win=0.9000 completeness=1.0000 reason_multiplier=0.9000` and
`ev_fight=-41.40 ev_settle=-99.00 ev_offer=-29.70`.

Why deflect instead of the -$29.70 offer? The policy's first rule is: in an INQUIRY, with strong
telemetry (completeness ≥ 0.6, p(win) ≥ 0.55), a zero-fee evidence-backed message is the correct
move — it cannot attract the claim fee and it can end the case before escalation. The EV cards
show *why* fighting is expensive, not only what the engine picked.

### Step 4 — action + reporting

After clicking **Deflect inquiry**:

* Result chip: `EXECUTED · Send message · 1–3ms · act_…`
* Action audit appears with the same latency and action id.
* Open **/analytics** (sidebar): queue `6` · open exposure `$596.00` · fees avoided
  `$60.00` · rolling dispute ratio `3.00%` against the `1.50%` high-volume threshold
  (200 trailing-90-day sales).

## CLI variant: `make demo` (INR instead of SNAD)

```
[0] Health + gateway mode              ok v0.1.0 - gateway=simulator - demo_mode=True
[1] Buyer checks out the Pro plan      ok order=5O14B26DBBB1A5529 sub=I-BW2BDCA160D9 payer=YRZ829104KLA
[2] Buyer burns 42k tokens…            ok 4 events - chain … - 42000 tokens
[3] Buyer files an INR dispute         ok PP-D-40006 - DEFLECT_INQUIRY - suspended in 0ms
[4] Command center loads the case room ok p(win)=0.95 - EV_fight=$-35.70 - EV_offer=$-29.70 - 6/6 signals
[5] Zero-fee action                    ok SEND_MESSAGE executed in 1ms
[6] Claim + dossier + upload           ok 7KB dossier - %PDF verified - uploaded via multipart/related
[7] Reporting                          ok 7 cases - $695.00 exposure - $60.00 fees avoided

ALL 26 ASSERTIONS PASSED - the 60-second demo is real.
```

The CLI files **INR** (reason multiplier 1.00 → p(win) 0.95, EV_fight -$35.70); the button files
**SNAD** (multiplier 0.90 → p(win) 0.90, EV_fight -$41.40). Both numbers are computed live from
the frozen model; neither is hard-coded. The CLI also escalates a second $99 claim to
CHARGEBACK and uploads the dossier, which is why it ends at 7 cases / $695 instead of 6 / $596.

## If something looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| Right panel says "No dispute on file" | No cases seeded | `make seed` (or restart `docker compose up`) |
| Step 3 disabled | Steps are sequential | Click steps 1 → 2 → 3 in order; use **Reset** to restart the local flow |
| "Chain unverified" | Ledger was edited out-of-band | Delete `backend/verdictpay.db*` and `make seed` again |
| Health badge red | API not on :8000 | `make api`, check `curl localhost:8000/api/v1/health` |
| Numbers differ by a few ms | Latency is measured live | Latency and timestamps are the only moving values; EV and p(win) are deterministic |
