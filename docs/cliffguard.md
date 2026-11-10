# CliffGuard layer: two-axis cliffs, strict CE 3.0 and the Sentinel

This document describes what was merged into VerdictPay from the CliffGuard PRD (`1.1.0-SPEC`).

## Sources of truth

| Kind | Where | Badge in UI / `source_plane` in JSON |
|---|---|---|
| PayPal orders, captures, disputes, Reporting v1 | live PayPal sandbox | `[LIVE PAYPAL SANDBOX]` / `LIVE_PAYPAL_SANDBOX` |
| Locally built test dispute (sandbox app cannot create disputes, HTTP 401) | local | `[LOCAL TEST DISPUTE · PAYPAL SANDBOX ORDER]` / `INTERNAL_TEST_EVENT` |
| Visa TC05/TC40/TC15, Mastercard ECP counts | simulated acquirer feed (no card-network connection exists) | `[VISA-TC40 / ACQUIRER-FEED SIMULATION]` / `SIMULATED_CARD_NETWORK_FEED` |

## Contracts

- `schemas/*.schema.json`: dispute case, cliff metrics, triage proposal, sentinel verdict, CE 3.0
  manifest. `schemas/cliffguard_ledger.sql`: CQRS DDL with INTEGER minor units only.
- `backend/app/oracle/rules_manifest.json`: April 2026 thresholds as integers. Its canonical
  SHA-256 is pinned in `app/oracle/manifest.py`; the API exits with code 2 at boot when the file
  is missing, contains a float, or does not match. Re-pin after a deliberate edit with
  `uv run --directory backend python scripts/pin_oracle_manifest.py`.

## Two axes

- **PayPal HVD** (`PAYPAL_WALLET`): 3 full calendar months; `> 100` settled wallet transactions and
  disputed wallet INR/SNAD claim dollars / net sales `>= 15,000 ppm`. In the tier the $30 fee
  replaces $15, is charged even on a win, and the response SLA drops from 10 to 3 days. Open
  INQUIRY cases and card-rail disputes never count.
- **Visa VAMP** (`UNBRANDED_CARD`): `(TC40 + TC15) / TC05 >= 15,000 ppm` and `>= 1,500` monthly
  events, $8 per event; an order with both a TC40 and a TC15 counts twice; a CE 3.0 remedy removes
  the TC15, not the TC40. **Mastercard ECP**: `>= 15,000 ppm` and `>= 100` chargebacks, warning at
  10,000 ppm.

## Visa CE 3.0 (reason 10.4, unbranded card only)

`app/oracle/ce3_matcher.py` requires two prior orders on the same `payment_credential_hash`, each
`120*86400 <= seconds_before_dispute <= 365*86400`, no prior dispute or TC40, and at least two core
elements identical across all three orders with at least one of `ip_hash` / `device_id_hash`.
PayPal Reporting v1 carries none of these anchors; they are correlated from the local ledger by
transaction id.

## Sentinel

Every seller dispute write (`send-message`, `make-offer`, `accept-claim`, `provide-evidence`,
`escalate`, `appeal`) is turned into a TriageProposal and evaluated by
`python -I -B app/sentinel/cli.py` with `env={}`, `RLIMIT_CPU=2s`, `RLIMIT_AS=256MB`,
`RLIMIT_FSIZE=2MB` and the socket layer disabled. Exit code 0 = ALLOW: the trusted parent signs an
HMAC-SHA256 ApprovalToken (120 s TTL). Exit code 2 = VETO: HTTP 422 `sentinel_veto`. The live
gateway refuses any of those POSTs without a matching, unexpired token. Every verdict is stored in
`sentinel_audit_log` and appended to the SHA-256 `SENTINEL-AUDIT` telemetry chain
(`GET /api/v1/telemetry/chain/SENTINEL-AUDIT/verify`).

Subscriptions v1 containment (`suspend`) is a deterministic circuit breaker, not an AI proposal, and
is not routed through the Sentinel.

## Negative controls (`/veto-lab`, `POST /api/v1/veto-lab/run`)

1. `app/sentinel/candidate_naive.py`: float, count-only triage → `VETO_HVD_CLIFF_BREACH`
   (+ `VETO_PORTFOLIO_CLIFF_BREACH_EV_DOMINATED`) and `VETO_VAMP_CLIFF_BREACH`.
2. `tools/toolkit-probe/toolkit_audit_probe.ts`: runs the real `@paypal/agent-toolkit@1.11.0`
   with a recording axios adapter (no network). Reproduced: `handleToolCall()` runs a tool hidden
   from `getTools()`; `dispute_id` is interpolated unescaped (`../` traversal, `?&` query injection);
   only three dispute tools; the access token is cached past `expires_in`.
   `CliffGuardToolkitShield` and the Sentinel block them (`VETO_TOOLKIT_ACL_BYPASS`,
   `VETO_PATH_TRAVERSAL_BLOCKED`). Re-record: `cd tools/toolkit-probe && npm install &&
   node toolkit_audit_probe.ts ../../backend/app/sentinel/fixtures/toolkit_probe.json`.
3. `app/worker/live_llm_attack.py`: an uncredentialed subprocess (env = `LLM_API_KEY`,
   `LLM_MODEL` only) asks a live LLM to act on a hostile buyer thread; the Sentinel vetoes with
   `VETO_PROMPT_INJECTION_BLOCKED` and `VETO_CE3_WINDOW_OUT_OF_RANGE` (prior order 119d 23h 59m 59s
   old). Without a key the proposal is scripted and labelled `scripted_no_llm_key`.
