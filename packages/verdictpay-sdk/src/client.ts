/**
 * VerdictPay telemetry client.
 *
 * Events are buffered, batched and sent to POST /api/v1/telemetry/events with
 * X-API-Key plus an HMAC-SHA256 signature over "<unixSeconds>.<exactBody>".
 * Failed batches are re-buffered so a transient outage never drops telemetry.
 */

import { VerdictPayError } from "./errors";
import { signPayload, unixTimestamp } from "./signing";
import type {
  ChainVerification,
  CheckoutTrackingInput,
  DeliveryTrackingInput,
  EventInput,
  FlushResult,
  TelemetryEventOut,
  TelemetryEventType,
  TelemetryIngestResponse,
  UsageTrackingInput,
  VerdictPayClientOptions,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:8000";
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BUFFER_SIZE = 10_000;
const MAX_BATCH_SIZE = 500;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const RETRY_BASE_MS = 250;
const RETRY_MAX_MS = 2_000;
const DEFAULT_CLIENT_IP = "0.0.0.0";
const DEFAULT_DEVICE_FINGERPRINT = "sdk-unknown-device";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

const EVENT_TYPES: readonly TelemetryEventType[] = [
  "TOS_ACCEPTED",
  "SESSION_AUTH",
  "ASSET_DELIVERED",
  "USAGE_METERED",
];

/** Wire shape of TelemetryEventIn in backend/app/api/schemas.py. */
interface WireTelemetryEvent {
  event_id: string;
  event_type: TelemetryEventType;
  paypal_payer_id: string;
  paypal_order_id?: string;
  paypal_subscription_id?: string;
  client_ip: string;
  device_fingerprint: string;
  resource_id?: string;
  resource_sha256?: string;
  units_consumed: number;
  occurred_at: string;
  tos_version?: string;
  tos_content_sha256?: string;
  metadata: Record<string, unknown>;
}

/** True for a non-null, non-array object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural check on the frozen ChainVerification contract. */
function isChainVerification(value: unknown): value is ChainVerification {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.payer_id === "string" &&
    typeof value.valid === "boolean" &&
    typeof value.event_count === "number" &&
    typeof value.head_hash === "string" &&
    Array.isArray(value.breaks)
  );
}

/** Validate a telemetry ingest response; anything else is a contract violation. */
function parseIngestResponse(payload: unknown): TelemetryIngestResponse {
  if (!isRecord(payload)) {
    throw new VerdictPayError("validation_error", "Telemetry ingest response was not a JSON object.");
  }
  const { accepted, duplicates, events, chain } = payload;
  if (
    typeof accepted !== "number" ||
    typeof duplicates !== "number" ||
    !Array.isArray(events) ||
    !isChainVerification(chain)
  ) {
    throw new VerdictPayError(
      "validation_error",
      "Telemetry ingest response does not match the frozen contract.",
      { details: payload },
    );
  }
  for (const event of events) {
    if (!isRecord(event) || typeof event.id !== "string" || typeof event.chain_hash !== "string") {
      throw new VerdictPayError(
        "validation_error",
        "Telemetry ingest response contained a malformed event.",
        { details: event },
      );
    }
  }
  return {
    accepted,
    duplicates,
    events: events as TelemetryEventOut[],
    chain,
  };
}

/** Validate a chain verification response. */
function parseChainVerification(payload: unknown): ChainVerification {
  if (!isChainVerification(payload)) {
    throw new VerdictPayError(
      "validation_error",
      "Chain verification response does not match the frozen contract.",
      { details: payload },
    );
  }
  return payload;
}

/** Map an HTTP status to a stable SDK error code. */
function codeForStatus(status: number): "unauthorized" | "rate_limited" | "server_error" | "validation_error" {
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 429) {
    return "rate_limited";
  }
  if (status >= 500) {
    return "server_error";
  }
  return "validation_error";
}

/** 429 and 5xx are retried; every other 4xx is final. */
function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

/** Validate a required string field from untrusted caller input. */
function requireString(value: unknown, field: string, min: number, max: number): string {
  if (typeof value !== "string") {
    throw new VerdictPayError("validation_error", field + " must be a string.");
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new VerdictPayError(
      "validation_error",
      field + " must be between " + min + " and " + max + " characters.",
    );
  }
  return trimmed;
}

/** Validate an optional string field; undefined stays undefined. */
function optionalString(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field, 1, max);
}

/** Validate a lowercase hex SHA-256 digest. */
function requireSha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new VerdictPayError(
      "validation_error",
      field + " must be a 64-character lowercase hex SHA-256 digest.",
    );
  }
  return value;
}

/** Validate a non-negative integer unit count. */
function requireUnits(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new VerdictPayError("validation_error", field + " must be a non-negative integer.");
  }
  return value;
}

/** Validate a canonical event type. */
function requireEventType(value: unknown): TelemetryEventType {
  if (typeof value !== "string" || !EVENT_TYPES.includes(value as TelemetryEventType)) {
    throw new VerdictPayError(
      "validation_error",
      "eventType must be one of " + EVENT_TYPES.join(", ") + ".",
    );
  }
  return value as TelemetryEventType;
}

/** Coerce a Date or ISO-8601 string to the wire's ISO-8601 UTC form. */
function normaliseOccurredAt(value: Date | string | undefined): string {
  if (value === undefined) {
    return new Date().toISOString();
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new VerdictPayError("validation_error", "occurredAt must be a valid Date or ISO-8601 string.");
  }
  return date.toISOString();
}

/**
 * Validate metadata is a JSON-serialisable plain object.
 *
 * Checked when the event is tracked: an unserialisable value found only at
 * flush time would make the whole batch unsendable.
 */
function normaliseMetadata(value: Record<string, unknown> | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new VerdictPayError("validation_error", "metadata must be a plain object.");
  }
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch (cause) {
    throw new VerdictPayError("validation_error", "metadata must be JSON-serialisable.", { cause });
  }
  // A snapshot, so later mutation by the caller cannot change a queued event.
  return JSON.parse(serialised) as Record<string, unknown>;
}

/** Generate a replay-safe event id. */
function createEventId(): string {
  const crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID !== "function") {
    throw new VerdictPayError(
      "invalid_config",
      "crypto.randomUUID is unavailable; @verdictpay/sdk requires Node 20+ or a browser runtime.",
    );
  }
  return crypto.randomUUID();
}

/** Wait for a number of milliseconds (fake-timer friendly). */
function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

/** Validate and normalise an integer option. */
function normaliseInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new VerdictPayError(
      "invalid_config",
      field + " must be an integer between " + min + " and " + max + ".",
    );
  }
  return value;
}

/**
 * Validate and normalise the API base URL.
 *
 * Plain http is accepted only for local hosts: the API key travels in a
 * header, so a remote http URL would send it in clear text.
 */
function normaliseBaseUrl(value: unknown, allowInsecureHttp: boolean): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VerdictPayError("invalid_config", "baseUrl must be an absolute http(s) URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new VerdictPayError("invalid_config", "baseUrl must be an absolute http(s) URL.", {
      cause,
    });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new VerdictPayError("invalid_config", "baseUrl must use http or https.");
  }
  if (parsed.search.length > 0 || parsed.hash.length > 0) {
    throw new VerdictPayError("invalid_config", "baseUrl must not contain a query string or fragment.");
  }
  if (parsed.username.length > 0 || parsed.password.length > 0) {
    throw new VerdictPayError("invalid_config", "baseUrl must not contain credentials.");
  }
  if (parsed.protocol === "http:" && !LOCAL_HOSTS.has(parsed.hostname) && !allowInsecureHttp) {
    throw new VerdictPayError(
      "invalid_config",
      "baseUrl must use https for non-local hosts (the API key would be sent in clear text). " +
      "Pass allowInsecureHttp: true only on a trusted private network.",
    );
  }
  return value.trim().replace(/\/+$/, "");
}

/** Empty result returned when flush() is called with nothing buffered. */
function emptyFlushResult(): FlushResult {
  return { accepted: 0, duplicates: 0, rejected: 0, events: [], chain: null };
}

/**
 * True when the API refused the request for good: a 4xx other than auth and
 * rate limiting. Resending the same bytes would fail the same way.
 */
function isPermanentRejection(error: unknown): error is VerdictPayError {
  if (!(error instanceof VerdictPayError) || error.status === undefined) {
    return false;
  }
  const { status } = error;
  return status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429;
}

/**
 * VerdictPay telemetry client.
 *
 * @example
 * const client = new VerdictPayClient({ apiKey: "vp_...", signingSecret: "..." });
 * client.trackCheckout({ paypalPayerId: "YRZ829104KLA", tosVersion: "v2.4-2026-01", tosContentSha256: sha });
 * await client.flush();
 */
export class VerdictPayClient {
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  private readonly onError: ((error: VerdictPayError) => void) | undefined;
  private buffer: WireTelemetryEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushChain: Promise<void> = Promise.resolve();
  private closed = false;
  private droppedCount = 0;

  /**
   * @param options API key, signing secret, endpoint and buffering behaviour.
   * @throws VerdictPayError with code "invalid_config" on invalid options.
   */
  constructor(options: VerdictPayClientOptions) {
    if (!isRecord(options)) {
      throw new VerdictPayError("invalid_config", "VerdictPayClient requires an options object.");
    }
    if (typeof options.apiKey !== "string" || options.apiKey.trim().length === 0) {
      throw new VerdictPayError("invalid_config", "apiKey must be a non-empty string.");
    }
    const secret = options.signingSecret ?? options.webhookSecret;
    if (typeof secret !== "string" || secret.trim().length === 0) {
      throw new VerdictPayError("invalid_config", "signingSecret must be a non-empty string.");
    }
    if (options.onError !== undefined && typeof options.onError !== "function") {
      throw new VerdictPayError("invalid_config", "onError must be a function.");
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== "function") {
      throw new VerdictPayError(
        "invalid_config",
        "No fetch implementation found; pass options.fetch or use Node 20+.",
      );
    }
    this.apiKey = options.apiKey;
    this.webhookSecret = secret;
    this.baseUrl = normaliseBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL, options.allowInsecureHttp === true);
    this.onError = options.onError;
    this.maxBufferSize = normaliseInteger(
      options.maxBufferSize,
      DEFAULT_MAX_BUFFER_SIZE,
      1,
      1_000_000,
      "maxBufferSize",
    );
    this.fetchImpl = fetchImpl;
    this.maxRetries = normaliseInteger(options.maxRetries, DEFAULT_MAX_RETRIES, 0, 10, "maxRetries");
    this.timeoutMs = normaliseInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1, 120_000, "timeoutMs");
    this.batchSize = normaliseInteger(options.batchSize, DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE, "batchSize");
    this.flushIntervalMs = normaliseInteger(
      options.flushIntervalMs,
      DEFAULT_FLUSH_INTERVAL_MS,
      1,
      3_600_000,
      "flushIntervalMs",
    );
  }

  /** Records the checkout-time ToS acceptance event (TOS_ACCEPTED). */
  trackCheckout(input: CheckoutTrackingInput): void {
    if (!isRecord(input)) {
      throw new VerdictPayError("validation_error", "trackCheckout requires an input object.");
    }
    const metadata: Record<string, unknown> = {};
    if (input.userEmail !== undefined) {
      metadata["user_email"] = requireString(input.userEmail, "userEmail", 3, 254);
    }
    this.trackEvent({
      eventType: "TOS_ACCEPTED",
      paypalPayerId: input.paypalPayerId,
      paypalOrderId: input.paypalOrderId,
      paypalSubscriptionId: input.paypalSubscriptionId,
      clientIp: input.clientIp,
      deviceFingerprint: input.deviceFingerprint,
      tosVersion: input.tosVersion,
      tosContentSha256: input.tosContentSha256,
      metadata,
    });
  }

  /** Records a digital delivery receipt (ASSET_DELIVERED by default). */
  trackDelivery(input: DeliveryTrackingInput): void {
    if (!isRecord(input)) {
      throw new VerdictPayError("validation_error", "trackDelivery requires an input object.");
    }
    this.trackEvent({
      eventType: input.eventType ?? "ASSET_DELIVERED",
      paypalPayerId: input.paypalPayerId,
      resourceId: input.resourceId,
      resourceSha256: input.resourceSha256,
      unitsConsumed: input.computeUnitsConsumed,
      clientIp: input.clientIp,
      deviceFingerprint: input.deviceFingerprint,
    });
  }

  /** Records metered consumption (USAGE_METERED), e.g. LLM tokens or API credits. */
  trackUsage(input: UsageTrackingInput): void {
    if (!isRecord(input)) {
      throw new VerdictPayError("validation_error", "trackUsage requires an input object.");
    }
    this.trackEvent({
      eventType: "USAGE_METERED",
      paypalPayerId: input.paypalPayerId,
      unitsConsumed: input.units,
      resourceId: input.resourceId,
      clientIp: input.clientIp,
      deviceFingerprint: input.deviceFingerprint,
    });
  }

  /** Low-level typed event ingestion. Use for SESSION_AUTH and custom metadata. */
  trackEvent(event: EventInput): void {
    if (this.closed) {
      throw new VerdictPayError("invalid_config", "This VerdictPayClient has been closed.");
    }
    const wire = this.toWireEvent(event);
    this.buffer.push(wire);
    if (this.buffer.length > this.maxBufferSize) {
      // Bounded memory during a long outage: the oldest events go first.
      const overflow = this.buffer.length - this.maxBufferSize;
      this.buffer.splice(0, overflow);
      this.droppedCount += overflow;
      this.report(
        new VerdictPayError(
          "buffer_overflow",
          "Telemetry buffer is full (" + this.maxBufferSize + " events); dropped the " +
          overflow + " oldest event(s).",
        ),
      );
    }
    if (this.buffer.length >= this.batchSize) {
      void this.flush().catch((error: unknown) => {
        this.report(error);
      });
      return;
    }
    this.ensureTimer();
  }

  /** Events dropped so far because the buffer overflowed or the API rejected them. */
  get droppedEvents(): number {
    return this.droppedCount;
  }

  /** Events waiting to be sent. */
  get pendingEvents(): number {
    return this.buffer.length;
  }

  /**
   * Stops the background timer and sends everything still buffered. Call it
   * before the process exits; a closed client rejects new events.
   */
  async close(): Promise<FlushResult> {
    this.closed = true;
    this.stopTimer();
    return this.flush();
  }

  /**
   * Force-sends every buffered event.
   *
   * @returns Counts and the resulting chain head. On failure the batch is
   * re-buffered and a typed VerdictPayError is thrown.
   */
  flush(): Promise<FlushResult> {
    const run = this.flushChain.then(
      () => this.drain(),
      () => this.drain(),
    );
    this.flushChain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Verifies the per-payer hash chain through GET /api/v1/telemetry/chain/{payer}/verify. */
  async verifyChain(payerId: string): Promise<ChainVerification> {
    const payer = requireString(payerId, "payerId", 3, 64);
    const url = this.baseUrl + "/api/v1/telemetry/chain/" + encodeURIComponent(payer) + "/verify";
    return this.requestWithRetry(url, { method: "GET", headers: { "x-api-key": this.apiKey } }, parseChainVerification);
  }

  /** Validates and converts a public event into the wire shape. */
  private toWireEvent(input: EventInput): WireTelemetryEvent {
    if (!isRecord(input)) {
      throw new VerdictPayError("validation_error", "trackEvent requires an event object.");
    }
    const eventType = requireEventType(input.eventType);
    const paypalPayerId = requireString(input.paypalPayerId, "paypalPayerId", 3, 64);
    const clientIp =
      input.clientIp === undefined
        ? DEFAULT_CLIENT_IP
        : requireString(input.clientIp, "clientIp", 2, 64);
    const deviceFingerprint =
      input.deviceFingerprint === undefined
        ? DEFAULT_DEVICE_FINGERPRINT
        : requireString(input.deviceFingerprint, "deviceFingerprint", 2, 128);
    const unitsConsumed =
      input.unitsConsumed === undefined ? 0 : requireUnits(input.unitsConsumed, "unitsConsumed");
    const resourceSha256 =
      input.resourceSha256 === undefined
        ? undefined
        : requireSha256(input.resourceSha256, "resourceSha256");
    const tosContentSha256 =
      input.tosContentSha256 === undefined
        ? undefined
        : requireSha256(input.tosContentSha256, "tosContentSha256");
    const eventId =
      input.eventId === undefined
        ? createEventId()
        : requireString(input.eventId, "eventId", 1, 128);

    return {
      event_id: eventId,
      event_type: eventType,
      paypal_payer_id: paypalPayerId,
      paypal_order_id: optionalString(input.paypalOrderId, "paypalOrderId", 64),
      paypal_subscription_id: optionalString(input.paypalSubscriptionId, "paypalSubscriptionId", 64),
      client_ip: clientIp,
      device_fingerprint: deviceFingerprint,
      resource_id: optionalString(input.resourceId, "resourceId", 255),
      resource_sha256: resourceSha256,
      units_consumed: unitsConsumed,
      occurred_at: normaliseOccurredAt(input.occurredAt),
      tos_version: optionalString(input.tosVersion, "tosVersion", 64),
      tos_content_sha256: tosContentSha256,
      metadata: normaliseMetadata(input.metadata),
    };
  }

  /**
   * Sends the buffer in batchSize chunks. Runs serialised through flushChain,
   * so concurrent flushes cannot interleave batches.
   *
   * A transient failure (network, 401/403, 429, 5xx) puts the unsent events
   * back at the front of the buffer and throws. A permanent rejection (any
   * other 4xx) is narrowed down to the offending events, which are dropped and
   * reported, so one bad event can never block the events behind it.
   */
  private async drain(): Promise<FlushResult> {
    const result = emptyFlushResult();
    while (this.buffer.length > 0) {
      const chunk = this.buffer.splice(0, this.batchSize);
      try {
        await this.sendIsolatingRejects(chunk, result);
      } catch (error) {
        this.buffer.unshift(...chunk);
        if (!this.closed) {
          this.ensureTimer();
        }
        throw error;
      }
    }
    this.stopTimer();
    return result;
  }

  /** Sends one chunk; on a permanent rejection, bisects to drop only bad events. */
  private async sendIsolatingRejects(
    chunk: WireTelemetryEvent[],
    result: FlushResult,
  ): Promise<void> {
    try {
      const response = await this.sendBatch(chunk);
      result.accepted += response.accepted;
      result.duplicates += response.duplicates;
      result.events.push(...response.events);
      result.chain = response.chain;
      return;
    } catch (error) {
      if (!isPermanentRejection(error)) {
        throw error;
      }
      if (chunk.length === 1) {
        this.droppedCount += 1;
        result.rejected += 1;
        this.report(error);
        return;
      }
    }
    const middle = Math.ceil(chunk.length / 2);
    await this.sendIsolatingRejects(chunk.slice(0, middle), result);
    await this.sendIsolatingRejects(chunk.slice(middle), result);
  }

  /** Delivers a background failure to onError; never throws. */
  private report(error: unknown): void {
    if (this.onError === undefined) {
      return;
    }
    const typed =
      error instanceof VerdictPayError
        ? error
        : new VerdictPayError("network_error", "Background flush failed.", { cause: error });
    try {
      this.onError(typed);
    } catch {
      // A throwing handler must not break the client.
    }
  }

  /** Signs and posts one batch. */
  private async sendBatch(events: WireTelemetryEvent[]): Promise<TelemetryIngestResponse> {
    let body: string;
    try {
      body = JSON.stringify({ events });
    } catch (cause) {
      throw new VerdictPayError("validation_error", "Telemetry event metadata is not JSON-serialisable.", {
        cause,
      });
    }
    const timestamp = unixTimestamp();
    const signature = await signPayload(this.webhookSecret, timestamp, body);
    return this.requestWithRetry(
      this.baseUrl + "/api/v1/telemetry/events",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.apiKey,
          "x-verdictpay-timestamp": timestamp,
          "x-verdictpay-signature": signature,
        },
        body,
      },
      parseIngestResponse,
    );
  }

  /** Retries retryable failures with exponential backoff and jitter. */
  private async requestWithRetry<T>(
    url: string,
    init: RequestInit,
    parse: (payload: unknown) => T,
  ): Promise<T> {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      let response: Response;
      try {
        response = await this.request(url, init);
      } catch (error) {
        if (attempt === this.maxRetries) {
          throw error;
        }
        await sleep(this.backoffDelay(attempt));
        continue;
      }
      if (response.ok) {
        const payload = await this.readJson(response);
        return parse(payload);
      }
      const apiError = await this.toApiError(response);
      if (!isRetryableStatus(apiError.status) || attempt === this.maxRetries) {
        throw apiError;
      }
      await sleep(this.backoffDelay(attempt));
    }
    throw new VerdictPayError(
      "network_error",
      "Request failed after " + (this.maxRetries + 1) + " attempts: " + init.method + " " + url + ".",
    );
  }

  /** Executes one fetch with an abort-based timeout. */
  private async request(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (cause) {
      const message = controller.signal.aborted
        ? "VerdictPay API request timed out after " + this.timeoutMs + "ms: " + init.method + " " + url + "."
        : "VerdictPay API request failed: " + init.method + " " + url + ".";
      throw new VerdictPayError("network_error", message, { cause });
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Parses a non-2xx response into the matching typed error. */
  private async toApiError(response: Response): Promise<VerdictPayError> {
    const code = codeForStatus(response.status);
    let message = "VerdictPay API returned HTTP " + response.status + ".";
    let requestId: string | null = null;
    let details: unknown;
    try {
      const payload: unknown = await response.json();
      if (isRecord(payload) && isRecord(payload.error)) {
        const envelope = payload.error;
        if (typeof envelope.message === "string") {
          message = envelope.message;
        }
        if (typeof envelope.request_id === "string") {
          requestId = envelope.request_id;
        }
        details = envelope.details;
      }
    } catch {
      // A non-JSON error body still maps to the status-derived code below.
    }
    return new VerdictPayError(code, message, { status: response.status, requestId, details });
  }

  /** Reads a JSON body, mapping malformed payloads to validation_error. */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch (cause) {
      throw new VerdictPayError(
        "validation_error",
        "VerdictPay API returned a malformed JSON body (HTTP " + response.status + ").",
        { status: response.status, cause },
      );
    }
  }

  /** Exponential backoff with 50-100% jitter, capped at RETRY_MAX_MS. */
  private backoffDelay(attempt: number): number {
    const exponential = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    return Math.round(exponential * (0.5 + Math.random() * 0.5));
  }

  /**
   * Schedules one background flush when events are waiting.
   *
   * A one-shot timeout, re-armed after each attempt. (An interval whose handle
   * was forgotten kept firing forever and stacked a new interval per retry.)
   */
  private ensureTimer(): void {
    if (this.timer !== null || this.buffer.length === 0 || this.closed) {
      return;
    }
    const handle = setTimeout(() => {
      this.timer = null;
      void this.flush().catch((error: unknown) => {
        this.report(error);
      });
    }, this.flushIntervalMs);
    const unrefable = handle as unknown as { unref?: () => void };
    unrefable.unref?.();
    this.timer = handle;
  }

  /** Cancels the pending background flush. */
  private stopTimer(): void {
    if (this.timer === null) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
  }
}
