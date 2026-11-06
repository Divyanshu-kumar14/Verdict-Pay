/**
 * Zod mirrors of the frozen Pydantic contract in backend/app/api/schemas.py.
 *
 * Two conventions matter here:
 *  - Money is serialised by Pydantic as a JSON string ("99.00"), so every money
 *    field is coerced to a number exactly once, at the boundary.
 *  - Datetimes stay ISO strings and are parsed by lib/format.ts at render time,
 *    which keeps every formatter pure and testable.
 */

import { z } from "zod";

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((value) => (typeof value === "string" ? Number(value) : value))
  .refine((value) => Number.isFinite(value), { message: "Expected a finite decimal" });

const isoDateTimeSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), { message: "Expected an ISO-8601 datetime" });

/* ----------------------------------------------------------------- enums */

export const TELEMETRY_EVENT_TYPES = [
  "TOS_ACCEPTED",
  "SESSION_AUTH",
  "ASSET_DELIVERED",
  "USAGE_METERED",
] as const;
export type TelemetryEventType = (typeof TELEMETRY_EVENT_TYPES)[number];
export const TelemetryEventTypeSchema = z.enum(TELEMETRY_EVENT_TYPES);

export const DISPUTE_STAGES = [
  "INQUIRY",
  "CHARGEBACK",
  "PRE_ARBITRATION",
  "RESOLVED",
  "CLOSED",
] as const;
export type DisputeStage = (typeof DISPUTE_STAGES)[number];
export const DisputeStageSchema = z.enum(DISPUTE_STAGES);

export const DISPUTE_CHANNELS = ["INTERNAL", "EXTERNAL"] as const;
export type DisputeChannel = (typeof DISPUTE_CHANNELS)[number];
export const DisputeChannelSchema = z.enum(DISPUTE_CHANNELS);

export const DISPUTE_REASONS = [
  "MERCHANDISE_OR_SERVICE_NOT_RECEIVED",
  "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
  "UNAUTHORIZED",
  "OTHER",
] as const;
export type DisputeReason = (typeof DISPUTE_REASONS)[number];
export const DisputeReasonSchema = z.enum(DISPUTE_REASONS);

export const DISPUTE_STATUSES = [
  "OPEN",
  "WAITING_FOR_SELLER_RESPONSE",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];
export const DisputeStatusSchema = z.enum(DISPUTE_STATUSES);

export const RECOMMENDED_ACTIONS = [
  "DEFLECT_INQUIRY",
  "MAKE_OFFER",
  "ACCEPT_CLAIM",
  "PROVIDE_EVIDENCE",
  "MONITOR",
] as const;
export type RecommendedAction = (typeof RECOMMENDED_ACTIONS)[number];
export const RecommendedActionSchema = z.enum(RECOMMENDED_ACTIONS);

export const DISPUTE_ACTIONS = [
  "SEND_MESSAGE",
  "MAKE_OFFER",
  "ACCEPT_CLAIM",
  "PROVIDE_EVIDENCE",
] as const;
export type DisputeAction = (typeof DISPUTE_ACTIONS)[number];
export const DisputeActionSchema = z.enum(DISPUTE_ACTIONS);

export const ACTION_STATUSES = ["EXECUTED", "FAILED", "SKIPPED"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ActionStatusSchema = z.enum(ACTION_STATUSES);

/* ---------------------------------------------------------------- errors */

export const ErrorDetailSchema = z.object({
  field: z.string().nullable().optional(),
  message: z.string(),
  code: z.string().nullable().optional(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorBodySchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.array(ErrorDetailSchema).default([]),
  request_id: z.string().nullable().optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorEnvelopeSchema = z.object({ error: ErrorBodySchema });
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;

/* ---------------------------------------------------------------- health */

export const HealthResponseSchema = z.object({
  status: z.string(),
  mode: z.string(),
  version: z.string(),
  database: z.string(),
  gateway: z.string(),
  llm: z.string(),
  demo_mode: z.boolean(),
  uptime_seconds: z.number(),
  timestamp: isoDateTimeSchema,
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/* ------------------------------------------------------------- telemetry */

export const TelemetryEventOutSchema = z.object({
  id: z.string(),
  event_id: z.string().nullable(),
  event_type: TelemetryEventTypeSchema,
  paypal_payer_id: z.string(),
  sequence: z.number().int(),
  client_ip: z.string(),
  device_fingerprint: z.string(),
  resource_id: z.string().nullable(),
  resource_sha256: z.string().nullable(),
  units_consumed: z.number().int(),
  prev_hash: z.string(),
  chain_hash: z.string(),
  created_at: isoDateTimeSchema,
});
export type TelemetryEventOut = z.infer<typeof TelemetryEventOutSchema>;

export const ChainBreakSchema = z.object({
  sequence: z.number().int(),
  event_id: z.string(),
  expected_prev_hash: z.string(),
  actual_prev_hash: z.string(),
  stored_hash: z.string(),
  recomputed_hash: z.string(),
});
export type ChainBreak = z.infer<typeof ChainBreakSchema>;

export const ChainVerificationSchema = z.object({
  payer_id: z.string(),
  valid: z.boolean(),
  event_count: z.number().int(),
  head_hash: z.string(),
  broken_at_sequence: z.number().int().nullable(),
  breaks: z.array(ChainBreakSchema).default([]),
  verified_at: isoDateTimeSchema,
});
export type ChainVerification = z.infer<typeof ChainVerificationSchema>;

export const TimelineSummarySchema = z.object({
  first_seen: isoDateTimeSchema.nullable(),
  last_seen: isoDateTimeSchema.nullable(),
  distinct_ips: z.number().int(),
  distinct_devices: z.number().int(),
  total_units: z.number().int(),
  assets_delivered: z.number().int(),
  login_count: z.number().int(),
  tos_versions: z.array(z.string()),
});
export type TimelineSummary = z.infer<typeof TimelineSummarySchema>;

export const CustomerTimelineSchema = z.object({
  payer_id: z.string(),
  events: z.array(TelemetryEventOutSchema),
  summary: TimelineSummarySchema,
  chain: ChainVerificationSchema,
});
export type CustomerTimeline = z.infer<typeof CustomerTimelineSchema>;

/* --------------------------------------------------------------- sandbox */

export const CheckoutResponseSchema = z.object({
  order_id: z.string(),
  subscription_id: z.string().nullable(),
  payer_id: z.string(),
  status: z.string(),
  amount_usd: moneySchema,
  currency: z.string(),
  approval_url: z.string(),
  created_at: isoDateTimeSchema,
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

export const UsageResponseSchema = z.object({
  chain: ChainVerificationSchema,
  events: z.array(TelemetryEventOutSchema),
  totals: z.record(z.number().int()),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export type CheckoutRequestInput = {
  plan?: "pro" | "scale";
  payer_id?: string;
  email?: string;
  tos_version?: string;
};

export type UsageRequestInput = {
  payer_id: string;
  order_id: string;
  subscription_id?: string;
  logins?: number;
  tokens?: number;
  export_name?: string;
  client_ip?: string;
  device_fingerprint?: string;
};

export type DisputeSimulationRequestInput = {
  payer_id?: string;
  order_id?: string;
  reason_code?: DisputeReason;
  stage?: DisputeStage;
  channel?: DisputeChannel;
  amount_usd?: number;
};

/* -------------------------------------------------------------- disputes */

export const EvBreakdownSchema = z.object({
  amount_usd: moneySchema,
  high_volume: z.boolean(),
  high_volume_fee_usd: moneySchema,
  standard_fee_usd: moneySchema,
  penalty_ratio_usd: moneySchema,
  ratio_before: z.number(),
  ratio_after: z.number(),
  crosses_cliff: z.boolean(),
  p_win: z.number(),
  offer_ratio: z.number(),
  ev_fight_usd: moneySchema,
  ev_settle_usd: moneySchema,
  ev_offer_usd: moneySchema,
  best_action: RecommendedActionSchema,
  formula_notes: z.array(z.string()).default([]),
});
export type EvBreakdown = z.infer<typeof EvBreakdownSchema>;

export const SignalContributionSchema = z.object({
  key: z.string(),
  label: z.string(),
  delta: z.number(),
  present: z.boolean(),
});
export type SignalContribution = z.infer<typeof SignalContributionSchema>;

export const WinProbabilitySchema = z.object({
  score: z.number(),
  base: z.number(),
  signal_sum: z.number(),
  reason_multiplier: z.number(),
  signals: z.array(SignalContributionSchema),
});
export type WinProbability = z.infer<typeof WinProbabilitySchema>;

export const AllowedActionSchema = z.object({
  action: DisputeActionSchema,
  allowed: z.boolean(),
  reason: z.string().nullable(),
  fee_usd: moneySchema,
  paypal_link: z.string().nullable(),
});
export type AllowedAction = z.infer<typeof AllowedActionSchema>;

export const RationaleItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  detail: z.string(),
});
export type RationaleItem = z.infer<typeof RationaleItemSchema>;

export const CaseFactsSchema = z.object({
  payer_id: z.string(),
  chain_valid: z.boolean(),
  chain_head: z.string(),
  event_count: z.number().int(),
  completeness: z.number(),
  tos_version: z.string().nullable(),
  tos_hash: z.string().nullable(),
  tos_accepted_at: isoDateTimeSchema.nullable(),
  first_seen: isoDateTimeSchema.nullable(),
  last_seen: isoDateTimeSchema.nullable(),
  ips: z.array(z.string()),
  devices: z.array(z.string()),
  deliveries: z.array(z.record(z.unknown())),
  usage_units: z.number().int(),
  usage_events: z.number().int(),
  login_count: z.number().int(),
  response_due_date: isoDateTimeSchema.nullable(),
  ce3_matches: z.array(z.record(z.unknown())),
  ce3_window_days: z.number().int(),
  signals: z.record(z.boolean()),
});
export type CaseFacts = z.infer<typeof CaseFactsSchema>;

export const ActionRecordSchema = z.object({
  action_id: z.string(),
  action: DisputeActionSchema,
  status: ActionStatusSchema,
  latency_ms: z.number().int(),
  created_at: isoDateTimeSchema,
  error: z.string().nullable(),
});
export type ActionRecord = z.infer<typeof ActionRecordSchema>;

export const DisputeSummarySchema = z.object({
  dispute_id: z.string(),
  payer_id: z.string(),
  order_id: z.string(),
  subscription_id: z.string().nullable(),
  reason_code: DisputeReasonSchema,
  stage: DisputeStageSchema,
  channel: DisputeChannelSchema,
  status: DisputeStatusSchema,
  currency: z.string(),
  amount_usd: moneySchema,
  p_win: z.number(),
  ev_fight_usd: moneySchema,
  ev_settle_usd: moneySchema,
  ev_offer_usd: moneySchema,
  telemetry_completeness: z.number(),
  recommended_action: RecommendedActionSchema,
  subscription_suspended: z.boolean(),
  dossier_available: z.boolean(),
  seller_response_due_date: isoDateTimeSchema.nullable(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
export type DisputeSummary = z.infer<typeof DisputeSummarySchema>;

export const DisputeDetailSchema = DisputeSummarySchema.extend({
  breakdown: EvBreakdownSchema,
  win_probability: WinProbabilitySchema,
  allowed_actions: z.array(AllowedActionSchema),
  rationale: z.array(RationaleItemSchema),
  facts: CaseFactsSchema,
  actions: z.array(ActionRecordSchema),
});
export type DisputeDetail = z.infer<typeof DisputeDetailSchema>;

export const ActionResponseSchema = z.object({
  action_id: z.string(),
  dispute_id: z.string(),
  action: DisputeActionSchema,
  status: ActionStatusSchema,
  latency_ms: z.number().int(),
  upstream: z.record(z.unknown()).default({}),
  case: DisputeSummarySchema,
});
export type ActionResponse = z.infer<typeof ActionResponseSchema>;

export const TriageResponseSchema = z.object({
  dispute_id: z.string(),
  recommended_action: RecommendedActionSchema,
  breakdown: EvBreakdownSchema,
  win_probability: WinProbabilitySchema,
  allowed_actions: z.array(AllowedActionSchema),
  rationale: z.array(RationaleItemSchema),
});
export type TriageResponse = z.infer<typeof TriageResponseSchema>;

export const DisputeSimulationResponseSchema = z.object({
  dispute: DisputeSummarySchema,
  webhook_event_id: z.string(),
  triage_triggered: z.boolean(),
  containment: z.record(z.unknown()).default({}),
});
export type DisputeSimulationResponse = z.infer<typeof DisputeSimulationResponseSchema>;

export type ActionRequestInput = {
  note?: string;
  offer_ratio?: number;
  idempotency_key?: string;
};

/* -------------------------------------------------------------- reporting */

export const PageMetaSchema = z.object({
  total: z.number().int(),
  page: z.number().int(),
  per_page: z.number().int(),
  total_pages: z.number().int(),
});
export type PageMeta = z.infer<typeof PageMetaSchema>;

export const DisputePageSchema = z.object({
  data: z.array(DisputeSummarySchema),
  meta: PageMetaSchema,
});
export type DisputePage = z.infer<typeof DisputePageSchema>;

export const HighVolumeStatusSchema = z.object({
  flag: z.boolean(),
  ratio: z.number(),
  threshold: z.number(),
  sales_3mo: z.number().int(),
  disputes_3mo: z.number().int(),
});
export type HighVolumeStatus = z.infer<typeof HighVolumeStatusSchema>;

export const ReportingSummarySchema = z.object({
  total_cases: z.number().int(),
  open_cases: z.number().int(),
  in_inquiry: z.number().int(),
  in_claim: z.number().int(),
  total_exposure_usd: moneySchema,
  protected_usd: moneySchema,
  fees_avoided_usd: moneySchema,
  avg_p_win: z.number(),
  win_rate_estimate: z.number(),
  subscription_suspensions: z.number().int(),
  chain_verified_customers: z.number().int(),
  high_volume: HighVolumeStatusSchema,
  generated_at: isoDateTimeSchema,
});
export type ReportingSummary = z.infer<typeof ReportingSummarySchema>;
