import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { VerdictPayClient, VerdictPayError, isVerdictPayError } from "../src/index";
import type { VerdictPayClientOptions } from "../src/index";

const API_KEY = "vp_test_key_local";
const WEBHOOK_SECRET = "test_webhook_secret";
const BASE_URL = "https://api.verdictpay.test";
const PAYER = "YRZ829104KLA";
const ORDER = "5O190127TN364715T";
const SUBSCRIPTION = "I-BW452GLLEP1G";
const SHA = "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface FetchCall {
  url: string;
  init: RequestInit;
}

interface ClientHarness {
  client: VerdictPayClient;
  fetchMock: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
}

/** Minimal structural Response; only the members the SDK reads. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** The frozen TelemetryIngestResponse shape. */
function ingestBody(accepted = 1, payerId = PAYER): unknown {
  return {
    accepted,
    duplicates: 0,
    events: [
      {
        id: "tel_000000000000000000000001",
        event_id: null,
        event_type: "USAGE_METERED",
        paypal_payer_id: payerId,
        sequence: 1,
        client_ip: "0.0.0.0",
        device_fingerprint: "sdk-unknown-device",
        resource_id: null,
        resource_sha256: null,
        units_consumed: 1,
        prev_hash: "0".repeat(64),
        chain_hash: "a".repeat(64),
        created_at: "2026-01-01T00:00:00Z",
      },
    ],
    chain: {
      payer_id: payerId,
      valid: true,
      event_count: accepted,
      head_hash: "a".repeat(64),
      broken_at_sequence: null,
      breaks: [],
      verified_at: "2026-01-01T00:00:00Z",
    },
  };
}

/** Error envelope the API returns (backend/app/api/schemas.py). */
function errorEnvelope(code: string, message: string): unknown {
  return { error: { code, message, details: [], request_id: "req_test_1" } };
}

function createClient(overrides: Partial<VerdictPayClientOptions> = {}): ClientHarness {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return jsonResponse(200, ingestBody());
  });
  const client = new VerdictPayClient({
    apiKey: API_KEY,
    webhookSecret: WEBHOOK_SECRET,
    baseUrl: BASE_URL,
    fetch: fetchMock as unknown as typeof fetch,
    flushIntervalMs: 3_600_000,
    ...overrides,
  });
  return { client, fetchMock, calls };
}

/** Poll until a synchronous predicate holds; fails loudly on timeout. */
async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error("condition not met within " + timeoutMs + "ms");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Capture a synchronous SDK error. */
function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the call to throw");
}

/** Capture an asynchronous SDK error. */
async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the promise to reject");
}

/** Assert a captured value is a VerdictPayError with an exact code. */
function expectSdkError(value: unknown, code: VerdictPayError["code"]): VerdictPayError {
  expect(value).toBeInstanceOf(VerdictPayError);
  expect(isVerdictPayError(value)).toBe(true);
  const error = value as VerdictPayError;
  expect(error.code).toBe(code);
  return error;
}

describe("buffering", () => {
  it("buffers below batchSize and flushes automatically at batchSize", async () => {
    const { client, fetchMock, calls } = createClient({ batchSize: 3 });

    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    client.trackUsage({ paypalPayerId: PAYER, units: 2 });
    expect(fetchMock).not.toHaveBeenCalled();

    client.trackUsage({ paypalPayerId: PAYER, units: 3 });
    await waitFor(() => fetchMock.mock.calls.length === 1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(BASE_URL + "/api/v1/telemetry/events");
    const payload = JSON.parse(String(calls[0]?.init.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events.map((event) => event["event_type"])).toEqual([
      "USAGE_METERED",
      "USAGE_METERED",
      "USAGE_METERED",
    ]);
    expect(payload.events.map((event) => event["units_consumed"])).toEqual([1, 2, 3]);
    for (const event of payload.events) {
      expect(event["event_id"]).toMatch(UUID_V4);
    }
  });

  it("flushes on the background interval without reaching batchSize", async () => {
    const { client, fetchMock, calls } = createClient({
      batchSize: 100,
      flushIntervalMs: 20,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 7 });
    await waitFor(() => fetchMock.mock.calls.length === 1);

    const payload = JSON.parse(String(calls[0]?.init.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]?.["units_consumed"]).toBe(7);
  });

  it("flush() on an empty buffer sends nothing and returns empty counts", async () => {
    const { client, fetchMock } = createClient();

    const result = await client.flush();

    expect(result).toEqual({ accepted: 0, duplicates: 0, rejected: 0, events: [], chain: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("signing", () => {
  it("sends an HMAC header that verifies with the same secret over the exact body", async () => {
    const { client, calls } = createClient();
    client.trackUsage({
      paypalPayerId: PAYER,
      units: 42,
      clientIp: "203.0.113.9",
      deviceFingerprint: "fp_89a7c6d5e4f3",
    });

    const result = await client.flush();

    expect(result.accepted).toBe(1);
    const call = calls[0];
    expect(call).toBeDefined();
    const headers = call?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe(API_KEY);
    const timestamp = headers["x-verdictpay-timestamp"];
    expect(timestamp).toMatch(/^[0-9]{10}$/);
    expect(Math.abs(Number(timestamp) - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(5);

    const body = String(call?.init.body);
    const expected = createHmac("sha256", WEBHOOK_SECRET).update(timestamp + "." + body).digest("hex");
    expect(headers["x-verdictpay-signature"]).toBe(expected);
    expect(headers["content-type"]).toBe("application/json");

    const payload = JSON.parse(body) as { events: Array<Record<string, unknown>> };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      event_type: "USAGE_METERED",
      paypal_payer_id: PAYER,
      client_ip: "203.0.113.9",
      device_fingerprint: "fp_89a7c6d5e4f3",
      units_consumed: 42,
      metadata: {},
    });
    expect(payload.events[0]?.["occurred_at"]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("maps checkout, delivery and usage inputs to canonical wire events", async () => {
    const { client, calls } = createClient();
    client.trackCheckout({
      paypalPayerId: PAYER,
      paypalOrderId: ORDER,
      paypalSubscriptionId: SUBSCRIPTION,
      userEmail: "alex@customer-startup.io",
      clientIp: "203.0.113.7",
      deviceFingerprint: "fp_checkout",
      tosVersion: "v2.4-2026-01",
      tosContentSha256: SHA,
    });
    client.trackDelivery({
      paypalPayerId: PAYER,
      resourceId: "export_q3_financial_model.xlsx",
      resourceSha256: SHA,
      computeUnitsConsumed: 1450,
    });
    client.trackUsage({ paypalPayerId: PAYER, units: 42000 });

    await client.flush();

    const payload = JSON.parse(String(calls[0]?.init.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(payload.events).toHaveLength(3);
    expect(payload.events[0]).toMatchObject({
      event_type: "TOS_ACCEPTED",
      paypal_order_id: ORDER,
      paypal_subscription_id: SUBSCRIPTION,
      client_ip: "203.0.113.7",
      device_fingerprint: "fp_checkout",
      tos_version: "v2.4-2026-01",
      tos_content_sha256: SHA,
      metadata: { user_email: "alex@customer-startup.io" },
    });
    expect(payload.events[1]).toMatchObject({
      event_type: "ASSET_DELIVERED",
      resource_id: "export_q3_financial_model.xlsx",
      resource_sha256: SHA,
      units_consumed: 1450,
    });
    expect(payload.events[2]).toMatchObject({
      event_type: "USAGE_METERED",
      units_consumed: 42000,
    });
  });
});

describe("retries and errors", () => {
  it("retries a 429 and succeeds on the next attempt", async () => {
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return jsonResponse(429, errorEnvelope("rate_limited", "Too many requests."));
      }
      return jsonResponse(200, ingestBody());
    });
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 3,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    const result = await client.flush();

    expect(calls).toHaveLength(2);
    expect(result.accepted).toBe(1);
    expect(result.chain?.valid).toBe(true);
  });

  it("retries a 500 and then surfaces server_error", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse(500, errorEnvelope("internal_error", "An unexpected error occurred.")),
    );
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 2,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    const error = expectSdkError(await captureRejection(client.flush()), "server_error");

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(error.status).toBe(500);
    expect(error.message).toBe("An unexpected error occurred.");
    expect(error.requestId).toBe("req_test_1");
  });

  it("raises unauthorized on 401 and does not retry", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> =>
      jsonResponse(401, errorEnvelope("unauthorized", "Invalid API key.")),
    );
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
      maxRetries: 3,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    const error = expectSdkError(await captureRejection(client.flush()), "unauthorized");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(error.status).toBe(401);
    expect(error.message).toBe("Invalid API key.");
    expect(error.message).not.toContain(API_KEY);
    expect(JSON.stringify(error)).not.toContain(API_KEY);
  });

  it("raises network_error when the request times out", async () => {
    const hangingFetch = vi.fn(
      (_url: string, init: RequestInit): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abortError = new Error("The operation was aborted.");
            abortError.name = "AbortError";
            reject(abortError);
          });
        }),
    );
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: hangingFetch as unknown as typeof fetch,
      maxRetries: 0,
      timeoutMs: 10,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    const error = expectSdkError(await captureRejection(client.flush()), "network_error");

    expect(hangingFetch).toHaveBeenCalledTimes(1);
    expect(error.message).toContain("timed out after 10ms");
  });

  it("retries network failures up to maxRetries", async () => {
    const failingFetch = vi.fn(async (): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: failingFetch as unknown as typeof fetch,
      maxRetries: 2,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    expectSdkError(await captureRejection(client.flush()), "network_error");

    expect(failingFetch).toHaveBeenCalledTimes(3);
  });

  it("raises validation_error on a malformed success response", async () => {
    const fetchMock = vi.fn(async (): Promise<Response> => jsonResponse(200, { unexpected: true }));
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    const error = expectSdkError(await captureRejection(client.flush()), "validation_error");

    expect(error.message).toBe("Telemetry ingest response does not match the frozen contract.");
  });

  it("keeps the batch after a failed flush so a retry is not lost", async () => {
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return jsonResponse(401, errorEnvelope("unauthorized", "Invalid API key."));
      }
      return jsonResponse(200, ingestBody());
    });
    const client = new VerdictPayClient({
      apiKey: API_KEY,
      webhookSecret: WEBHOOK_SECRET,
      baseUrl: BASE_URL,
      fetch: fetchMock as unknown as typeof fetch,
    });

    client.trackUsage({ paypalPayerId: PAYER, units: 5 });
    expectSdkError(await captureRejection(client.flush()), "unauthorized");
    const result = await client.flush();

    expect(calls).toHaveLength(2);
    expect(result.accepted).toBe(1);
    const first = JSON.parse(String(calls[0]?.init.body)) as {
      events: Array<Record<string, unknown>>;
    };
    const second = JSON.parse(String(calls[1]?.init.body)) as {
      events: Array<Record<string, unknown>>;
    };
    expect(second.events[0]?.["event_id"]).toBe(first.events[0]?.["event_id"]);
  });
});

describe("verifyChain", () => {
  it("GETs the chain verification endpoint and returns the parsed chain", async () => {
    const calls: FetchCall[] = [];
    const fetchMock = vi.fn(async (url: string, init: RequestInit): Promise<Response> => {
      calls.push({ url, init });
      return jsonResponse(200, (ingestBody() as { chain: unknown }).chain);
    });
    const { client } = createClient({ fetch: fetchMock as unknown as typeof fetch });

    const chain = await client.verifyChain(PAYER);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(BASE_URL + "/api/v1/telemetry/chain/" + PAYER + "/verify");
    expect(calls[0]?.init.method).toBe("GET");
    expect((calls[0]?.init.headers as Record<string, string>)["x-api-key"]).toBe(API_KEY);
    expect(chain.payer_id).toBe(PAYER);
    expect(chain.valid).toBe(true);
    expect(chain.event_count).toBe(1);
  });

  it("raises validation_error when the chain payload is malformed", async () => {
    const { client } = createClient({
      fetch: (async () => jsonResponse(200, { payer_id: PAYER })) as unknown as typeof fetch,
    });

    const error = expectSdkError(await captureRejection(client.verifyChain(PAYER)), "validation_error");
    expect(error.message).toBe("Chain verification response does not match the frozen contract.");
  });
});

describe("input validation", () => {
  it("rejects an empty api key with invalid_config", () => {
    const error = expectSdkError(
      captureError(() =>
        new VerdictPayClient({ apiKey: "   ", webhookSecret: WEBHOOK_SECRET }),
      ),
      "invalid_config",
    );
    expect(error.message).toBe("apiKey must be a non-empty string.");
  });

  it("rejects an out-of-range batchSize with invalid_config", () => {
    expectSdkError(
      captureError(
        () =>
          new VerdictPayClient({
            apiKey: API_KEY,
            webhookSecret: WEBHOOK_SECRET,
            batchSize: 0,
          }),
      ),
      "invalid_config",
    );
  });

  it("rejects a non-http baseUrl with invalid_config", () => {
    expectSdkError(
      captureError(
        () =>
          new VerdictPayClient({
            apiKey: API_KEY,
            webhookSecret: WEBHOOK_SECRET,
            baseUrl: "ftp://api.verdictpay.test",
          }),
      ),
      "invalid_config",
    );
  });

  it("rejects a non-SHA-256 tos hash with validation_error", () => {
    const { client } = createClient();
    const error = expectSdkError(
      captureError(() =>
        client.trackCheckout({
          paypalPayerId: PAYER,
          tosVersion: "v2.4-2026-01",
          tosContentSha256: "not-a-hash",
        }),
      ),
      "validation_error",
    );
    expect(error.message).toBe(
      "tosContentSha256 must be a 64-character lowercase hex SHA-256 digest.",
    );
  });

  it("rejects negative usage units with validation_error", () => {
    const { client } = createClient();
    const error = expectSdkError(
      captureError(() => client.trackUsage({ paypalPayerId: PAYER, units: -1 })),
      "validation_error",
    );
    expect(error.message).toBe("unitsConsumed must be a non-negative integer.");
  });

  it("rejects an unknown event type with validation_error", () => {
    const { client } = createClient();
    const error = expectSdkError(
      captureError(() =>
        client.trackEvent({
          // Deliberately invalid at runtime; the product spec's ASSET_DOWNLOADED
          // is not part of the frozen ledger vocabulary.
          eventType: "ASSET_DOWNLOADED" as never,
          paypalPayerId: PAYER,
        }),
      ),
      "validation_error",
    );
    expect(error.message).toBe(
      "eventType must be one of TOS_ACCEPTED, SESSION_AUTH, ASSET_DELIVERED, USAGE_METERED.",
    );
  });
});

/** Payer ids carried by a request body, in order. */
function payersIn(init: RequestInit): string[] {
  const body = JSON.parse(String(init.body)) as { events: { paypal_payer_id: string }[] };
  return body.events.map((event) => event.paypal_payer_id);
}

describe("hardening", () => {
  it("drops only the event the API rejects, so later events still send", async () => {
    const onError = vi.fn();
    const { client, fetchMock, calls } = createClient({ onError, batchSize: 50 });
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return payersIn(init).includes("BAD-PAYER")
        ? jsonResponse(422, errorEnvelope("validation_error", "bad event"))
        : jsonResponse(200, ingestBody(payersIn(init).length));
    });

    client.trackUsage({ paypalPayerId: "GOOD-ONE", units: 1 });
    client.trackUsage({ paypalPayerId: "BAD-PAYER", units: 1 });
    client.trackUsage({ paypalPayerId: "GOOD-TWO", units: 1 });
    const result = await client.flush();

    expect(result.accepted).toBe(2);
    expect(result.rejected).toBe(1);
    expect(client.pendingEvents).toBe(0);
    expect(client.droppedEvents).toBe(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as VerdictPayError).status).toBe(422);

    // The poisoned event is gone: the next flush sends only the new event.
    client.trackUsage({ paypalPayerId: "GOOD-THREE", units: 1 });
    await client.flush();
    expect(payersIn(calls[calls.length - 1]?.init ?? {})).toEqual(["GOOD-THREE"]);
  });

  it("keeps events for a later retry on transient failures", async () => {
    const { client, fetchMock } = createClient({ maxRetries: 0 });
    fetchMock.mockResolvedValue(jsonResponse(503, errorEnvelope("server_error", "down")));
    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    const error = await captureRejection(client.flush());
    expect(isVerdictPayError(error) && error.code).toBe("server_error");
    expect(client.pendingEvents).toBe(1);
    expect(client.droppedEvents).toBe(0);
  });

  it("splits a large buffer into batchSize requests", async () => {
    // While the API is down, auto-flushes fail and the buffer grows past batchSize.
    let down = true;
    const { client, fetchMock, calls } = createClient({ batchSize: 4, maxRetries: 0 });
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return down
        ? jsonResponse(503, errorEnvelope("server_error", "down"))
        : jsonResponse(200, ingestBody(payersIn(init).length));
    });
    for (let index = 0; index < 10; index += 1) {
      client.trackUsage({ paypalPayerId: PAYER, units: index });
    }
    await waitFor(() => calls.length >= 2);
    await client.flush().catch(() => undefined);
    expect(client.pendingEvents).toBe(10);

    down = false;
    calls.length = 0;
    const result = await client.flush();
    expect(result.accepted).toBe(10);
    expect(calls.map((call) => payersIn(call.init).length)).toEqual([4, 4, 2]);
  });

  it("bounds the buffer and reports the overflow", () => {
    const onError = vi.fn();
    const { client } = createClient({ maxBufferSize: 3, batchSize: 500, onError });
    for (let index = 0; index < 5; index += 1) {
      client.trackUsage({ paypalPayerId: PAYER, units: index });
    }
    expect(client.pendingEvents).toBe(3);
    expect(client.droppedEvents).toBe(2);
    expect(onError).toHaveBeenCalledTimes(2);
    expect((onError.mock.calls[0]?.[0] as VerdictPayError).code).toBe("buffer_overflow");
  });

  it("uses one re-armed timeout, not a leaking interval", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { client, calls } = createClient({ flushIntervalMs: 10 });
    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    await waitFor(() => calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls).toHaveLength(1);
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("reports background flush failures to onError", async () => {
    const onError = vi.fn();
    const { client, fetchMock } = createClient({ flushIntervalMs: 10, maxRetries: 0, onError });
    fetchMock.mockResolvedValue(jsonResponse(503, errorEnvelope("server_error", "down")));
    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    await waitFor(() => onError.mock.calls.length > 0);
    expect((onError.mock.calls[0]?.[0] as VerdictPayError).code).toBe("server_error");
    await client.close().catch(() => undefined);
  });

  it("rejects unserialisable metadata when the event is tracked", () => {
    const { client } = createClient();
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    const error = captureError(() =>
      client.trackEvent({ eventType: "SESSION_AUTH", paypalPayerId: PAYER, metadata: circular }),
    );
    expect(isVerdictPayError(error) && error.code).toBe("validation_error");
    expect(client.pendingEvents).toBe(0);
  });

  it("refuses plain http to a remote host unless explicitly allowed", () => {
    const error = captureError(() => createClient({ baseUrl: "http://api.example.com" }));
    expect(isVerdictPayError(error) && error.code).toBe("invalid_config");
    expect(() => createClient({ baseUrl: "http://localhost:8000" })).not.toThrow();
    expect(() =>
      createClient({ baseUrl: "http://10.0.0.5:8000", allowInsecureHttp: true }),
    ).not.toThrow();
    const creds = captureError(() => createClient({ baseUrl: "https://user:pw@api.example.com" }));
    expect(isVerdictPayError(creds) && creds.code).toBe("invalid_config");
  });

  it("close() flushes the buffer and then rejects new events", async () => {
    const { client, calls } = createClient();
    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    await client.close();
    expect(calls).toHaveLength(1);
    const error = captureError(() => client.trackUsage({ paypalPayerId: PAYER, units: 2 }));
    expect(isVerdictPayError(error) && error.code).toBe("invalid_config");
  });

  it("accepts signingSecret as the secret option", async () => {
    const { client, calls } = createClient({ webhookSecret: undefined, signingSecret: "s3cret" });
    client.trackUsage({ paypalPayerId: PAYER, units: 1 });
    await client.flush();
    const headers = calls[0]?.init.headers as Record<string, string>;
    const expected = createHmac("sha256", "s3cret")
      .update(headers["x-verdictpay-timestamp"] + "." + String(calls[0]?.init.body))
      .digest("hex");
    expect(headers["x-verdictpay-signature"]).toBe(expected);
  });
});
