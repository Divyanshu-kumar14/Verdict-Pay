# Live PayPal mode

VerdictPay ships two implementations of the same `PayPalGateway` protocol:

| `PAYPAL_MODE` | Gateway | Network | Use |
|---|---|---|---|
| `simulator` (default) | `SimulatorPayPalGateway` | none | demo, tests, judge laptops without accounts |
| `live` | `LivePayPalGateway` | `api-m.sandbox.paypal.com` | proving the real REST integration |

The domain layer never imports `httpx`. Live mode changes only the seam at
[`backend/app/integrations/paypal/live.py`](../backend/app/integrations/paypal/live.py): OAuth2
client-credentials with a cached token, idempotency keys on writes, bounded retries and the real
Disputes v1, Orders v2, Subscriptions v1, Reporting v1 and Notifications v1 shapes.

`PAYPAL_MODE=live` means "call the real PayPal API". The base URL is
`PAYPAL_API_BASE` and defaults to PayPal's sandbox host, so a sandbox application exercises the
production code path without moving real money.

## Run it

1. Create a sandbox app at <https://developer.paypal.com/dashboard/applications/sandbox> and copy
   its client ID and secret. Create a sandbox buyer account at the same dashboard; Orders v2 can
   create an order without one, but approving it needs a buyer login.
2. Put the two values in the gitignored `.env` at the repository root:

   ```dotenv
   PAYPAL_MODE=live
   PAYPAL_CLIENT_ID=<sandbox app client id>
   PAYPAL_CLIENT_SECRET=<sandbox app secret>
   ```

   Do not commit `.env`; it is ignored by git and by the Docker build context. Never paste
   credentials into a shell command, an issue, a screenshot or a test fixture.
3. Run the gate (it forces live mode for that command only, so `make stack` stays deterministic):

   ```bash
   make verify-live
   ```

   It performs three checks:

   1. OAuth2 token plus `GET /v1/customer/disputes` (0 disputes is a pass);
   2. `search_transactions` over the Reporting API (reporting must return HTTP 200, including
      an empty result on a fresh account);
   3. `GET /v1/customer/disputes/{id}` for the first dispute, when one exists.

   Expected tail: `LIVE PAYPAL CHECK PASSED`.

The offline gate is unchanged: `cd backend && uv run pytest -q` replays every live-mode call with
`respx` and never touches the network. The live-specific contract tests are in
[`backend/tests/unit/test_paypal_live.py`](../backend/tests/unit/test_paypal_live.py).

## Reporting v1 constraints (and the fixes)

PayPal's Reporting API rejects several intuitive requests with HTTP 400. `search_transactions`
now handles all four constraints:

1. **Date format.** `datetime.isoformat()` produces `2025-01-01T00:00:00+00:00`, which PayPal
   rejects. The client sends second-precision UTC in PayPal's compact form,
   `%Y-%m-%dT%H:%M:%S+0000` (`...Z` is also accepted). Microseconds are dropped before
   chunking so window boundaries stay stable.
2. **No `payer_id` query parameter.** Adding it returns
   `400 Request is not well-formed`. The client sends only `start_date`, `end_date`,
   `fields=transaction_info,payer_info`, `page_size` and `page`, then filters the parsed
   `transaction_details` by `payer_info.payer_id` client-side.
3. **31-day window limit.** Any range greater than 31 days returns
   `400 Date range is greater than 31 days`; exactly 31 days is allowed. CE 3.0 lookbacks of
   120-365 days are therefore split into contiguous windows of at most 31 days and merged.
4. **Pagination.** `page_size` is capped at 500. The client follows `total_pages` (bounded to 10
   pages per window as a safety cap) and deduplicates the merged result by `transaction_id`.

A 365-day lookback becomes 12 windows; a repeated transaction that straddles a page or window
boundary is returned once.

## Orders v2: create an order

`LivePayPalGateway.create_order` posts to `POST /v2/checkout/orders`. The legacy
`/v1/checkout/orders` path exists but expects the old `transactions` array, so a valid
`purchase_units` body fails with a misleading
`VALIDATION_ERROR ... #/purchase_units/0/amount INVALID_PARAMETER_SYNTAX`. That endpoint bug is
fixed and covered by a `respx` test.

A real sandbox call (no credentials shown) mapped as:

```text
order_id:     9P139697GE712382K
status:       CREATED
amount:       10.00 USD
payer_id:     YRZ829104KLA
approval_url: https://www.sandbox.paypal.com/checkoutnow?token=<order id>
```

The approval URL comes from the response's `rel=approve` link, falling back to the checkout host
that matches `PAYPAL_API_BASE` (sandbox vs production). Creating an order is not a payment: no
buyer approved this one, so it remains `CREATED` in the sandbox dashboard.

## What cannot be tested without a buyer account

These calls are implemented, unit-tested with `respx`, and deliberately not claimed as live-proven:

- **`create_sandbox_dispute`.** Filing a dispute requires a buyer identity, a real funded sandbox
  transaction and the buyer-side flow. The client sends `PayPal-Auth-Assertion`, but a seller app
  alone cannot conjure a buyer dispute. A fresh account legitimately has 0 disputes, which is why
  `make verify-live` treats "0 readable" as a pass and skips check 3.
- **Webhook verification.** `verify_webhook` calls PayPal's
  `/v1/notifications/verify-webhook-signature`. A `SUCCESS` needs a webhook registered for the
  app and a genuine PayPal-signed delivery, which needs a buyer action or subscription event.
  Without those, only the failure paths and the request shape can be exercised locally.
- **Evidence submission.** `provide_evidence` needs an open dispute that is actually waiting for
  seller evidence, plus the multipart document set. With no live dispute there is no valid target.
- **Payment capture/refund and subscription suspension.** These need an approved order/buyer
  agreement in the sandbox account. Order creation alone does not produce one.
- **Reporting rows.** A fresh sandbox app has no transactions, so the Reporting check verifies the
  request contract (HTTP 200, chunking, pagination) rather than non-empty data. Make a sandbox
  payment between two sandbox accounts to populate it.

## Rotate your credentials

Sandbox secrets still deserve rotation hygiene: they are bearer credentials for the app and can
leak through screen shares, terminal history or copied `.env` files. Rotate them when:

- a secret was ever displayed, pasted, committed or shared;
- a demo or recording is finished and the machine is handed to someone else;
- a teammate with access leaves the project.

To rotate: open the PayPal Developer Dashboard, select the sandbox app, regenerate the secret,
update the gitignored `.env`, and re-run `make verify-live`. The live gateway caches the OAuth
access token in memory only, never writes it to disk, and clears it on `close()`. The client never
logs the token or the secret, and upstream errors are reduced to PayPal's error name/message plus
the debug ID (which is not a credential).

## Current live status of this checkout

- `make verify-live`: **passed** — OAuth/dispute list 200 (0 disputes), Reporting 200 (0
  transactions, chunked 275-day lookback), single-dispute fetch skipped.
- One real Orders v2 `create_order`: **passed** — order `9P139697GE712382K`, status `CREATED`,
  sandbox approval URL returned. Not approved/captured.
- No dispute, webhook delivery or evidence submission was created; those remain fixture-only until
  a buyer account is wired in.
