# APIMatic Context Plugin findings (Disputes v1 and Trackers v1)

For Devpost field 28793 (Best Use of APIMatic). Checked on 2026-11-10.

## What was checked

- The PayPal Context Plugin listed in APIMatic's marketplace
  (`https://context.apimatic.io/llms.txt` → "PayPal API", plugin `paypal` **v0.4.1**, updated
  2026-10-12, MIT, "built from the published spec only").
- Its source: `github.com/context-plugins/plugin-marketplace/plugins/paypal` (skills for .NET,
  Python and TypeScript) and the SDK it grounds agents in,
  `github.com/context-plugins/paypal-python-sdk` at commit `143e57f` (2026-10-13).

We read the plugin and SDK source directly; we did not run the plugin inside an agent session.

## Findings

| Area | What the plugin/SDK covers | Consequence for VerdictPay |
|---|---|---|
| API modules | `orders`, `payments`, `subscriptions`, `transaction_search`, `vault` (`paypal/apis/*.py`) | Orders v2 checkout/capture, Reporting v1 transaction search and Subscriptions v1 suspend are covered. |
| **Disputes v1** (`/v1/customer/disputes/*`) | **No API module.** Only a `DisputeCategory` enum model exists. | An agent grounded only in this plugin cannot generate `accept-claim`, `make-offer`, `provide-evidence`, `send-message`, `escalate`, `appeal` or `adjudicate` calls. VerdictPay keeps its own typed Disputes v1 client (`backend/app/integrations/paypal/live.py`) and the `multipart/related` evidence builder (`backend/app/domain/evidence/multipart.py`). |
| **Trackers** | No `/v1/shipping/trackers-batch`. Shipment tracking is exposed on Orders v2: `create_order_tracking` → `POST /v2/checkout/orders/{id}/track` and `update_order_tracking`, with `OrderTrackerRequest {capture_id (required), tracking_number, carrier, carrier_name_other, notify_payer, items}`. | VerdictPay calls the Trackers v1 batch endpoint (`add_trackers`) for legacy capture ids. For orders created through Orders v2 the plugin's grounded path is `/v2/checkout/orders/{id}/track`, which requires `capture_id`. **Out of scope for this release** (see Scope note below). |
| Error handling | SDK-level typed errors and retry configuration skills | Matches our approach (bounded retries on 429/5xx, `PayPal-Request-Id` idempotency). Disputes-specific `ERRDIS*` codes are not modelled. |
| Hazard comparison | — | `@paypal/agent-toolkit@1.11.0` exposes only three dispute tools; the APIMatic plugin exposes none. Neither grounds an agent in the seller dispute FSM, which is why VerdictPay routes every dispute write through the Sentinel (`docs/cliffguard.md`). |

## How to reproduce

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/context-plugins/plugin-marketplace.git
cd plugin-marketplace && git sparse-checkout set plugins/paypal && grep -rli dispute plugins/paypal   # no matches
git clone --depth 1 --filter=blob:none --no-checkout https://github.com/context-plugins/paypal-python-sdk.git
cd paypal-python-sdk && git ls-tree -r --name-only HEAD | grep -E "apis/|dispute|tracker"
```

## Scope note: intentionally out of scope for this release

1. **`POST /v2/checkout/orders/{id}/track`.** VerdictPay sells digital goods — there is
   no shipment, no carrier, no tracking number. The Trackers v1 batch endpoint already
   covers legacy capture IDs. Adding an Orders v2 track call would require threading
   `capture_id` through the order lifecycle for zero demo value: the judge flow never
   ships a physical good, and no Sentinel check reads tracking state. If a physical-goods
   merchant adopts the product, this is the first integration to add.

2. **Multi-turn `_messages` ingestion in the AI layer.** PayPal dispute `_messages` are
   already parsed (`app/integrations/paypal/wire.py:parse_messages`) and persisted into
   `case.facts_snapshot` (`_MESSAGES_SNAPSHOT_KEY`). No multi-turn conversation logic
   exists because the AI layer is single-shot classify-and-draft by design ("AI explains
   and drafts; rules decide"). Multi-turn state would add LLM session management with no
   grounding benefit: every draft is already validated against the frozen fact pack, and
   a second turn cannot add a fact the validator would accept.
