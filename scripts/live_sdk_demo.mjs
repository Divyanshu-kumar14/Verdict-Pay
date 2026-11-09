#!/usr/bin/env node
/**
 * Real-SDK demo: drive the built @verdictpay/sdk against a running API.
 *
 *   node scripts/live_sdk_demo.mjs
 *
 * The script uses the compiled SDK (packages/verdictpay-sdk/dist/index.js),
 * creates a checkout through POST /api/v1/sandbox/checkout, sends four signed
 * telemetry events to POST /api/v1/telemetry/events, flushes, and verifies the
 * per-payer hash chain. It exits non-zero on any failed assertion.
 *
 * Environment:
 *   VERDICTPAY_API_BASE_URL   default http://127.0.0.1:8000
 *   VERDICTPAY_API_KEY        default vp_demo_sk_local
 *   VERDICTPAY_SIGNING_SECRET default dev-signing-secret-change-me
 *   PAYPAL_MODE               informational; the running backend decides the gateway
 */

import { createHash } from "node:crypto";

import { VerdictPayClient } from "../packages/verdictpay-sdk/dist/index.js";

const API_BASE_URL = (
  process.env.VERDICTPAY_API_BASE_URL ??
  process.env.API_BASE_URL ??
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");
const API_KEY = process.env.VERDICTPAY_API_KEY ?? "vp_demo_sk_local";
const SIGNING_SECRET =
  process.env.VERDICTPAY_SIGNING_SECRET ?? "dev-signing-secret-change-me";
const PAYPAL_MODE = process.env.PAYPAL_MODE ?? "PAYPAL_SANDBOX";

/* Byte-identical to backend/app/api/routers/sandbox.py. */
const TOS_VERSION = "v2.4-2026-01";
const TOS_TEXT =
  "VerdictPay demo SaaS Terms of Service v2.4 (effective 2026-01-26). " +
  "Subscriptions renew monthly until cancelled. Digital deliverables and metered " +
  "AI usage are non-refundable once consumed. Chargebacks are governed by the " +
  "merchant's published refund policy.";
const DEMO_ASSET_PAYLOAD = "VerdictPay demo export payload::q3_financial_model";
const DEMO_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_CLIENT_IP = "203.0.113.42";
const DEFAULT_DEVICE_FINGERPRINT = "fp_89a7c6d5e4f3";
const EXPORT_NAME = "q3_financial_model.xlsx";
const EXPECTED_EVENT_COUNT = 4;

const sha256Hex = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const isHash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Fail with a single actionable line. */
function check(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** JSON request to the API with the demo key; failures keep the response text. */
async function apiJson(path, init = {}) {
  const response = await fetch(API_BASE_URL + path, {
    ...init,
    headers: {
      Accept: "application/json",
      "X-API-Key": API_KEY,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${init.method ?? "GET"} ${path} returned a non-JSON body`);
  }
}

async function main() {
  console.log("VerdictPay real-SDK demo");
  console.log(`  API       : ${API_BASE_URL}`);
  console.log(`  SDK       : packages/verdictpay-sdk/dist/index.js`);
  console.log(`  PAYPAL_MODE: ${PAYPAL_MODE} (the running backend decides the gateway)`);
  if (PAYPAL_MODE === "PAYPAL_LIVE" || PAYPAL_MODE === "live") {
    console.log("  note      : live mode calls the real PayPal sandbox; the backend needs credentials.");
  }

  const health = await apiJson("/api/v1/health");
  console.log(
    `[1/4] health ok · v${health.version ?? "?"} · gateway=${health.gateway ?? health.mode ?? "?"} · database=${health.database ?? "?"}`,
  );

  const checkout = await apiJson("/api/v1/sandbox/checkout", {
    method: "POST",
    body: JSON.stringify({ plan: "pro", email: "demo.buyer@aurora.test", tos_version: TOS_VERSION }),
  });
  check(typeof checkout.order_id === "string", "checkout response is missing order_id");
  check(typeof checkout.payer_id === "string", "checkout response is missing payer_id");
  console.log(
    `[2/4] checkout ok · order=${checkout.order_id} · subscription=${checkout.subscription_id ?? "—"} · payer=${checkout.payer_id}`,
  );

  const client = new VerdictPayClient({
    apiKey: API_KEY,
    webhookSecret: SIGNING_SECRET,
    baseUrl: API_BASE_URL,
    maxRetries: 1,
    timeoutMs: 15_000,
    batchSize: 32,
  });

  client.trackCheckout({
    paypalPayerId: checkout.payer_id,
    paypalOrderId: checkout.order_id,
    ...(checkout.subscription_id ? { paypalSubscriptionId: checkout.subscription_id } : {}),
    clientIp: DEFAULT_CLIENT_IP,
    deviceFingerprint: DEFAULT_DEVICE_FINGERPRINT,
    tosVersion: TOS_VERSION,
    tosContentSha256: sha256Hex(TOS_TEXT),
  });
  client.trackEvent({
    eventType: "SESSION_AUTH",
    paypalPayerId: checkout.payer_id,
    paypalOrderId: checkout.order_id,
    ...(checkout.subscription_id ? { paypalSubscriptionId: checkout.subscription_id } : {}),
    clientIp: DEFAULT_CLIENT_IP,
    deviceFingerprint: DEFAULT_DEVICE_FINGERPRINT,
    metadata: { logins: 15, asn: "AS15169", user_agent: DEMO_USER_AGENT },
  });
  client.trackUsage({
    paypalPayerId: checkout.payer_id,
    units: 42_000,
    clientIp: DEFAULT_CLIENT_IP,
    deviceFingerprint: DEFAULT_DEVICE_FINGERPRINT,
  });
  client.trackDelivery({
    paypalPayerId: checkout.payer_id,
    resourceId: EXPORT_NAME,
    resourceSha256: sha256Hex(DEMO_ASSET_PAYLOAD),
    clientIp: DEFAULT_CLIENT_IP,
    deviceFingerprint: DEFAULT_DEVICE_FINGERPRINT,
  });

  const flushed = await client.flush();
  check(flushed.accepted === EXPECTED_EVENT_COUNT, `expected ${EXPECTED_EVENT_COUNT} accepted events, got ${flushed.accepted}`);
  check(flushed.duplicates === 0, `expected no duplicate events, got ${flushed.duplicates}`);
  check(flushed.events.length === EXPECTED_EVENT_COUNT, `expected ${EXPECTED_EVENT_COUNT} returned events, got ${flushed.events.length}`);
  check(flushed.chain !== null, "flush did not return a chain verification");
  check(flushed.chain.valid === true, "the ingest chain was reported invalid");
  check(isHash(flushed.chain.head_hash), "ingest chain head_hash is not a sha256 digest");
  const types = flushed.events.map((event) => event.event_type);
  for (const expected of ["TOS_ACCEPTED", "SESSION_AUTH", "USAGE_METERED", "ASSET_DELIVERED"]) {
    check(types.includes(expected), `missing ${expected} in the accepted batch`);
  }
  console.log(
    `[3/4] signed ingest ok · accepted=${flushed.accepted} · duplicates=${flushed.duplicates} · head=${flushed.chain.head_hash.slice(0, 12)}…`,
  );

  const chain = await client.verifyChain(checkout.payer_id);
  check(chain.valid === true, "verifyChain reported an invalid chain");
  check(chain.payer_id === checkout.payer_id, "verifyChain returned a different payer");
  check(chain.event_count >= EXPECTED_EVENT_COUNT, `chain has only ${chain.event_count} events`);
  check(isHash(chain.head_hash), "verified chain head_hash is not a sha256 digest");
  const timeline = await apiJson(`/api/v1/customers/${encodeURIComponent(checkout.payer_id)}/timeline`);
  const ledgerIds = new Set((timeline.events ?? []).map((event) => event.id));
  for (const event of flushed.events) {
    check(ledgerIds.has(event.id), `event ${event.id} is missing from the payer timeline`);
  }
  console.log(
    `[4/4] chain verify ok · payer=${chain.payer_id} · events=${chain.event_count} · valid=${chain.valid} · timeline=${ledgerIds.size}`,
  );

  console.log(
    `PASS live SDK demo — 4 signed events accepted, chain valid, head ${chain.head_hash.slice(0, 16)}…`,
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FAIL live SDK demo — ${message}`);
  process.exitCode = 1;
});
