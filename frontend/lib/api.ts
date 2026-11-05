/**
 * The only network module in the app.
 *
 * Every response is parsed with the zod schemas from lib/types.ts; contract drift
 * surfaces as an ApiError with code "invalid_response" instead of a broken render.
 * The error envelope ({error: {code, message, details, request_id}}) is preserved
 * verbatim so the UI can show the request id the backend logged.
 */

import { z } from "zod";

import {
  ActionResponseSchema,
  CheckoutResponseSchema,
  CustomerTimelineSchema,
  DisputeDetailSchema,
  DisputePageSchema,
  DisputeSimulationResponseSchema,
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  ReportingSummarySchema,
  TriageResponseSchema,
  UsageResponseSchema,
  type ActionRequestInput,
  type ActionResponse,
  type CheckoutRequestInput,
  type CheckoutResponse,
  type CustomerTimeline,
  type DisputeAction,
  type DisputeDetail,
  type DisputePage,
  type DisputeSimulationRequestInput,
  type DisputeSimulationResponse,
  type ErrorDetail,
  type HealthResponse,
  type ReportingSummary,
  type TriageResponse,
  type UsageRequestInput,
  type UsageResponse,
} from "./types";

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

/**
 * Demo-only public key. It ships in the browser bundle by design for the zero-setup
 * judge demo and is documented as public in frontend/README.md. Rotate it for any
 * deployment that holds real merchant funds.
 */
export const DEMO_API_KEY = process.env.NEXT_PUBLIC_VERDICTPAY_API_KEY ?? "vp_demo_sk_local";

/** Structured API failure: code, human message and the backend request id. */
export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string | null;
  readonly details: ErrorDetail[];
  readonly status: number | null;

  constructor(input: {
    code: string;
    message: string;
    requestId?: string | null;
    details?: ErrorDetail[];
    status?: number | null;
  }) {
    super(input.message);
    this.name = "ApiError";
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.details = input.details ?? [];
    this.status = input.status ?? null;
  }
}

/** Normalise anything thrown by fetch/zod into the banner-safe ApiError shape. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof z.ZodError) {
    return new ApiError({
      code: "invalid_response",
      message: "The API returned a payload outside the frozen contract.",
      details: error.issues.map((issue) => ({
        field: issue.path.join(".") || null,
        message: issue.message,
        code: issue.code,
      })),
    });
  }
  if (error instanceof Error) {
    if (error.name === "AbortError") {
      return new ApiError({ code: "aborted", message: "Request aborted." });
    }
    return new ApiError({
      code: "network_error",
      message: error.message || "Could not reach the VerdictPay API.",
    });
  }
  return new ApiError({ code: "unknown_error", message: "Unexpected client error." });
}

type HttpMethod = "GET" | "POST";

type RequestOptions<S extends z.ZodTypeAny> = {
  schema: S;
  method?: HttpMethod;
  body?: unknown;
  signal?: AbortSignal;
};

async function readError(response: Response): Promise<ApiError> {
  const headerRequestId = response.headers.get("X-Request-Id");
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const parsed = ErrorEnvelopeSchema.safeParse(payload);
  if (parsed.success) {
    const body = parsed.data.error;
    return new ApiError({
      code: body.code,
      message: body.message,
      requestId: body.request_id ?? headerRequestId,
      details: body.details,
      status: response.status,
    });
  }
  return new ApiError({
    code: `http_${response.status}`,
    message: response.statusText || "The API rejected the request.",
    requestId: headerRequestId,
    status: response.status,
  });
}

/** Typed JSON request with envelope-aware failures and strict response parsing. */
async function requestUrl<S extends z.ZodTypeAny>(
  url: string,
  options: RequestOptions<S>,
): Promise<z.output<S>> {
  const method: HttpMethod = options.method ?? "GET";
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "X-API-Key": DEMO_API_KEY,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: options.signal,
  });

  if (!response.ok) {
    throw await readError(response);
  }

  const requestId = response.headers.get("X-Request-Id");
  const payload: unknown = await response.json();
  const parsed = options.schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError({
      code: "invalid_response",
      message: `The API response for ${url} did not match the frozen contract.`,
      requestId,
      details: parsed.error.issues.map((issue) => ({
        field: issue.path.join(".") || null,
        message: issue.message,
        code: issue.code,
      })),
      status: response.status,
    });
  }
  return parsed.data;
}

/** Typed JSON request against the VerdictPay API root. */
export async function request<S extends z.ZodTypeAny>(
  path: string,
  options: RequestOptions<S>,
): Promise<z.output<S>> {
  return requestUrl(`${API_BASE_URL}${path}`, options);
}

/**
 * Typed JSON request against a same-origin Next.js route handler.
 *
 * Used for /api/sdk/usage, which keeps the HMAC signing secret on the server
 * and returns the same frozen UsageResponse envelope as the backend.
 */
async function requestSdkUsage(
  input: UsageRequestInput,
  signal?: AbortSignal,
): Promise<UsageResponse> {
  return requestUrl("/api/sdk/usage", {
    method: "POST",
    body: input,
    schema: UsageResponseSchema,
    signal,
  });
}

/** PDF fetch that keeps the API key on an authenticated request (not in a URL). */
export async function requestBlob(path: string, signal?: AbortSignal): Promise<Blob> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/pdf", "X-API-Key": DEMO_API_KEY },
    cache: "no-store",
    signal,
  });
  if (!response.ok) {
    throw await readError(response);
  }
  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("application/pdf")) {
    throw new ApiError({
      code: "invalid_response",
      message: "Expected an application/pdf dossier but the API returned another content type.",
      requestId: response.headers.get("X-Request-Id"),
      status: response.status,
    });
  }
  return response.blob();
}

function toQuery(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query.length > 0 ? `?${query}` : "";
}

function actionBody(input: ActionRequestInput): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.note !== undefined) body.note = input.note;
  if (input.offer_ratio !== undefined) body.offer_ratio = input.offer_ratio;
  if (input.idempotency_key !== undefined) body.idempotency_key = input.idempotency_key;
  return body;
}

/** Every route the UI calls, declared once. */
export const api = {
  /** GET /health — liveness, gateway mode, database and uptime. */
  health(signal?: AbortSignal): Promise<HealthResponse> {
    return request("/api/v1/health", { schema: HealthResponseSchema, signal });
  },

  /** POST /sandbox/checkout — creates the simulated PayPal order and payer. */
  sandboxCheckout(input: CheckoutRequestInput, signal?: AbortSignal): Promise<CheckoutResponse> {
    return request("/api/v1/sandbox/checkout", {
      method: "POST",
      body: input,
      schema: CheckoutResponseSchema,
      signal,
    });
  },

  /** POST /sandbox/usage — writes four hash-chained telemetry events. */
  sandboxUsage(input: UsageRequestInput, signal?: AbortSignal): Promise<UsageResponse> {
    return request("/api/v1/sandbox/usage", {
      method: "POST",
      body: input,
      schema: UsageResponseSchema,
      signal,
    });
  },

  /** POST /api/sdk/usage — same-origin route that runs @verdictpay/sdk server-side. */
  sdkUsage: requestSdkUsage,

  /** POST /sandbox/dispute — opens an INQUIRY through the real webhook path. */
  sandboxDispute(
    input: DisputeSimulationRequestInput,
    signal?: AbortSignal,
  ): Promise<DisputeSimulationResponse> {
    return request("/api/v1/sandbox/dispute", {
      method: "POST",
      body: input,
      schema: DisputeSimulationResponseSchema,
      signal,
    });
  },

  /** GET /disputes — paginated triage queue. */
  listDisputes(
    params: { page?: number; perPage?: number } = {},
    signal?: AbortSignal,
  ): Promise<DisputePage> {
    const query = toQuery({ page: params.page, per_page: params.perPage });
    return request(`/api/v1/disputes${query}`, { schema: DisputePageSchema, signal });
  },

  /** GET /disputes/{id} — full case, EV breakdown, facts and allowed actions. */
  getDispute(disputeId: string, signal?: AbortSignal): Promise<DisputeDetail> {
    return request(`/api/v1/disputes/${encodeURIComponent(disputeId)}`, {
      schema: DisputeDetailSchema,
      signal,
    });
  },

  /** POST /disputes/{id}/triage — recomputes the deterministic decision. */
  triageDispute(disputeId: string, signal?: AbortSignal): Promise<TriageResponse> {
    return request(`/api/v1/disputes/${encodeURIComponent(disputeId)}/triage`, {
      method: "POST",
      schema: TriageResponseSchema,
      signal,
    });
  },

  /**
   * POST /disputes/{id}/actions/{action} — the HATEOAS action rail.
   * The URL segment is the uppercase DisputeAction enum value (confirmed contract).
   */
  performAction(
    disputeId: string,
    action: DisputeAction,
    input: ActionRequestInput = {},
    signal?: AbortSignal,
  ): Promise<ActionResponse> {
    return request(
      `/api/v1/disputes/${encodeURIComponent(disputeId)}/actions/${action}`,
      { method: "POST", body: actionBody(input), schema: ActionResponseSchema, signal },
    );
  },

  /** GET /disputes/{id}/dossier.pdf — seller-protection dossier, built on demand. */
  dossierPdf(disputeId: string, signal?: AbortSignal): Promise<Blob> {
    return requestBlob(`/api/v1/disputes/${encodeURIComponent(disputeId)}/dossier.pdf`, signal);
  },

  /** GET /reporting/summary — exposure, protection and fee-saved KPIs. */
  reportingSummary(signal?: AbortSignal): Promise<ReportingSummary> {
    return request("/api/v1/reporting/summary", { schema: ReportingSummarySchema, signal });
  },

  /** GET /customers/{payer_id}/timeline — telemetry events plus chain verification. */
  customerTimeline(payerId: string, signal?: AbortSignal): Promise<CustomerTimeline> {
    return request(`/api/v1/customers/${encodeURIComponent(payerId)}/timeline`, {
      schema: CustomerTimelineSchema,
      signal,
    });
  },
} as const;

/** Endpoint map rendered on /settings so the connection surface is honest. */
export const API_ENDPOINTS = [
  { method: "GET", path: "/api/v1/health", purpose: "Gateway mode, database and uptime" },
  { method: "POST", path: "/api/v1/sandbox/checkout", purpose: "Simulated PayPal order" },
  { method: "POST", path: "/api/v1/sandbox/usage", purpose: "Four chained telemetry events" },
  { method: "POST", path: "/api/v1/sandbox/dispute", purpose: "Open INQUIRY via webhook path" },
  { method: "GET", path: "/api/v1/disputes", purpose: "Paginated triage queue" },
  { method: "GET", path: "/api/v1/disputes/{id}", purpose: "Case, EV and allowed actions" },
  { method: "POST", path: "/api/v1/disputes/{id}/triage", purpose: "Recompute deterministic EV" },
  { method: "POST", path: "/api/v1/disputes/{id}/actions/{action}", purpose: "HATEOAS action rail" },
  { method: "GET", path: "/api/v1/disputes/{id}/dossier.pdf", purpose: "Evidence dossier PDF" },
  { method: "GET", path: "/api/v1/reporting/summary", purpose: "Exposure and win-rate KPIs" },
  { method: "GET", path: "/api/v1/customers/{payer_id}/timeline", purpose: "Payer telemetry timeline" },
] as const;