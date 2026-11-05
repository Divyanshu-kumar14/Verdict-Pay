# @verdictpay/sdk

Pre-dispute telemetry for PayPal-backed SaaS, digital goods and metered AI apps.
Events are batched, HMAC-signed and appended to a per-payer SHA-256 hash chain, so
"the customer used it" is a verifiable system of record instead of a screenshot.

Node 20+ (or any runtime with `fetch` and WebCrypto). Zero runtime dependencies.
Ships ESM + CJS + TypeScript declarations.

## Install

```bash
pnpm add @verdictpay/sdk
```

## Quickstart

```ts
import { VerdictPayClient } from "@verdictpay/sdk";

const verdict = new VerdictPayClient({
  apiKey: process.env.VERDICTPAY_API_KEY!,
  webhookSecret: process.env.VERDICTPAY_SIGNING_SECRET!,
  // baseUrl defaults to http://localhost:8000
});

// 1. At checkout: bind the PayPal payer/order to the exact ToS they accepted.
verdict.trackCheckout({
  paypalPayerId: "YRZ829104KLA",
  paypalOrderId: "5O190127TN364715T",
  paypalSubscriptionId: "I-BW452GLLEP1G",
  userEmail: "alex@customer-startup.io",
  clientIp: req.headers["x-forwarded-for"] as string,
  deviceFingerprint: "fp_89a7c6d5e4f3",
  tosVersion: "v2.4-2026-01",
  tosContentSha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
});

// 2. In-product: prove the digital asset actually reached them.
verdict.trackDelivery({
  paypalPayerId: "YRZ829104KLA",
  resourceId: "export_q3_financial_model.xlsx",
  resourceSha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  computeUnitsConsumed: 1450,
});

// 3. Metered consumption: LLM tokens, API credits, seats, anything countable.
verdict.trackUsage({ paypalPayerId: "YRZ829104KLA", units: 42000 });

// 4. Before a dispute hearing (or in a cron), force-send everything buffered.
await verdict.flush();

// 5. Prove the ledger was not rewritten after the fact.
const chain = await verdict.verifyChain("YRZ829104KLA");
if (!chain.valid) throw new Error("ledger tampered at sequence " + chain.broken_at_sequence);
```

## API

### `new VerdictPayClient(options)`

| Option | Default | Meaning |
|---|---|---|
| `apiKey` | required | Sent as `X-API-Key`. Never logged. |
| `webhookSecret` | required | HMAC-SHA256 signing secret (`VERDICTPAY_SIGNING_SECRET`). Never logged. |
| `baseUrl` | `http://localhost:8000` | Absolute http(s) API root, no query/fragment. |
| `fetch` | `globalThis.fetch` | Inject a fetch implementation for tests or edge runtimes. |
| `maxRetries` | `3` | Retries after the first attempt (0-10). |
| `timeoutMs` | `10000` | Per-attempt timeout (1-120000). |
| `batchSize` | `10` | Events per request (1-500, the server cap). |
| `flushIntervalMs` | `5000` | Background flush interval (1-3600000). |

Invalid options throw `VerdictPayError` with code `invalid_config` before any
network call. The constructor never logs and never puts the key in an error.

### Methods

| Method | Wire event | Notes |
|---|---|---|
| `trackCheckout(input)` | `TOS_ACCEPTED` | Requires `tosVersion` and `tosContentSha256`; `userEmail` goes into `metadata.user_email`. |
| `trackDelivery(input)` | `ASSET_DELIVERED` | Requires `resourceId` + `resourceSha256`; `computeUnitsConsumed` becomes `units_consumed`. |
| `trackUsage(input)` | `USAGE_METERED` | Requires a non-negative integer `units`. |
| `trackEvent(event)` | caller chooses | Low-level typed event, e.g. `SESSION_AUTH` with custom `metadata`. |
| `flush()` | — | Sends every buffered event now. Resolves to `{ accepted, duplicates, events, chain }`; on failure the batch is re-buffered and a typed error is thrown. |
| `verifyChain(payerId)` | — | `GET /api/v1/telemetry/chain/{payerId}/verify`. |

`clientIp` defaults to `0.0.0.0` and `deviceFingerprint` to `sdk-unknown-device`
when omitted; pass real values — seller protection turns on IP and device match.
Event ids are generated with `crypto.randomUUID()` at enqueue time, so a retried
batch is deduplicated by the server instead of double-counted.

### Batching and delivery

* Events buffer in memory and flush when `batchSize` is reached **or** every
  `flushIntervalMs`; the timer is `unref()`ed so it never holds a process open.
* `POST {baseUrl}/api/v1/telemetry/events` with body `{"events":[...]}`.
* `429` and `5xx` are retried `maxRetries` times with exponential backoff and
  jitter. Other `4xx` responses fail immediately.
* Network failures and timeouts are retried under the same policy.
* A failed batch stays buffered, so the next `flush()` or timer retries it.
* The SDK is fire-and-forget by design; call `flush()` before process exit if the
  last few seconds of telemetry matter.

### Signing

Every ingest request carries:

```
X-API-Key: <apiKey>
X-VerdictPay-Timestamp: <unix seconds>
X-VerdictPay-Signature: hex(HMAC-SHA256(webhookSecret, "<unixSeconds>.<exactBody>"))
```

The signature covers the exact JSON body bytes sent, and the API verifies it against
the raw request bytes before parsing: unsigned ingest is rejected with
`signature_required`, a bad or stale signature with `signature_invalid` (the timestamp
window is ±300 seconds). Replay protection comes from the stable `event_id` on every
event. The same rule is implemented in `backend/app/security.py:compute_signature`.

### Errors

```ts
import { VerdictPayError, isVerdictPayError } from "@verdictpay/sdk";

try {
  await verdict.flush();
} catch (error) {
  if (isVerdictPayError(error)) {
    switch (error.code) {
      case "invalid_config":   // bad options, thrown from the constructor
      case "validation_error": // bad input, or the API returned a contract violation
      case "unauthorized":     // 401/403, never retried
      case "rate_limited":     // 429 after the retry budget
      case "server_error":     // 5xx after the retry budget
      case "network_error":    // timeout or transport failure after the retry budget
    }
  }
}
```

`status`, `requestId` and `details` are attached when available.

## Scripts

```bash
pnpm install
pnpm test        # vitest: buffering, HMAC, retries, error taxonomy
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup -> dist/index.js, dist/index.cjs, dist/index.d.ts
```

## Contract source of truth

Event shapes, response bodies and error codes mirror the frozen contract in
`backend/app/api/schemas.py` and `backend/app/domain/enums.py`. If the backend
changes, this package and the frontend zod parsers change in the same commit.
