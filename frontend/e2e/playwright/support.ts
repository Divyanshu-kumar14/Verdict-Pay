/**
 * Shared plumbing for the Playwright E2E layer.
 *
 * Everything here talks to the REAL demo stack: FastAPI on 8000 (PayPal simulator
 * mode) and the Next.js build on 3000. Nothing is mocked, because the whole point of
 * the judge suite is to prove the integrated system works — a mocked test would prove
 * only that the mocks agree with each other.
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

/** Drive an order to CAPTURED via the simulator's explicit buyer-approval step. */
export async function capture(
  request: APIRequestContext,
  orderId: string,
): Promise<{ status: number; body: Json }> {
  return postJson(request, `/sandbox/orders/${orderId}/capture`, {});
}

export async function approve(
  request: APIRequestContext,
  orderId: string,
): Promise<{ status: number; body: Json }> {
  return postJson(request, `/sandbox/orders/${orderId}/approve`, {});
}

export const USAGE_EVENTS = [
  { event_type: "TOS_ACCEPTED", occurred_at: "2026-11-06T18:00:00Z" },
  { event_type: "SESSION_AUTH", occurred_at: "2026-11-06T18:00:01Z" },
  { event_type: "ASSET_DELIVERED", occurred_at: "2026-11-06T18:00:02Z" },
  { event_type: "USAGE_METERED", occurred_at: "2026-11-06T18:00:03Z" },
];

/** Ingest the four-event usage chain for an order that has already been captured. */
export async function ingestUsage(
  request: APIRequestContext,
  order: Checkout,
): Promise<Json> {
  const { status, body } = await postJson(request, "/sandbox/usage", {
    payer_id: order.payer_id,
    order_id: order.order_id,
    run_id: order.run_id,
    events: USAGE_EVENTS,
  });
  if (status !== 200) {
    throw new Error(`POST /sandbox/usage -> HTTP ${status}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

/** Open an INQUIRY through the internal signed-webhook path for a captured order. */
export async function fileDispute(
  request: APIRequestContext,
  order: Checkout,
  overrides: Json = {},
): Promise<Json> {
  const { status, body } = await postJson(request, "/sandbox/dispute", {
    payer_id: order.payer_id,
    order_id: order.order_id,
    run_id: order.run_id,
    stage: "INQUIRY",
    reason_code: "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
    amount_usd: order.amount_usd,
    ...overrides,
  });
  if (status !== 200) {
    throw new Error(`POST /sandbox/dispute -> HTTP ${status}: ${JSON.stringify(body).slice(0, 800)}`);
  }
  return body;
}

/**
 * A full, self-contained judge run: order -> (refused capture) -> approval -> capture ->
 * telemetry -> dispute. Returns every identifier the later assertions need, so a test
 * that only cares about the dossier does not have to re-drive the whole flow.
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
  await approve(request, order.order_id);
  const captured = await capture(request, order.order_id);
  if (captured.status !== 200) {
    throw new Error(`capture failed: ${JSON.stringify(captured.body).slice(0, 600)}`);
  }
  const usage = await ingestUsage(request, order);
  const dispute = await fileDispute(request, order);
  const summary = dispute.dispute as Json;
  return {
    order,
    captureId: String(captured.body.capture_id),
    disputeId: String(summary.dispute_id),
    webhookEventId: String(dispute.webhook_event_id),
    usage,
  };
}

/**
 * The HMAC secret the API verifies webhooks with.
 *
 * Read from the environment, else from the repo `.env` that the API process itself
 * loads — a webhook test that cannot sign is a webhook test that proves nothing. The
 * value is never logged, never asserted on, and never written to a report; only the
 * resulting signature travels.
 */
let cachedSecret: string | null = null;

export async function webhookSecret(): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const fromEnv = process.env.VERDICTPAY_WEBHOOK_SECRET;
  if (fromEnv && fromEnv.length >= 8) {
    cachedSecret = fromEnv;
    return cachedSecret;
  }
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  // frontend/ -> repo root
  const envPath = join(process.cwd(), "..", ".env");
  let text: string;
  try {
    text = await readFile(envPath, "utf8");
  } catch (error) {
    throw new Error(
      `E2E BLOCKED: no VERDICTPAY_WEBHOOK_SECRET in the environment and ${envPath} is unreadable ` +
        `(${error instanceof Error ? error.message : String(error)}). ` +
        "The signed-webhook scenarios need the same secret the API process verifies with.",
    );
  }
  for (const line of text.split("\n")) {
    const match = /^\s*VERDICTPAY_WEBHOOK_SECRET\s*=\s*(.+?)\s*$/.exec(line);
    if (match && match[1]) {
      cachedSecret = match[1].replace(/^["']|["']$/g, "");
      return cachedSecret;
    }
  }
  throw new Error(`E2E BLOCKED: VERDICTPAY_WEBHOOK_SECRET is not defined in ${envPath}.`);
}

/** Deterministic body bytes so the signature covers exactly what is sent. */
export function webhookBody(payload: Json): string {
  return JSON.stringify(payload);
}

/** HMAC-SHA256 over `timestamp.body`, exactly as `app/security.py:compute_signature`. */
export async function signWebhook(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const { createHmac } = await import("node:crypto");
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

/** A PayPal-shaped dispute event, used for the signed/replay scenarios. */
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

/** Deliver one signed webhook. Returns the status and decoded body. */
export async function deliverWebhook(
  request: APIRequestContext,
  payload: Json,
): Promise<{ status: number; body: Json }> {
  const secret = await webhookSecret();
  const body = webhookBody(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signWebhook(secret, timestamp, body);
  const response = await request.post(`${API_BASE}/api/v1/webhooks/paypal`, {
    headers: {
      ...AUTH_HEADERS,
      "Content-Type": "application/json",
      "X-VerdictPay-Timestamp": timestamp,
      "X-VerdictPay-Signature": signature,
    },
    data: body,
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
    "cd backend && DATABASE_URL=sqlite+aiosqlite:////tmp/verdictpay-demo.db PAYPAL_MODE=simulator " +
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
