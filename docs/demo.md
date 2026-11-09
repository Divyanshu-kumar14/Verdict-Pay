# Judge demo script

The demo is seven explicit steps on one page. Every panel reads from the API — no mocked data, no
pre-recorded video, no hidden fallback. Each step shows its real identifiers, timestamps and response
bodies, and each step is retryable on failure.

This page is written to be read aloud while clicking.

## Before the clock starts

```bash
# Option A — Docker (builds both images, seeds on first boot)
cp .env.example .env          # the defaults require sandbox credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET)
docker compose up --build
# open http://localhost:3000

# Option B — local, one command for the API side
make install
make stack                    # seeds + boots the API + self-checks, keeps :8000 up
make web                      # second terminal (UI on :3000)

# Option B2 — manual
make install
make seed                     # 5 seeded disputes + 200 sales + CE 3.0 history
make api                      # terminal 1  (API on :8000)
make web                      # terminal 2  (UI on :3000)
```

Both paths start in `PAYPAL_SANDBOX` gateway mode. The gateway badge in the header comes from
`health.gateway_status` and reads **PAYPAL_SANDBOX**.
Every money figure carries a **REAL SANDBOX** provenance chip, sourced from the same
response that produced the number.

For the AI requirement on camera, export a Gemini key before recording:

```bash
export GEMINI_API_KEY=<your-google-ai-studio-key>   # GEMINI_MODEL defaults to gemini-2.5-flash
make stack
# step 6 then shows provider=gemini, model=gemini-2.5-flash, degraded=false
```

Without a key everything still works: classification falls back to the keyword table, the narrative
to the deterministic template, and step 6 shows `degraded=true` with `degraded_reason=ai_disabled`.
That is a correct, labelled state — not a broken one.

## The seven steps

| # | Step | What the judge sees | What to say |
|---|---|---|---|
| 1 | **PayPal checkout** | `order_id`, `status=CREATED`, `lifecycle_stage=CREATED`, `approval_url`, `provenance` | "Creating an order is not a payment. PayPal says CREATED until a buyer approves." |
| 2 | **Telemetry** | 4 chained events: ToS acceptance, auth, delivery, metered usage | "Four signed events bind the payer id to the exact ToS hash the buyer saw." |
| 3 | **Evidence verification** | Chain head, each event's `prev_hash` and `chain_hash`, `valid=true` | "A judge can recompute this chain, not merely trust it." |
| 4 | **Dispute creation** | `dispute_id`, reason, stage, `origin` | "This is an internal test event — it travelled the real pipeline, PayPal did not originate it." |
| 5 | **Deterministic triage** | EV fight / settle / offer, `p_win`, ratio vs threshold with the true relation, decision comparison | "Both the policy choice and the cheapest modelled outcome are named. They can differ." |
| 6 | **Gemini analysis** | Provider, model, classification + confidence, narrative, `degraded` / reason | "Gemini classifies and drafts. It never sets the probability or the EV." |
| 7 | **Evidence dossier** | SHA-256, size, chain status, PDF download, **Verify integrity** result | "Re-hash the file yourself; the manifest, the header and the verify endpoint must agree." |

### Step 1 — PayPal checkout

Open the `approval_url`, log in as the **sandbox buyer** (not your own PayPal login),
approve, then return to the app and press **Capture**. The UI polls
`GET /api/v1/sandbox/orders/{id}` and shows `APPROVED → CAPTURED` with a `capture_id`.

1. Open the `approval_url` (a real `sandbox.paypal.com/checkoutnow?token=…` link).
2. Pressing Capture before approval returns `409 order_not_approved`. Say so: that is the lifecycle
   enforcing itself, and it mirrors PayPal's 422 `ORDER_NOT_APPROVED`.

Expected values on a freshly seeded sandbox stack (ids are PayPal-assigned):

| Field | Expected |
|---|---|
| Order id | PayPal-assigned (see `approval_url`) |
| Subscription id | PayPal-assigned |
| Payer id | `YRZ829104KLA` |
| Amount | `$99.00` USD |

### Step 2 — telemetry

| Field | Expected |
|---|---|
| Events returned | `4` |
| Totals | `logins=15 · tokens=42,000 · assets=1` |
| Payer ledger rows | `8` on a seeded stack (4 history + 4 new), `4` on a clean one |

The four events are `TOS_ACCEPTED`, `SESSION_AUTH`, `ASSET_DELIVERED` (with the export's SHA-256) and
`USAGE_METERED` (42,000 units).

### Step 3 — evidence verification

The chain badge reads **Chain verified**. Each row shows its `prev_hash` and `chain_hash`, and the
head hash is displayed in short form. Verification is `GET /api/v1/telemetry/chain/{payer_id}/verify`,
which recomputes every link and reports each break by sequence number.

### Step 4 — dispute creation

| Field | Expected |
|---|---|
| Case id | `PP-D-40006` on a freshly seeded stack (`PP-D-40001…40005` are seeded) |
| Reason / stage / channel | SNAD · INQUIRY · INTERNAL |
| Claim amount | `$99.00` |
| Completeness | `100%` |
| `origin` | `internal_test_event` |

Say the `origin` line out loud. `internal_test_event` means the event was generated locally and
travelled the real ingest, triage and dossier path; PayPal did not originate it. A dispute created by
a PayPal webhook or through the Disputes API is labelled `paypal_sandbox` instead.

### Step 5 — deterministic triage

| Field | Expected (seeded, sandbox) |
|---|---|
| p(win) | `90.0%` (SNAD multiplier 0.90, all six signals present) |
| EV · Fight | `-$41.40` |
| EV · Settle | `-$99.00` |
| EV · Offer | `-$29.70` |
| Ratio | `2.5% → 3.0%`, `ratio_relation=at_or_above`, `threshold_crossed_now=false` |
| Penalty | `$0.00` — the merchant was already above 1.5% before this dispute |
| Policy | `DEFLECT_INQUIRY` |
| Decision comparison | policy choice `Deflect inquiry`; cheapest modelled loss `Make offer` |

The ratio row is the defect that was fixed. The merchant sits at 3.00% against a 1.50% threshold, so
the copy must read **at or above**, never "3.00% below 1.50%". The renderer reads
`breakdown.ratio_relation`; it never infers position from `crosses_cliff`, which is `false` both
below the line and already above it.

The policy choice and the cheapest outcome are different numbers here, and the API says so plainly.
Deflecting an inquiry carries no fee and can end the case before escalation, so policy prefers it even
though `MAKE_OFFER` prices lower. The panel never claims the recommendation *is* the cheapest.

### Step 6 — Gemini analysis

Press **Run AI analysis** (`POST /disputes/{id}/ai/analyze`). The panel renders the provider, the
model, `degraded` and `degraded_reason`, then the classification with its confidence and rationale,
the evidence completeness, the drafted narrative, and the generation timestamp.

Say exactly what the model does and does not do: it classifies the claim and drafts prose from the
locked fact pack. The probability, the EV figures and the recommended action were computed before the
model was reached. Repeating the call returns the cached result without re-billing.

### Step 7 — evidence dossier

Generate, then download the PDF. The panel shows the SHA-256, the byte size and the chain status.
Press **Verify integrity** (`GET /disputes/{id}/dossier/verify`) to see `verified` plus the individual
checks: `chain_valid`, `snapshot_present`, `hash_matches`, `size_matches`.

A judge can verify independently: `shasum -a 256` the downloaded file and compare it against the
manifest's `sha256`. All three sources must agree — the file on disk, the manifest, and the
`/dossier/verify` result. With `curl` you can also read the `X-Dossier-SHA256` response header:

```bash
curl -sD - -o /tmp/d.pdf localhost:8000/api/v1/disputes/PP-D-40006/dossier.pdf \
  -H 'X-API-Key: vp_demo_sk_local' | grep -i x-dossier-sha256
shasum -a 256 /tmp/d.pdf
```

The response header is only readable from `curl` or another non-browser client: the API's CORS policy
exposes `X-Request-Id` only, so a cross-origin `fetch` in a browser cannot read `X-Dossier-SHA256`.
That is why the UI compares the manifest digest and the verify result instead.

## Reset and isolation

**Reset demo** calls the reset endpoint and returns the UI to a clean step 1. Each run carries its own
`run_id`, and the workspace renders only that run's records — a new run never displays a previous
run's case while its own checkout is pending. The run id is shown as a badge, so two runs are never
confused on screen.

## CLI variant: `make demo`

```
[0] Health + gateway mode              ok v0.1.0 - gateway=sandbox - demo_mode=True
[1] Buyer checks out the Pro plan      ok order=<paypal-assigned> sub=<paypal-assigned> payer=YRZ829104KLA
[2] Buyer burns 42k tokens…            ok 4 events - chain … - 42000 tokens
[3] Buyer files an INR dispute         ok PP-D-40006 - DEFLECT_INQUIRY - suspended in 0ms
[4] Command center loads the case room ok p(win)=0.95 - EV_fight=$-35.70 - EV_offer=$-29.70 - 6/6 signals
[5] Zero-fee action                    ok SEND_MESSAGE executed in 1ms
[6] Claim + dossier + upload           ok 7KB dossier - %PDF verified - uploaded via multipart/related
[7] Reporting                          ok 7 cases - $695.00 exposure - $60.00 fees avoided

ALL 26 ASSERTIONS PASSED - the 60-second demo is real.
```

`make demo` seeds a clean database, boots the API, runs `backend/scripts/e2e_demo.py` and exits. The
CLI files **INR** (multiplier 1.00 → p(win) 0.95, EV_fight -$35.70); the UI button files **SNAD**
(multiplier 0.90 → p(win) 0.90, EV_fight -$41.40). Both are computed live from the frozen model and
neither is hard-coded. The CLI also escalates a second $99 claim to CHARGEBACK and uploads the
dossier, which is why it ends at 7 cases / $695 instead of 6 / $596.

## If something looks wrong

| Symptom | Cause | Fix |
|---|---|---|
| "No dispute on file" | No cases seeded | `make seed`, or restart `docker compose up` |
| Step 6 shows `degraded=true` | No `GEMINI_API_KEY`, or `AI_ENABLED=false` | Export the key and restart the API |
| Step 1 capture returns `409 order_not_approved` | Order still `CREATED` | Open the approval_url and approve as the sandbox buyer, then capture |
| "Chain unverified" | Ledger edited out-of-band | Delete `backend/verdictpay.db*` and `make seed` |
| Health badge red | API not on :8000 | `make api`; check `curl localhost:8000/api/v1/health` |
| Numbers differ by a few ms | Latency is measured live | Latency and timestamps are the only moving values |

Related: [README](../README.md) · [sandbox mode](live-mode.md) · [AI disclosure](ai-disclosure.md).
