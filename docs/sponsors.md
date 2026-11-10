# Sponsor and tool mapping

This table is deliberately conservative: every row points at a file that exists in this
repository. If we could not point at code, we say so. Two proprietary runtimes (Bryntum and
AG Studio) are **not** distributed with this project and are **not** faked; the open
replacements are named.

| Tool | What VerdictPay actually uses it for | Claim level | Proof in this repo |
|---|---|---|---|
| **PayPal Developer Platform** | The core engine. Disputes v1 (`GET`, `send-message`, `make-offer`, `accept-claim`, `provide-evidence`, sandbox `require-evidence`), Orders v2 (checkout), Subscriptions v1 (`/suspend` containment), Reporting/Transaction Search v1 (Visa CE 3.0 lookbacks) and webhook signature verification. | **Live code**: one `PayPalGateway` protocol, live client against real PayPal Sandbox/Live, covered by recorded HTTP fixtures. | [backend/app/integrations/paypal/live.py](../backend/app/integrations/paypal/live.py), [wire.py](../backend/app/integrations/paypal/wire.py), [tests/unit/test_paypal_live.py](../backend/tests/unit/test_paypal_live.py) |
| **AG Grid (Community)** | The dispute triage queue: EV cells, stage/channel badges, HATEOAS action chips, sorting and filtering. Community modules only; no enterprise module is registered anywhere. | **Used** (`ag-grid-community` 34.3.1, Theming API v34) | [frontend/lib/ag-grid.ts](../frontend/lib/ag-grid.ts), [frontend/components/disputes/DisputesGrid.tsx](../frontend/components/disputes/DisputesGrid.tsx), [frontend/package.json](../frontend/package.json) |
| **APIMatic** | Context Plugin audit for Disputes v1 and Trackers v1 ([apimatic-findings.md](apimatic-findings.md)): the PayPal plugin v0.4.1 grounds Orders, Payments, Subscriptions, Transaction Search and Vault, has no Disputes v1 module, and exposes shipment tracking only through Orders v2 `/v2/checkout/orders/{id}/track`. We did not ship an APIMatic runtime artifact. | **Audited, not a runtime dependency** | [docs/apimatic-findings.md](apimatic-findings.md), [backend/app/integrations/paypal/live.py](../backend/app/integrations/paypal/live.py) |
| **Elastic** | Optional `SearchIndex` adapter: an NDJSON `_bulk` mirror for cross-customer correlation. Selected only when `ELASTIC_URL` is set; SQL and the PayPal transaction cache remain authoritative. | **Optional adapter implemented, off by default, not on the demo path.** Selected at startup from `ELASTIC_URL`; SQL remains authoritative. The adapter is a drop-in integration point (`_bulk` NDJSON, failure-swallowing) that a deployment wires to its ingestion path. | [backend/app/integrations/search/elastic.py](../backend/app/integrations/search/elastic.py), [factory.py](../backend/app/integrations/search/factory.py), [null.py](../backend/app/integrations/search/null.py) |
| **Postman** | An importable API tour: health, sandbox checkout/usage/dispute, telemetry batch, list/detail/triage, evidence upload, dossier PDF, reporting and a PayPal webhook example that documents the verify-webhook-signature flow (transmission headers + webhook ID; the demo webhook is unsigned and rejected). | **Used** (collection + local environment checked into the repo) | [postman/verdictpay-api.postman_collection.json](../postman/verdictpay-api.postman_collection.json), [postman/verdictpay-local.postman_environment.json](../postman/verdictpay-local.postman_environment.json) |
| **Render** | Declarative deployment blueprint for the API and the Next.js command center, with health checks, Dockerfile paths and `sync: false` secrets. Blueprint + live free-plan deployment per [deploy-render.md](deploy-render.md). | **Used as blueprint and live deployment** (free plan sleeps after ~15 min idle; local `make stack` is the primary judge path) | [render.yaml](../render.yaml), [backend/Dockerfile](../backend/Dockerfile), [frontend/Dockerfile](../frontend/Dockerfile) |
| **@verdictpay/sdk** (not a sponsor) | TypeScript pre-dispute telemetry: batching, retry with backoff, HMAC signing, typed errors, ESM + CJS + d.ts. | **Built as 0.1.1 locally** ([`@verdictpay/sdk@0.1.0`](https://www.npmjs.com/package/@verdictpay/sdk) is the live npm version; 0.1.1 passes `prepublishOnly` + `npm pack --dry-run` but is not yet published) | [packages/verdictpay-sdk](../packages/verdictpay-sdk) |

## Proprietary runtimes we do not have and do not fake

| Product | Status | Open replacement in VerdictPay |
|---|---|---|
| **Bryntum Scheduler** | **Not licensed, not bundled, not emulated.** A Bryntum-shaped `resources / events` data model is rendered with plain React + CSS grid. Swapping in Bryntum later is a component change, not a data-model rewrite. | [frontend/components/timeline/TimelineBoard.tsx](../frontend/components/timeline/TimelineBoard.tsx) (the file labels itself "Bryntum-shaped data model — Bryntum runtime not licensed, not emulated") |
| **AG Studio 3.0** | `ag-studio@3.0.0` + `ag-studio-react@3.0.0` are on npm (Commercial license; they pull `ag-grid-enterprise`/`ag-grid-react` 36.2 next to our 34.3.1). A compile spike against `next@15.5.29` + `react@19.1.10` passed `tsc --noEmit` and `next build` (2026-11-10), but the app does not ship AG Studio: no license key is configured, so the Treasury views use **AG Grid Community** plus custom gauges. | Not used at runtime. The spike is documented here, not claimed as a feature. |

## Demo guarantees that keep these claims honest

* The judge demo runs against **real PayPal Sandbox**: `PAYPAL_MODE=PAYPAL_SANDBOX` is the
  default in [backend/app/config.py](../backend/app/config.py), and the E2E flow
  ([backend/scripts/e2e_demo.py](../backend/scripts/e2e_demo.py)) exercises that same gateway.
* The SDK's HMAC rule is byte-identical to the backend's
  [compute_signature](../backend/app/security.py) — the SDK test suite and a cross-language
  smoke check verify the same vector.
* No sponsor integration sits on the money path except the deterministic PayPal gateway; an
  optional adapter (Elastic, OpenAI narrative) being down can never change an EV number.
