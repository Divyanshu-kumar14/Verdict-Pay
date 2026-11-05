# Backend adversarial QA — VerdictPay demo API

Date: 2026-11-06 (Asia/Calcutta)
Author: backend-paypal (independent QA, read-only against other agents' code)
Scope: the running FastAPI demo API (simulator gateway, template narrative, SQLite), seeded and booted exactly as the judge demo would be.

Verdict: 36 checks executed, 34 passed, 2 real bugs found (both outside backend-paypal's files; reported here, not fixed).

## Environment

~~~
cd backend
rm -rf .demo-qa && mkdir .demo-qa
DATABASE_URL="sqlite+aiosqlite:///./.demo-qa/qa.db" PAYPAL_MODE=simulator uv run python scripts/seed_demo.py --reset
DATABASE_URL="sqlite+aiosqlite:///./.demo-qa/qa.db" PAYPAL_MODE=simulator uv run python -m uvicorn app.main:app --host 127.0.0.1 --port 8124 --log-level warning
~~~

- Five seeded disputes (PP-D-40001..40005), 200 sales rows, 15 CE 3.0 lookback rows.
- No .env file present, so defaults applied: API key vp_demo_sk_local, webhook secret dev-webhook-secret-change-me, simulator gateway, template narrative, local env (unsigned webhooks disabled).
- Requests were issued with httpx/curl against http://127.0.0.1:8124. Placeholders in the cURLs: $API_KEY = the demo API key, $TS/$SIG = a current X-VerdictPay-Timestamp and its HMAC-SHA256 over "<ts>.<body>".
- The QA database was recreated from scratch. No other agent's file was changed; only this report was written.

## Findings (real bugs)

| # | Severity | Endpoint | Exact reproduction | Observed | Expected | Real bug? |
|---|---|---|---|---|---|---|
| F1 | high | POST /api/v1/telemetry/events | Build a 300 KB valid event as a file (single SESSION_AUTH event whose metadata blob is "x" * 300000), then: curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/telemetry/events' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' -H 'Transfer-Encoding: chunked' --data-binary @/tmp/big.json | HTTP 200 and the event was appended: accepted=1, chain event_count went 5 -> 6. The 256 KB cap was not enforced because the request carried no Content-Length. | HTTP 413 with error.code=payload_too_large, regardless of Content-Length vs Transfer-Encoding. | YES |
| F2 | high | POST /api/v1/disputes/{id}/actions/SEND_MESSAGE | Run this twice concurrently (two separate connections/clients) with the same body on an INQUIRY case: curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/disputes/PP-D-40005/actions/SEND_MESSAGE' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' --data-raw '{"note":"QA concurrent idempotency","idempotency_key":"qa-race-idem-2"}' | Responses were [500, 200]. The 500 body was {"error":{"code":"internal_error","message":"An unexpected error occurred.",...}}. Server log: sqlalchemy.exc.IntegrityError UNIQUE constraint failed: dispute_actions.idempotency_key. Both requests passed the pre-dispatch idempotency lookup and both called the gateway: the committed row records MSG-005, the failed INSERT attempted MSG-006, and a follow-up message got MSG-007 (gap of 2, so the duplicate message was really sent). One audit row exists for the key (unique constraint held). | Both requests return the same action_id/upstream 200 (replay semantics) or the loser returns a 409 conflict; the gateway is called exactly once; no 500. | YES |

F1 belongs to backend/app/main.py (RequestContextMiddleware only inspects the Content-Length header). F2 belongs to backend/app/services/dispute_service.py (execute_action does a read-then-act idempotency check and does not handle IntegrityError on the final commit, so the action is dispatched before the unique key is enforced).

### F1 — 256 KB body cap bypass via chunked transfer encoding (high)

- Normal oversized request with Content-Length: 300,000-byte body returned HTTP 413 with error.code=payload_too_large (this part is correct; see the passing checks table).
- Chunked request (no Content-Length): HTTP 200, accepted=1, the ledger appended the event (event_count 5 -> 6). The middleware's cap is header-based, and FastAPI then read the full 300 KB body.
- Impact: the documented ingestion cap in IMPLEMENTATION_PLAN.md section 10 ("Ingestion: 256 KB body cap") is bypassable by any client that streams a request; this is a memory/CPU/DoS surface and breaks the stated contract.
- Suggested fix: enforce the cap on bytes actually read, not only on the header. For example wrap the ASGI receive channel (or read the body with a hard limit and return 413) so chunked bodies are counted; add a regression test that posts a 300 KB chunked body and expects 413. The test must use a transport that omits Content-Length (httpx async generator or a raw socket). Owner: backend-api.

### F2 — Concurrent idempotency-key race: duplicate gateway call + 500 (high)

- Two concurrent SEND_MESSAGE calls with the same idempotency_key both missed the existing-action lookup (no row existed yet), both dispatched to the gateway, and both tried to insert the audit row. One insert won, the other raised sqlite3.IntegrityError UNIQUE constraint failed: dispute_actions.idempotency_key, which escaped all handlers and produced HTTP 500 internal_error.
- Evidence chain: committed action row has response_payload message_id MSG-005; the IntegrityError parameters in the server log show the failed INSERT carried MSG-006; a follow-up message with a different key returned MSG-007. So the simulator/PayPal boundary was called twice for one idempotency key even though only one audit row survived.
- The client also saw one httpx.ReadError around the 500 during the first reproduction (connection reset), which is a symptom, not a separate finding.
- Impact: a double-click, a client retry, or two concurrent pollers can send a duplicate buyer-facing message (and, for MAKE_OFFER, a duplicate offer). The action audit then lies about the gateway having been called once. The 500 also violates the "no bare 500s" quality bar, even though the error envelope itself was well-formed.
- Suggested fix: make the idempotency claim transactional and serialized, for example INSERT the action row with status IN_PROGRESS and the idempotency_key first (the unique constraint becomes the lock), then dispatch, then update the row; on IntegrityError roll back, load the existing row, and either replay it (200) or return 409 Conflict. For SEND_MESSAGE specifically, do not call the gateway before the idempotency claim is committed. Add a concurrent regression test (two tasks, same key, assert one gateway call and no 500). Owner: backend-api.

## Passing checks (34)

Placeholders: $API_KEY = demo API key, $TS/$SIG = valid timestamp/HMAC pair, {id} = a real seeded dispute id. "Observed" is abbreviated; full JSON bodies were captured with the same script.

| # | Severity | Check | Endpoint / exact curl (short) | Observed |
|---|---|---|---|---|
| 1 | low | Health | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/health' | 200; status=ok, mode=simulator, gateway=simulator, timestamp ends with Z |
| 2 | low | Seed loaded | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes' -H 'X-API-Key: $API_KEY' | 200; meta total=5, total_pages=1 |
| 3 | blocker | Webhook replay (CUSTOMER.DISPUTE.CREATED) | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/webhooks/paypal' -H 'X-VerdictPay-Timestamp: $TS' -H 'X-VerdictPay-Signature: $SIG' -H 'Content-Type: application/json' --data-raw '{"id":"WH-QA-REPLAY-1","event_type":"CUSTOMER.DISPUTE.CREATED","resource_type":"dispute","summary":"QA replayed dispute event","resource":{"dispute_id":"PP-D-40005"}}' (twice) | first 200 duplicate=false; replay 200 duplicate=true; cases 5 -> 5; actions 0 -> 0 |
| 4 | blocker | Tampered webhook signature | same curl, body altered after signing | 401; error.code=webhook_verification_failed, message=signature_mismatch |
| 5 | blocker | Unsigned webhook | same body, no signature headers | 401; error.code=webhook_verification_failed, message=missing_signature_headers |
| 6 | blocker | provide-evidence on INQUIRY | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/disputes/PP-D-40005/actions/PROVIDE_EVIDENCE' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' --data-raw '{"note":"QA evidence attempt"}' | 422; error.code=illegal_dispute_action, reason=require-evidence_link_missing |
| 7 | medium | Unknown action value | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/disputes/PP-D-40005/actions/EXPLODE' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' --data-raw '{}' | 422; error.code=validation_error, field path.action |
| 8 | medium | Unknown dispute id | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes/PP-D-99999' -H 'X-API-Key: $API_KEY' | 404; error.code=not_found |
| 9 | high | 300 KB body with Content-Length | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/telemetry/events' -H 'X-API-Key: $API_KEY' --data-binary '<300000 bytes>' | 413; error.code=payload_too_large; message "Body exceeds 262144 bytes." |
| 10 | blocker | Sequential same idempotency_key on SEND_MESSAGE | the F2 curl run sequentially (key qa-send-idem-1) | both 200; same action_id and upstream; simulator MSG-001 for first, next new key got MSG-002 (one gateway call); one new audit row |
| 11 | blocker | Dossier.pdf secret hygiene and proof | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes/PP-D-40003/dossier.pdf' -H 'X-API-Key: $API_KEY' -o dossier.pdf | 200 application/pdf; 7,118 bytes; 3 pages; pypdf text contains payer_id YRZ902117KTM and the exact chain head; none of API key, signing secret, webhook secret, OpenAI key, Elastic key appear |
| 12 | medium | Pagination page=0 | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes?page=0' -H 'X-API-Key: $API_KEY' | 422; error.code=validation_error; query.page greater_than_equal |
| 13 | medium | Pagination per_page=1000 | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes?per_page=1000' -H 'X-API-Key: $API_KEY' | 422; error.code=validation_error; query.per_page less_than_equal 100 |
| 14 | medium | Pagination beyond end | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes?page=999' -H 'X-API-Key: $API_KEY' | 200; data=[]; meta total=5, page=999, per_page=20, total_pages=1 |
| 15 | high | Telemetry batch of 501 | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/telemetry/events' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' --data-raw '{"events":[<501 events>]}' | 422; error.code=validation_error; body.TelemetryBatchIn.events too_long (max 500) |
| 16 | medium | Bad resource_sha256 pattern | POST /api/v1/telemetry/events with resource_sha256="ZZZ" | 422; error.code=validation_error; body.TelemetryEventIn.resource_sha256 string_pattern_mismatch |
| 17 | high | X-API-Key in query string (disputes) | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes?X-API-Key=$API_KEY' | 401; error.code=unauthorized; query credentials ignored |
| 18 | high | X-API-Key in query string (telemetry) | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/telemetry/chain/YRZ829104KLA/verify?X-API-Key=$API_KEY' | 401; error.code=unauthorized |
| 19 | high | Datetime timezone offsets | GET health, disputes, dispute detail, customer timeline, reporting summary, reporting transactions | 82 datetime strings inspected; 82 end with Z or +00:00; 0 naive. Example: seller_response_due_date "2026-11-15T20:45:26.492544Z". The earlier timezone concern appears fixed. |
| 20 | blocker | 20x health + 5x dispute concurrently | python asyncio.gather(20 GET /health, 5 POST /sandbox/dispute) | 20/20 health 200 and 5/5 disputes 200 in 0.09 s; no 500; no deadlock; health still 200 afterwards |
| 21 | blocker | 5x duplicate webhook concurrently | 5 identical signed POSTs with event id WH-QA-RACE-2 | all 200; exactly one duplicate=false, four duplicate=true; cases 10 -> 10 (no extra case) |
| 22 | high | Stale webhook timestamp | signed body with X-VerdictPay-Timestamp = now - 301 s | 401; error.code=webhook_verification_failed, message=timestamp_outside_tolerance |
| 23 | medium | Malformed JSON with valid signature | signed body "{not-json" | 401; error.code=webhook_verification_failed, message=invalid_json (not 500) |
| 24 | high | Same event id, different resource | replay WH-QA-REPLAY-1 with resource.dispute_id=PP-D-40010 | 200 duplicate=true; response dispute_id stays PP-D-40005; target case status/stage/actions unchanged |
| 25 | medium | Action on unknown dispute | curl -sS -i -X POST 'http://127.0.0.1:8124/api/v1/disputes/PP-D-99999/actions/SEND_MESSAGE' -H 'X-API-Key: $API_KEY' -H 'Content-Type: application/json' --data-raw '{"note":"nope"}' | 404; error.code=not_found |
| 26 | medium | Dossier for unknown dispute | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes/PP-D-99999/dossier.pdf' -H 'X-API-Key: $API_KEY' | 404; error.code=not_found |
| 27 | medium | offer_ratio=0 | POST /api/v1/disputes/PP-D-40010/actions/MAKE_OFFER body {"offer_ratio":"0"} | 422; error.code=validation_error; body.offer_ratio greater_than 0 |
| 28 | medium | offer_ratio=1.5 | same endpoint, body {"offer_ratio":"1.5"} | 422; error.code=validation_error; body.offer_ratio less_than_equal 1 |
| 29 | medium | note longer than 2000 | POST /api/v1/disputes/PP-D-40010/actions/SEND_MESSAGE with a 2001-char note | 422; error.code=validation_error; body.note string_too_long |
| 30 | high | Action on a closed case | POST .../PP-D-40004/actions/ACCEPT_CLAIM then .../actions/SEND_MESSAGE | accept 200 (case stage CLOSED, status RESOLVED); follow-up 422 error.code=illegal_dispute_action |
| 31 | high | Evidence on CHARGEBACK + replay | POST .../PP-D-40003/actions/PROVIDE_EVIDENCE body {"idempotency_key":"qa-evidence-1"} twice | 202 both times; same action_id; upstream documents ["VerdictPay_Dossier_PP-D-40003.pdf"]; one upload |
| 32 | medium | Bearer auth | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes' -H 'Authorization: Bearer $API_KEY' and wrong bearer | valid bearer 200; wrong bearer 401; error.code=unauthorized |
| 33 | high | SQL-injection-shaped path param | curl -sS -i -X GET 'http://127.0.0.1:8124/api/v1/disputes/PP-D-1%27%20OR%201%3D1' -H 'X-API-Key: $API_KEY' | 404; error.code=not_found; no SQL text/data leak (parameterized query) |
| 34 | low | Error envelope request_id | GET /api/v1/disputes/PP-D-99999 | 404 envelope; error.request_id equals the X-Request-Id response header |

## Additional notes

- The two 500s observed in the whole session are both the F2 idempotency race (one during the first reproduction, one during the confirmation). The API process stayed healthy throughout (health 200 before and after) and no other probe produced a 5xx.
- The 500 still used the documented envelope (error.code=internal_error with request_id), so no stack trace or internal detail leaked to the client; the traceback was only in server logs.
- Replay safety of webhooks is solid: both sequential and 5-way concurrent duplicate deliveries returned 200/duplicate=true with no extra case and no action rows.
- Dossier PDF: 3 pages, no configured secrets, correct payer id and chain head. pypdf extraction was successful.
- Concurrency: 25 mixed requests (20 health + 5 dispute-creating) completed in ~0.09 s on this laptop with no 500 and no lock-up; SQLite serialisation was fine for that profile. The idempotency race is a logic race, not SQLite lock pressure.
- Timing measurements are machine-dependent; they are reported only as a sanity signal, not as a performance benchmark.

## Suggested next actions (for the owner, not applied)

1. backend-api: fix F1 in app/main.py by enforcing the body cap on received bytes (wrap receive / read with a hard limit) and add a chunked-body regression test expecting 413.
2. backend-api: fix F2 in app/services/dispute_service.py by claiming the idempotency key atomically before dispatching (insert IN_PROGRESS row, or catch IntegrityError, roll back, load the existing row and return it/409); add a concurrent regression test asserting one gateway call and no 500.
3. Optional hardening: apply the same chunked-body cap test to the webhook endpoint, and add a composite guard for offer/accept idempotency identical to SEND_MESSAGE.

## Reproduction artifacts

- QA driver scripts: /tmp/qa_attack.py, /tmp/qa_attack3.py (ephemeral, run with PYTHONPATH=. from backend).
- Raw observations: /tmp/qa_results.json (19 checks) and /tmp/qa_results3.json (17 checks).
- QA database: backend/.demo-qa/qa.db was removed after the run to keep the tree clean; the seed and server commands above recreate it exactly.
