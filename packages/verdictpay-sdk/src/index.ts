/**
 * @verdictpay/sdk — pre-dispute telemetry that survives a PayPal dispute.
 *
 * @packageDocumentation
 */

export { VerdictPayClient } from "./client";
export { VerdictPayError, isVerdictPayError } from "./errors";
export type { VerdictPayErrorCode, VerdictPayErrorOptions } from "./errors";
export type {
  ApiErrorBody,
  ApiErrorDetail,
  ApiErrorResponse,
  ChainBreak,
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
