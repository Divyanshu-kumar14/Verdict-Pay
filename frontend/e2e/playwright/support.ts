/**
 * Shared plumbing for the Playwright E2E layer.
 *
 * Everything here talks to the REAL demo stack: FastAPI on 8000 (PayPal sandbox
 * mode) and the Next.js build on 3000. Nothing is mocked, because the whole point of
 * the judge suite is to prove the integrated system works — a mocked test would prove
 * only that the mocks agree with each other. PAYPAL_SANDBOX requires sandbox
 * credentials (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).
 *
 * Every helper takes the Playwright `APIRequestContext` so the same code works whether
 * a test drives the API directly (`request`) or a page's own XHRs land in the same
 * place.
 */

import type { APIRequestContext } from "@playwright/test";

export const API_BASE = (process.env.E2E_API_BASE_URL ?? "http://127.0.0.1:8000").replace(
  /\/+$/,
  "",
);

/**
 * Public-by-design demo key. It is intentionally shipped to the browser (the app sends
 * it) and documented as such; `scripts/qa/secret_leak_check.py` whitelists exactly this
 * value so that a *real* key reusing the variable would still be reported as a leak.
 */
export const API_KEY = process.env.E2E_API_KEY ?? "vp_demo_sk_local";

export const AUTH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-API-Key": API_KEY,
};

export type Json = Record<string, unknown>;

/** One authenticated JSON call that fails loudly on a non-2xx status. */
export async function getJson(
  request: APIRequestContext,
  path: string,
  expected = 200,
): Promise<Json> {
  const response = await request.get(`${API_BASE}/api/v1${path}`, { headers: AUTH_HEADERS });
  const body = (await response.json()) as Json;
  if (response.status() !== expected) {
    throw new Error(
      `GET ${path} -> HTTP ${response.status()} (expected ${expected})\n${JSON.stringify(body).slice(0, 800)}`,
    );
  }
  return body;
}

/** POST variant; returns the status too so a test can assert a refusal. */
export async function postJson(
  request: APIRequestContext,
  path: string,
  data: unknown = {},
): Promise<{ status: number; body: Json }> {
  const response = await request.post(`${API_BASE}/api/v1${path}`, {
    headers: { ...AUTH_HEADERS, "Content-Type": "application/json" },
    data,
  });
  const text = await response.text();
  let body: Json = {};
  try {
    body = text.length === 0 ? {} : (JSON.parse(text) as Json);
  } catch {
    body = { raw: text };
  }
  return { status: response.status(), body };
}

/** `error.code` of the standard envelope, or a readable failure. */
export function errorCode(body: Json): string {
  const error = body.error;
  if (typeof error !== "object" || error === null) {
    throw new Error(`response has no error envelope: ${JSON.stringify(body).slice(0, 400)}`);
  }
  return String((error as Json).code);
}

export type Checkout = {
  order_id: string;
  run_id: string;
  payer_id: string;
  status: string;
  lifecycle_stage: string;
  gateway_mode: string;
  provenance: string;
  approval_url: string;
  amount_usd: string;
};

/** Create one sandbox order and normalise the fields the judge journey depends on. */
export async function createOrder(
  request: APIRequestContext,
  plan: "pro" | "scale" = "pro",
): Promise<Checkout> {
  const { status, body } = await postJson(request, "/sandbox/checkout", { plan });
  if (status !== 200) {
    throw new Error(`POST /sandbox/checkout -> HTTP ${status}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body as unknown as Checkout;
}

/** Drive an order to CAPTURED via the sandbox buyer-approval flow (approval_url, then capture). */
export async function capture(
  request: APIRequestContext,
  orderId: string,
): Promise<{ status: number; body: Json }> {
  return postJson(request, `/sandbox/orders/${orderId}/capture`, {});
}

/** Buyer approval is a human action in the PayPal UI — there is no approve endpoint.
 * This helper is kept as a throwing stub so tests that accidentally call it fail loudly
 * instead of silently succeeding. Tests that need an approved order must set
 * `E2E_APPROVED_ORDER_ID` and skip the approval step.
 */
export async function approve(
  _request: APIRequestContext,
  _orderId: string,
): Promise<{ status: number; body: Json }> {
  throw new Error(
    "Approve endpoint removed for real-PayPal-only: open approval_url and approve as sandbox buyer in PayPal UI, then capture",
  );
}

/** Ingest the four-event usage chain for an order that has already been captured.
 *
 * The backend `UsageRequest` schema takes `logins`, `tokens`, `export_name` — not
 * an `events` array. The chain is built server-side from those fields.
 */
export async function ingestUsage(
  request: APIRequestContext,
  order: Checkout,
  plan: "pro" | "scale" = "pro",
): Promise<Json> {
  const { status, body } = await postJson(request, "/sandbox/usage", {
    payer_id: order.payer_id,
    order_id: order.order_id,
    run_id: order.run_id,
    logins: 15,
    tokens: 42_000,
    export_name: "q3_financial_model.xlsx",
    plan,
  });
  if (status !== 200) {
    throw new Error(`POST /sandbox/usage -> HTTP ${status}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

/**
 * Open a dispute on the order via POST /sandbox/dispute. The API asks PayPal's
 * Disputes API first; if the sandbox app cannot create disputes it builds an
 * `internal_test_event` locally. Callers can read `origin` to tell which.
 */
export async function fileDispute(
  request: APIRequestContext,
  order: Checkout,
  overrides: Json = {},
): Promise<Json> {
  const { status, body } = await postJson(request, "/sandbox/dispute", {
    payer_id: order.payer_id,
    order_id: order.order_id,
    run_id: order.run_id,
    reason_code: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    stage: "INQUIRY",
    channel: "INTERNAL",
    amount_usd: "99.00",
    ...overrides,
  });
  if (status !== 200) {
    throw new Error(`POST /sandbox/dispute -> HTTP ${status}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

/**
 * A full, self-contained judge run: order -> (refused capture) -> telemetry -> dispute.
 * Returns every identifier the later assertions need, so a test that only cares about
 * the dossier does not have to re-drive the whole flow.
 */
export type JudgeRun = {
  order: Checkout;
  captureId: string;
  disputeId: string;
  webhookEventId: string;
  usage: Json;
};

export async function runJudgeFlow(request: APIRequestContext): Promise<JudgeRun> {
  const order = await createOrder(request);
  const usage = await ingestUsage(request, order);
  // Buyer approval and capture need a human in the PayPal UI, so they are not
  // scripted here; the dispute is opened directly on the uncaptured order.
  const dispute = (await fileDispute(request, order)) as {
    dispute: { dispute_id: string };
    webhook_event_id: string;
  };
  return {
    order,
    captureId: "",
    disputeId: dispute.dispute.dispute_id,
    webhookEventId: dispute.webhook_event_id,
    usage,
  };
}

/** A PayPal-shaped dispute event, used for the unsigned/replay scenarios. */
export function disputeEvent(eventId: string, disputeId: string, amount = "99.00"): Json {
  return {
    id: eventId,
    event_type: "CUSTOMER.DISPUTE.CREATED",
    resource_type: "dispute",
    summary: "A dispute was created",
    resource: {
      dispute_id: disputeId,
      reason: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
      dispute_life_cycle_stage: "INQUIRY",
      dispute_channel: "INTERNAL",
      status: "OPEN",
      dispute_amount: { currency_code: "USD", value: amount },
      payer: { payer_id: "YRZ829104KLA" },
      seller_transaction_id: "5O1PLAYWRIGHTE2E",
      seller_response_due_date: "2026-11-16T00:00:00Z",
      create_time: "2026-11-06T00:00:00Z",
      links: [
        { rel: "self", href: `https://api-m.sandbox.paypal.com/v1/customer/disputes/${disputeId}` },
      ],
    },
  };
}

/** Deliver one *unsigned* webhook. PayPal's verify-webhook-signature requires
 * the five PAYPAL-TRANSMISSION-* headers; without them the backend returns
 * `missing_transmission_headers` and rejects with `webhook_verification_failed`.
 * No HMAC forgery is attempted — the test asserts honest rejection.
 */
export async function deliverWebhook(
  request: APIRequestContext,
  payload: Json,
): Promise<{ status: number; body: Json }> {
  const response = await request.post(`${API_BASE}/api/v1/webhooks/paypal`, {
    headers: {
      ...AUTH_HEADERS,
      "Content-Type": "application/json",
    },
    data: payload,
  });
  const text = await response.text();
  let decoded: Json = {};
  try {
    decoded = text.length === 0 ? {} : (JSON.parse(text) as Json);
  } catch {
    decoded = { raw: text };
  }
  return { status: response.status(), body: decoded };
}

/** Fail with remediation steps when the stack is not up, never with `fetch failed`. */
export async function assertStackReachable(request: APIRequestContext): Promise<void> {
  const url = `${API_BASE}/api/v1/health`;
  const start =
    "cd backend && DATABASE_URL=sqlite+aiosqlite:////tmp/verdictpay-demo.db PAYPAL_MODE=PAYPAL_SANDBOX " +
    "PAYPAL_CLIENT_ID=<sandbox-id> PAYPAL_CLIENT_SECRET=<sandbox-secret> " +
    ".venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000";
  let response;
  try {
    response = await request.get(url, { headers: AUTH_HEADERS, timeout: 5_000 });
  } catch (error) {
    throw new Error(
      `E2E BLOCKED: the VerdictPay API is unreachable at ${API_BASE}.\n` +
        `Cause: ${error instanceof Error ? error.message : String(error)}\n` +
        `Start it: ${start}`,
    );
  }
  if (!response.ok()) {
    throw new Error(`E2E BLOCKED: GET ${url} -> HTTP ${response.status()}. Start it: ${start}`);
  }
  const body = (await response.json()) as Json;
  if (typeof body.status !== "string" || typeof body.gateway_status !== "object") {
    throw new Error(
      `E2E BLOCKED: ${url} answered 200 but not with a VerdictPay health payload — ` +
        "another service may be bound to this port.",
    );
  }
}
