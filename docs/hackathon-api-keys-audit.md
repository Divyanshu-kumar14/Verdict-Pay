# Hackathon API-key audit — VerdictPay (PayPal AI Hackathon)

Audited 2026-11-06 against backend/app/config.py, the gitignored local .env, frontend/.env.local, frontend/lib/api.ts, and backend/scripts/verify_paypal_live.py.

## Bottom line

| Testing mode | Keys needed | Implemented in .env | Verdict |
|---|---|---|---|
| Demo (judge flow, make stack, make demo, make verify) against PayPal Sandbox | PAYPAL_SANDBOX_CLIENT_ID + PAYPAL_SANDBOX_CLIENT_SECRET (or PAYPAL_CLIENT_ID + PAYPAL_CLIENT_SECRET) | PAYPAL_MODE=PAYPAL_SANDBOX (the default); client id/secret filled (real sandbox app Verdict-Pay, created 2026-05-11); VERDICTPAY_API_KEY=vp_demo_sk_local (public demo key) | Implemented — required. Without them the API boots with an UnconfiguredGateway (/health readiness=unconfigured, payment calls 502) |
| Live PayPal sandbox checks (make verify-live) | Same sandbox client id/secret | Filled | Implemented |
| Real PayPal dispute webhooks | PAYPAL_SANDBOX_WEBHOOK_ID (or PAYPAL_WEBHOOK_ID) + a public URL | Empty | Missing — only needed to receive real PayPal webhooks; without it every incoming PayPal webhook is rejected |
| Gemini dispute AI (classify + draft) | GEMINI_API_KEY | Empty | Optional — degrades to a labelled deterministic path |
| AI dossier narrative via OpenAI-compatible model | OPENAI_API_KEY (or LLM_BASE_URL + local Ollama, no API key) | Empty | Optional — off the demo path |
| Optional Elastic search adapter | ELASTIC_URL + ELASTIC_API_KEY | Empty | Optional — off the demo path |

## What each key controls

Source: backend/app/config.py (env-driven Settings, loads backend/.env then repo-root .env).

- paypal_sandbox_client_id / paypal_sandbox_client_secret (falling back to paypal_client_id / paypal_client_secret) — OAuth2 client-credentials for POST /v1/oauth2/token against paypal_api_base (default sandbox). Always required: the only modes are `PAYPAL_SANDBOX` (default) and `PAYPAL_LIVE`, and `PAYPAL_MODE=LOCAL_SIMULATOR` now fails config validation at boot. verify_paypal_live.py refuses to run without them. Both are filled in .env.
- paypal_sandbox_webhook_id (falling back to paypal_webhook_id) — used by POST /v1/notifications/verify-webhook-signature (Notifications v1), the only check applied to POST /api/v1/webhooks/paypal. Empty in .env. The app boots and runs without it, but incoming PayPal webhooks are then rejected; ALLOW_UNSIGNED_WEBHOOKS does not bypass this check.
- verdictpay_api_key — the X-API-Key that authenticates merchant to API calls (backend enforces it; frontend sends it as the public demo key NEXT_PUBLIC_VERDICTPAY_API_KEY). Default vp_demo_sk_local, overridden identically in .env. Seeded into the merchants table by scripts/bootstrap.py on boot.
- verdictpay_signing_secret — HMAC secret for SDK to API signed telemetry ingestion (X-VerdictPay-Timestamp / X-VerdictPay-Signature, security.py). verdictpay_webhook_secret is still a config field (production refuses its dev default) but no webhook path uses it; PayPal webhooks are verified only by PayPal. Both filled with machine-generated hex in .env.
- gemini_api_key / gemini_model — drives the dispute AI layer (POST /api/v1/disputes/{id}/ai/analyze): claim classification and grounded narrative drafting, model default gemini-2.5-flash. Empty means the endpoint still answers, using the keyword classifier and the template narrative, with degraded=true and degraded_reason=ai_disabled. The model never sets win probability, EV, the recommended action or PayPal eligibility.
- openai_api_key — only consulted when LLM_MODE=openai. Empty; the default path is the deterministic template provider, so no key is needed for the demo. The model writes prose only — never EV numbers, chain hashes, or PDF layout.
- elastic_url / elastic_api_key — optional sponsor adapter, not on the demo path; SQL stays authoritative.

## Files that ship keys

- .env (gitignored, local test config): PayPal client id/secret + all shared secrets + NEXT_PUBLIC_VERDICTPAY_API_KEY.
- .env.example (committed): template with empty credential placeholders; make env copies it.
- frontend/.env.local (gitignored): public API base + demo key + server-side VERDICTPAY_API_KEY/VERDICTPAY_SIGNING_SECRET for the /api/sdk/usage route.
- Committed code contains no real secrets (the demo key is documented as public-by-design; security.py redacts secrets from logs; config.py refuses to boot in production with dev defaults).

## Evidence commands

make verify        # ruff + pytest (offline, FakePayPalGateway test fixture) + eslint + tsc + next build + vitest + SDK build + scripted demo against PayPal Sandbox
make demo          # judge flow against PayPal Sandbox with the .env credentials (26 assertions)
make verify-live   # PAYPAL_MODE=PAYPAL_SANDBOX OAuth + dispute read + Reporting v1 (needs PAYPAL_CLIENT_ID/SECRET)
./backend/.venv/bin/python backend/scripts/verify_paypal_sandbox.py --wait-for-approval 120  # real order lifecycle

## Still open (from docs/hackathon-compliance.md)

- Record the sub-3-minute YouTube demo video and add the link to docs/submission.md (§1 placeholder [ADD YOUTUBE LINK]).
- Read the Official Rules at https://paypalaihackathon.devpost.com/rules in a normal browser (Cloudflare-gated to automated clients) and confirm eligibility, regions, team size, and IP terms before submitting.
- `make verify-live` and `backend/scripts/verify_paypal_sandbox.py` have both been run against the real sandbox; the evidence lives in `artifacts/paypal-sandbox-proof.{json,log}`. Capture remains blocked pending a human approving the order as the sandbox buyer. The repo defaults to PAYPAL_SANDBOX, so the judged demo needs sandbox credentials; there is no keyless mode.