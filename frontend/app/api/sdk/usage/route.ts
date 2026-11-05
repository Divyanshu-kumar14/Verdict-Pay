/**
 * Server-side SDK telemetry route for the judge storefront.
 *
 * The browser never sees VERDICTPAY_SIGNING_SECRET: this route runs
 * @verdictpay/sdk on the Next.js server, signs the exact ingest body with
 * HMAC-SHA256, and returns the same {events, chain, totals} envelope the
 * storefront already renders. The legacy POST /api/v1/sandbox/usage endpoint
 * remains available as the client-side fallback when this route fails.
 */

import { createHash } from "node:crypto";

import { VerdictPayClient, isVerdictPayError } from "@verdictpay/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { UsageResponseSchema } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Keep these constants byte-identical to backend/app/api/routers/sandbox.py.
 * The ToS hash is what the dispute engine scores as proof of acceptance. */
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
const DEFAULT_EXPORT_NAME = "q3_financial_model.xlsx";

/** Server-only defaults match backend/app/config.py; override both in deployment. */
const API_KEY = process.env.VERDICTPAY_API_KEY ?? "vp_demo_sk_local";
const SIGNING_SECRET =
  process.env.VERDICTPAY_SIGNING_SECRET ?? "dev-signing-secret-change-me";
const API_BASE_URL = (
  process.env.VERDICTPAY_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const RequestSchema = z.object({
  payer_id: z.string().trim().min(3).max(64),
  order_id: z.string().trim().min(3).max(64),
  subscription_id: z.string().trim().min(1).max(64).optional(),
  logins: z.number().int().min(0).max(1_000).default(15),
  tokens: z.number().int().min(0).max(10_000_000).default(42_000),
  export_name: z.string().trim().min(1).max(255).default(DEFAULT_EXPORT_NAME),
  client_ip: z.string().trim().min(2).max(64).optional(),
  device_fingerprint: z.string().trim().min(2).max(128).optional(),
});

type ErrorDetail = { field: string | null; message: string; code: string | null };

function errorResponse(status: number, code: string, message: string, details: ErrorDetail[] = []) {
  return NextResponse.json(
    { error: { code, message, details, request_id: null } },
    { status },
  );
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function POST(request: Request): Promise<NextResponse> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "Request body must be valid JSON.");
  }

  const parsed = RequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse(
      422,
      "validation_error",
      "The SDK usage request did not match the expected shape.",
      parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || null,
        message: issue.message,
        code: issue.code,
      })),
    );
  }

  const input = parsed.data;
  const clientIp = input.client_ip ?? DEFAULT_CLIENT_IP;
  const deviceFingerprint = input.device_fingerprint ?? DEFAULT_DEVICE_FINGERPRINT;

  const client = new VerdictPayClient({
    apiKey: API_KEY,
    webhookSecret: SIGNING_SECRET,
    baseUrl: API_BASE_URL,
    maxRetries: 1,
    timeoutMs: 15_000,
    // One batch for the four-event step: the response should carry the full chain.
    batchSize: 32,
  });

  try {
    client.trackCheckout({
      paypalPayerId: input.payer_id,
      paypalOrderId: input.order_id,
      ...(input.subscription_id ? { paypalSubscriptionId: input.subscription_id } : {}),
      clientIp,
      deviceFingerprint,
      tosVersion: TOS_VERSION,
      tosContentSha256: sha256Hex(TOS_TEXT),
    });

    client.trackEvent({
      eventType: "SESSION_AUTH",
      paypalPayerId: input.payer_id,
      paypalOrderId: input.order_id,
      ...(input.subscription_id ? { paypalSubscriptionId: input.subscription_id } : {}),
      clientIp,
      deviceFingerprint,
      metadata: {
        logins: input.logins,
        asn: "AS15169",
        user_agent: DEMO_USER_AGENT,
      },
    });

    client.trackUsage({
      paypalPayerId: input.payer_id,
      units: input.tokens,
      clientIp,
      deviceFingerprint,
    });

    client.trackDelivery({
      paypalPayerId: input.payer_id,
      resourceId: input.export_name,
      resourceSha256: sha256Hex(DEMO_ASSET_PAYLOAD),
      clientIp,
      deviceFingerprint,
    });

    const flushed = await client.flush();
    const chain = flushed.chain ?? (await client.verifyChain(input.payer_id));

    const response = {
      events: flushed.events,
      chain,
      totals: {
        logins: input.logins,
        tokens: input.tokens,
        assets: 1,
      },
    };

    const validated = UsageResponseSchema.safeParse(response);
    if (!validated.success) {
      return errorResponse(
        502,
        "invalid_sdk_response",
        "The SDK produced a telemetry response outside the frozen contract.",
        validated.error.issues.map((issue) => ({
          field: issue.path.join(".") || null,
          message: issue.message,
          code: issue.code,
        })),
      );
    }

    return NextResponse.json(validated.data);
  } catch (caught) {
    if (isVerdictPayError(caught)) {
      const status = caught.status ?? (caught.code === "validation_error" ? 400 : 502);
      return errorResponse(status, "sdk_" + caught.code, caught.message);
    }
    const message = caught instanceof Error ? caught.message : "Unknown SDK failure.";
    return errorResponse(502, "sdk_failure", message);
  }
}
