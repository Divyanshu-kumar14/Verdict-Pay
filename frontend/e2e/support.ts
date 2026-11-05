/**
 * Shared HTTP plumbing for the E2E layer.
 *
 * These tests talk to the REAL backend over HTTP; nothing here is mocked. The
 * base URL is the same variable the app itself reads (NEXT_PUBLIC_API_BASE_URL),
 * defaulting to the local demo stack. Failing to reach the API is a hard error
 * with the exact remediation command, never a silent skip.
 */

import { z } from "zod";

import { HealthResponseSchema } from "../lib/types";

const DEFAULT_API_BASE_URL = "http://127.0.0.1:8000";

/** Trailing slashes removed so path concatenation is always well formed. */
export const E2E_API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_API_BASE_URL
).replace(/\/+$/, "");

/** Public-by-design demo key; documented in frontend/README.md. */
export const E2E_API_KEY = "vp_demo_sk_local";

/** Headers every authenticated demo request uses. */
export const AUTH_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-API-Key": E2E_API_KEY,
};

export type CallOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  /** Pass null to send the request WITHOUT an API key (auth-failure tests). */
  apiKey?: string | null;
};

export type JsonCallResult = {
  status: number;
  headers: Headers;
  payload: unknown;
};

function authHeaders(apiKey: string | null, hasBody: boolean): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey !== null) headers["X-API-Key"] = apiKey;
  if (hasBody) headers["Content-Type"] = "application/json";
  return headers;
}

/** Perform one JSON request and return the raw status, headers and decoded body. */
export async function callJson(path: string, options: CallOptions = {}): Promise<JsonCallResult> {
  const apiKey = options.apiKey === undefined ? E2E_API_KEY : options.apiKey;
  const hasBody = options.body !== undefined;
  const response = await fetch(`${E2E_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: authHeaders(apiKey, hasBody),
    body: hasBody ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text.length === 0 ? null : JSON.parse(text);
  } catch {
    // A non-JSON body is itself a contract violation; surface the raw text.
    payload = text;
  }
  return { status: response.status, headers: response.headers, payload };
}

export type BinaryCallResult = {
  status: number;
  contentType: string | null;
  bytes: Uint8Array;
};

/** Perform one authenticated request and return the raw bytes (for the PDF dossier). */
export async function callBinary(path: string): Promise<BinaryCallResult> {
  const response = await fetch(`${E2E_API_BASE_URL}${path}`, {
    headers: { Accept: "application/pdf", "X-API-Key": E2E_API_KEY },
  });
  const buffer = await response.arrayBuffer();
  return {
    status: response.status,
    contentType: response.headers.get("content-type"),
    bytes: new Uint8Array(buffer),
  };
}

/** Raw wire view of a JSON object, before schema coercion (money is still a string). */
export function rawRecord(payload: unknown): Record<string, unknown> {
  return z.record(z.unknown()).parse(payload);
}

/** Narrow an optional value or fail loudly with a readable message. */
export function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

/**
 * One health probe per suite. When the demo stack is down this throws a single
 * descriptive error (Vitest then fails the whole file) instead of letting every
 * test fail separately with an opaque "fetch failed".
 */
export async function assertDemoApiReachable(): Promise<void> {
  const healthUrl = `${E2E_API_BASE_URL}/api/v1/health`;
  const startApi =
    'cd ../backend && DATABASE_URL="sqlite+aiosqlite:///./verdict-pay/demo.db" ' +
    "PAYPAL_MODE=simulator .venv/bin/uvicorn app.main:app --app-dir . --host 127.0.0.1 --port 8000";
  const seedDemo =
    'cd ../backend && DATABASE_URL="sqlite+aiosqlite:///./verdict-pay/demo.db" ' +
    ".venv/bin/python scripts/seed_demo.py --reset";

  let response: Response;
  try {
    response = await fetch(healthUrl, {
      headers: AUTH_HEADERS,
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `E2E BLOCKED: the VerdictPay API is unreachable at ${E2E_API_BASE_URL}.`,
        `Probe: GET ${healthUrl}`,
        `NEXT_PUBLIC_API_BASE_URL=${process.env.NEXT_PUBLIC_API_BASE_URL ?? "<unset>"}`,
        `Cause: ${cause}`,
        `Start the API: ${startApi}`,
        `Seed demo data: ${seedDemo}`,
      ].join("\n"),
    );
  }

  if (!response.ok) {
    throw new Error(
      `E2E BLOCKED: ${healthUrl} answered HTTP ${response.status} instead of 200. ` +
        `Start the API: ${startApi}`,
    );
  }

  const payload: unknown = await response.json();
  const parsed = HealthResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `E2E BLOCKED: ${healthUrl} answered 200 but the body is not a VerdictPay health payload. ` +
        "Another service may be bound to this port.",
    );
  }
}