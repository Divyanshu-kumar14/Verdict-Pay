/**
 * Typed errors thrown by @verdictpay/sdk.
 *
 * Every failure mode has one stable code so callers never have to parse
 * message strings. The API key is never included in any error, message or log.
 */

/** Stable error codes. */
export type VerdictPayErrorCode =
  | "invalid_config"
  | "unauthorized"
  | "rate_limited"
  | "server_error"
  | "network_error"
  | "validation_error";

/** Extra context attached to a {@link VerdictPayError}. */
export interface VerdictPayErrorOptions {
  /** HTTP status when the failure came from the API. */
  status?: number;
  /** X-Request-Id echoed by the API, for support. */
  requestId?: string | null;
  /** Server-provided validation details, when present. */
  details?: unknown;
  /** Original cause, preserved for debugging. */
  cause?: unknown;
}

/** Error class thrown by every public SDK method. */
export class VerdictPayError extends Error {
  /** Stable machine-readable code. */
  readonly code: VerdictPayErrorCode;
  /** HTTP status when the failure came from the API. */
  readonly status?: number;
  /** X-Request-Id echoed by the API, for support. */
  readonly requestId?: string | null;
  /** Server-provided validation details, when present. */
  readonly details?: unknown;

  /** Creates a typed SDK error. */
  constructor(code: VerdictPayErrorCode, message: string, options: VerdictPayErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "VerdictPayError";
    this.code = code;
    this.status = options.status;
    this.requestId = options.requestId;
    this.details = options.details;
  }
}

/** Narrows an unknown thrown value to a {@link VerdictPayError}. */
export function isVerdictPayError(value: unknown): value is VerdictPayError {
  return value instanceof VerdictPayError;
}
