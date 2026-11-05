/**
 * Public types for @verdictpay/sdk.
 *
 * Wire shapes mirror the FROZEN backend contract in
 * backend/app/api/schemas.py and backend/app/domain/enums.py. Do not rename
 * fields here without changing the Python schemas and the frontend zod parsers.
 */

/** Canonical telemetry event types accepted by the VerdictPay ledger. */
export type TelemetryEventType =
  | "TOS_ACCEPTED"
  | "SESSION_AUTH"
  | "ASSET_DELIVERED"
  | "USAGE_METERED";

/** One row of the append-only hash chain, as returned by the API. */
export interface TelemetryEventOut {
  id: string;
  event_id: string | null;
  event_type: TelemetryEventType;
  paypal_payer_id: string;
  sequence: number;
  client_ip: string;
  device_fingerprint: string;
  resource_id: string | null;
  resource_sha256: string | null;
  units_consumed: number;
  prev_hash: string;
  chain_hash: string;
  created_at: string;
}

/** A single broken link in a payer's hash chain. */
export interface ChainBreak {
  sequence: number;
  event_id: string;
  expected_prev_hash: string;
  actual_prev_hash: string;
  stored_hash: string;
  recomputed_hash: string;
}

/** Result of GET /api/v1/telemetry/chain/{payer_id}/verify. */
export interface ChainVerification {
  payer_id: string;
  valid: boolean;
  event_count: number;
  head_hash: string;
  broken_at_sequence: number | null;
  breaks: ChainBreak[];
  verified_at: string;
}

/** Response body of POST /api/v1/telemetry/events. */
export interface TelemetryIngestResponse {
  accepted: number;
  duplicates: number;
  events: TelemetryEventOut[];
  chain: ChainVerification;
}

/** The shape returned by {@link FlushResult}. */
export interface FlushResult {
  accepted: number;
  duplicates: number;
  events: TelemetryEventOut[];
  /** Null when flush() ran on an empty buffer. */
  chain: ChainVerification | null;
}

/** Error envelope shared by every VerdictPay endpoint. */
export interface ApiErrorDetail {
  field?: string | null;
  message: string;
  code?: string | null;
}

/** Error envelope shared by every VerdictPay endpoint. */
export interface ApiErrorBody {
  code: string;
  message: string;
  details: ApiErrorDetail[];
  request_id?: string | null;
}

/** Error envelope shared by every VerdictPay endpoint. */
export interface ApiErrorResponse {
  error: ApiErrorBody;
}

/** Configuration for {@link VerdictPayClient}. */
export interface VerdictPayClientOptions {
  /** Merchant API key. Sent as X-API-Key. Never logged. */
  apiKey: string;
  /** Shared HMAC secret (VERDICTPAY_SIGNING_SECRET). Never logged. */
  webhookSecret: string;
  /** API root, default "http://localhost:8000". */
  baseUrl?: string;
  /** Injectable fetch implementation (tests, browsers, edge runtimes). */
  fetch?: typeof fetch;
  /** Retries after the first attempt. Default 3. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 10000. */
  timeoutMs?: number;
  /** Events per request. Default 10; server maximum is 500. */
  batchSize?: number;
  /** Background flush interval in milliseconds. Default 5000. */
  flushIntervalMs?: number;
}

/**
 * Checkout-time ToS acceptance. Maps to a single TOS_ACCEPTED event.
 * The ToS hash is what makes "they accepted the refund policy" provable.
 */
export interface CheckoutTrackingInput {
  paypalPayerId: string;
  paypalOrderId?: string;
  paypalSubscriptionId?: string;
  userEmail?: string;
  clientIp?: string;
  deviceFingerprint?: string;
  tosVersion: string;
  tosContentSha256: string;
}

/**
 * Digital delivery receipt. Maps to ASSET_DELIVERED by default; the canonical
 * event type can be overridden with eventType (for example SESSION_AUTH when a
 * delivery and form part of the same server call).
 */
export interface DeliveryTrackingInput {
  paypalPayerId: string;
  eventType?: TelemetryEventType;
  resourceId: string;
  resourceSha256: string;
  computeUnitsConsumed?: number;
  clientIp?: string;
  deviceFingerprint?: string;
}

/** Metered consumption. Maps to a USAGE_METERED event. */
export interface UsageTrackingInput {
  paypalPayerId: string;
  units: number;
  resourceId?: string;
  clientIp?: string;
  deviceFingerprint?: string;
}

/** Fully explicit event for callers that need to emit SESSION_AUTH or extra fields. */
export interface EventInput {
  eventType: TelemetryEventType;
  paypalPayerId: string;
  paypalOrderId?: string;
  paypalSubscriptionId?: string;
  clientIp?: string;
  deviceFingerprint?: string;
  resourceId?: string;
  resourceSha256?: string;
  unitsConsumed?: number;
  occurredAt?: Date | string;
  tosVersion?: string;
  tosContentSha256?: string;
  metadata?: Record<string, unknown>;
  /** Stable idempotency id. Generated with crypto.randomUUID() when omitted. */
  eventId?: string;
}
