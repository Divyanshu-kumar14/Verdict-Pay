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

/** An order is not a payment: the furthest stage PayPal actually confirmed. */
export const ORDER_LIFECYCLE_STAGES = ["CREATED", "APPROVED", "CAPTURED", "FAILED"] as const;
export type OrderLifecycleStage = (typeof ORDER_LIFECYCLE_STAGES)[number];
export const OrderLifecycleStageSchema = z.enum(ORDER_LIFECYCLE_STAGES);

/** A capture either produced money or it did not; there is no middle stage. */
export const CAPTURE_LIFECYCLE_STAGES = ["CAPTURED", "FAILED"] as const;
export type CaptureLifecycleStage = (typeof CAPTURE_LIFECYCLE_STAGES)[number];
export const CaptureLifecycleStageSchema = z.enum(CAPTURE_LIFECYCLE_STAGES);

/** Honest provenance: which backend produced the money movement. */
export const PROVENANCES = ["paypal_sandbox", "paypal_live", "local_simulator"] as const;
export type Provenance = (typeof PROVENANCES)[number];
export const ProvenanceSchema = z.enum(PROVENANCES);

export const DEMO_RUN_STATUSES = ["OPEN", "COMPLETED", "ABANDONED"] as const;
export type DemoRunStatus = (typeof DEMO_RUN_STATUSES)[number];
export const DemoRunStatusSchema = z.enum(DEMO_RUN_STATUSES);

export const GATEWAY_READINESSES = ["ready", "degraded", "unconfigured"] as const;
export type GatewayReadiness = (typeof GATEWAY_READINESSES)[number];
export const GatewayReadinessSchema = z.enum(GATEWAY_READINESSES);

/**
 * The authoritative comparison between the dispute ratio and the policy line.
 * Never infer this from ``crosses_cliff``: "no cliff" is also true for a
 * merchant who is already above the threshold (the "3.00% below 1.50%" bug).
 */
export const RATIO_RELATIONS = ["below", "at_or_above"] as const;
export type RatioRelation = (typeof RATIO_RELATIONS)[number];
export const RatioRelationSchema = z.enum(RATIO_RELATIONS);

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

/**
 * Judge-facing gateway completeness. Carries no secret: only booleans, the API
 * base and the human-readable blockers that keep a mode from being ready.
 */
export const GatewayStatusSchema = z.object({
  mode: z.string(),
  readiness: GatewayReadinessSchema,
  sandbox: z.boolean(),
  live: z.boolean(),
  simulation: z.boolean(),
  api_base: z.string(),
  credentials_configured: z.boolean(),
  webhook_configured: z.boolean(),
  blockers: z.array(z.string()).default([]),
});
export type GatewayStatus = z.infer<typeof GatewayStatusSchema>;

export const AiStatusSchema = z.object({
  provider: z.string(),
  model: z.string(),
  enabled: z.boolean(),
  configured: z.boolean(),
  timeout_ms: z.number().int(),
  prompt_version: z.string(),
});
export type AiStatus = z.infer<typeof AiStatusSchema>;

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
  // Optional so an older backend still parses; a current one always sends both.
  gateway_status: GatewayStatusSchema.nullable().default(null),
  ai_status: AiStatusSchema.nullable().default(null),
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

/**
 * A persisted money movement. ``source`` is the provenance label
 * ("paypal_sandbox" / "paypal_live" / "local_simulator"), never a secret.
 */
export const TransactionOutSchema = z.object({
  transaction_id: z.string(),
  payer_id: z.string(),
  order_id: z.string().nullable(),
  amount_usd: moneySchema,
  currency: z.string(),
  status: z.string(),
  client_ip: z.string(),
  device_fingerprint: z.string(),
  source: z.string(),
  created_at: isoDateTimeSchema,
});
export type TransactionOut = z.infer<typeof TransactionOutSchema>;

/**
 * A created order — NOT a payment. ``status``/``lifecycle_stage`` must be read
 * literally: CREATED means PayPal accepted the order and nobody has paid yet.
 */
export const CheckoutResponseSchema = z.object({
  order_id: z.string(),
  run_id: z.string().nullable().default(null),
  subscription_id: z.string().nullable(),
  payer_id: z.string(),
  status: z.string(),
  amount_usd: moneySchema,
  currency: z.string(),
  approval_url: z.string(),
  created_at: isoDateTimeSchema,
  gateway_mode: z.string(),
  sandbox: z.boolean(),
  lifecycle_stage: OrderLifecycleStageSchema.default("CREATED"),
  provenance: ProvenanceSchema.default("local_simulator"),
  paypal_debug_id: z.string().nullable().default(null),
});
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;

/** Live order state straight from PayPal (or the local simulator). */
export const OrderStatusResponseSchema = z.object({
  order_id: z.string(),
  run_id: z.string().nullable().default(null),
  status: z.string(),
  lifecycle_stage: OrderLifecycleStageSchema,
  amount_usd: moneySchema,
  currency: z.string(),
  payer_id: z.string().nullable().default(null),
  approval_url: z.string().nullable().default(null),
  capture_id: z.string().nullable().default(null),
  capture_status: z.string().nullable().default(null),
  captured_at: isoDateTimeSchema.nullable().default(null),
  gateway_mode: z.string(),
  provenance: ProvenanceSchema,
  paypal_debug_id: z.string().nullable().default(null),
  payer_action_required: z.boolean().default(false),
  detail: z.string().nullable().default(null),
});
export type OrderStatusResponse = z.infer<typeof OrderStatusResponseSchema>;

/** POST /orders/{id}/capture — the only path that yields money. */
export const CaptureResponseSchema = z.object({
  order_id: z.string(),
  run_id: z.string().nullable().default(null),
  capture_id: z.string().nullable(),
  capture_status: z.string(),
  lifecycle_stage: CaptureLifecycleStageSchema,
  amount_usd: moneySchema,
  currency: z.string(),
  payer_id: z.string().nullable().default(null),
  captured_at: isoDateTimeSchema.nullable().default(null),
  transaction: TransactionOutSchema.nullable().default(null),
  gateway_mode: z.string(),
  provenance: ProvenanceSchema,
  paypal_debug_id: z.string().nullable().default(null),
  detail: z.string().nullable().default(null),
});
export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;

export const UsageResponseSchema = z.object({
  chain: ChainVerificationSchema,
  events: z.array(TelemetryEventOutSchema),
  totals: z.record(z.number().int()),
  run_id: z.string().nullable().default(null),
});
export type UsageResponse = z.infer<typeof UsageResponseSchema>;

export type CheckoutRequestInput = {
  plan?: "pro" | "scale";
  payer_id?: string;
  email?: string;
  tos_version?: string;
  run_id?: string;
};

export type CaptureRequestInput = {
  run_id?: string;
};

/** camelCase form used by the sandbox order flow (mapped to snake_case in api.ts). */
export type CreateOrderInput = {
  plan?: "pro" | "scale";
  email?: string;
  payerId?: string;
  tosVersion?: string;
  runId?: string;
};

export type CaptureOrderInput = {
  runId?: string;
};

export type UsageRequestInput = {
  payer_id: string;
  order_id: string;
  subscription_id?: string;
  run_id?: string;
  logins?: number;
  tokens?: number;
  export_name?: string;
  client_ip?: string;
  device_fingerprint?: string;
};

export type DisputeSimulationRequestInput = {
  payer_id?: string;
  order_id?: string;
  run_id?: string;
  reason_code?: DisputeReason;
  stage?: DisputeStage;
  channel?: DisputeChannel;
  amount_usd?: number;
  claim_text?: string;
};

/* ------------------------------------------------------------- demo runs */

/** One isolated judge run: its own order, telemetry, dispute and analysis. */
export const DemoRunSchema = z.object({
  run_id: z.string(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
  status: DemoRunStatusSchema,
  gateway_mode: z.string(),
  provenance: ProvenanceSchema,
  payer_id: z.string().nullable().default(null),
  order_id: z.string().nullable().default(null),
  capture_id: z.string().nullable().default(null),
  order_stage: OrderLifecycleStageSchema.nullable().default(null),
  amount_usd: moneySchema.nullable().default(null),
  currency: z.string().nullable().default(null),
  chain_head: z.string().nullable().default(null),
  chain_valid: z.boolean().nullable().default(null),
  event_count: z.number().int().default(0),
  dispute_id: z.string().nullable().default(null),
  ai_analyzed: z.boolean().default(false),
  dossier_available: z.boolean().default(false),
  steps: z.record(z.string()).default({}),
});
export type DemoRun = z.infer<typeof DemoRunSchema>;

export const DemoRunListSchema = z.object({
  runs: z.array(DemoRunSchema).default([]),
  total: z.number().int(),
});
export type DemoRunList = z.infer<typeof DemoRunListSchema>;

export const DemoResetResponseSchema = z.object({
  run_id: z.string(),
  cleared_runs: z.number().int(),
  cleared_cases: z.number().int(),
  merchant_records_preserved: z.number().int(),
  detail: z.string(),
});
export type DemoResetResponse = z.infer<typeof DemoResetResponseSchema>;

/* -------------------------------------------------------------- disputes */

export const EvBreakdownSchema = z.object({
  amount_usd: moneySchema,
  high_volume: z.boolean(),
  high_volume_fee_usd: moneySchema,
  standard_fee_usd: moneySchema,
  penalty_ratio_usd: moneySchema,
  ratio_before: z.number(),
  ratio_after: z.number(),
  /**
   * Threshold metadata: the policy line the backend actually scored against,
   * plus a machine-checkable verdict. ``ratio_relation`` is authoritative —
   * renderers must never infer the relation from ``crosses_cliff``.
   */
  ratio_threshold: z.number(),
  ratio_relation: RatioRelationSchema,
  threshold_crossed_now: z.boolean(),
  high_volume_min_sales: z.number().int(),
  sales_3mo: z.number().int(),
  disputes_3mo: z.number().int(),
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
  /** Buyer's own words when the case was opened; clipped server-side to 4000. */
  buyer_claim_text: z.string().nullable().default(null),
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
  /** The isolated judge run this case belongs to; null for non-demo records. */
  run_id: z.string().nullable().default(null),
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

/** One row of the Fight / Settle / Make-offer comparison. */
export const DecisionOptionSchema = z.object({
  action: RecommendedActionSchema,
  label: z.string(),
  value_usd: moneySchema,
  detail: z.string(),
  is_policy_choice: z.boolean(),
  is_best_financial: z.boolean(),
  paypal_action_available: z.boolean(),
  paypal_action_reason: z.string().nullable().default(null),
});
export type DecisionOption = z.infer<typeof DecisionOptionSchema>;

/**
 * Policy recommendation vs lowest modelled loss — two distinct concepts.
 * ``agree`` is false when the rules select something other than the cheapest
 * modelled outcome; the UI must then explain both rather than implying the
 * recommendation is the financially optimal one.
 */
export const DecisionComparisonSchema = z.object({
  policy_action: RecommendedActionSchema,
  policy_label: z.string(),
  policy_reason: z.string(),
  best_financial_action: RecommendedActionSchema,
  best_financial_label: z.string(),
  agree: z.boolean(),
  divergence_explanation: z.string().nullable().default(null),
  options: z.array(DecisionOptionSchema).default([]),
});
export type DecisionComparison = z.infer<typeof DecisionComparisonSchema>;

export const DisputeDetailSchema = DisputeSummarySchema.extend({
  breakdown: EvBreakdownSchema,
  win_probability: WinProbabilitySchema,
  allowed_actions: z.array(AllowedActionSchema),
  rationale: z.array(RationaleItemSchema),
  facts: CaseFactsSchema,
  actions: z.array(ActionRecordSchema),
  /** Null when the case predates the comparison or the engine skipped it. */
  decision_comparison: DecisionComparisonSchema.nullable().default(null),
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

/** Where the simulated dispute came from: an internal test event or real sandbox webhook. */
export const SIMULATION_ORIGINS = ["internal_test_event", "paypal_sandbox"] as const;
export type SimulationOrigin = (typeof SIMULATION_ORIGINS)[number];
export const SimulationOriginSchema = z.enum(SIMULATION_ORIGINS);

export const DisputeSimulationResponseSchema = z.object({
  dispute: DisputeSummarySchema,
  webhook_event_id: z.string(),
  triage_triggered: z.boolean(),
  containment: z.record(z.unknown()).default({}),
  origin: SimulationOriginSchema.default("internal_test_event"),
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

/* -------------------------------------------------------------- ai analysis */

export const AI_CLASSIFICATION_CATEGORIES = [
  "not_as_described",
  "unauthorized",
  "not_received",
  "duplicate",
  "other",
] as const;
export type AiClassificationCategory = (typeof AI_CLASSIFICATION_CATEGORIES)[number];
export const AiClassificationCategorySchema = z.enum(AI_CLASSIFICATION_CATEGORIES);

export const AnalyzeClassificationSchema = z.object({
  category: AiClassificationCategorySchema,
  confidence: z.number(),
  rationale: z.string(),
  reason_code: z.string(),
  reason_multiplier: z.number(),
});
export type AnalyzeClassification = z.infer<typeof AnalyzeClassificationSchema>;

export const AnalyzeNarrativeSchema = z.object({
  title: z.string(),
  narrative: z.string(),
  grounded: z.boolean(),
  model: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type AnalyzeNarrative = z.infer<typeof AnalyzeNarrativeSchema>;

export const AnalyzeExplanationSchema = z.object({
  summary: z.string(),
  bullets: z.array(z.string()).default([]),
});
export type AnalyzeExplanation = z.infer<typeof AnalyzeExplanationSchema>;

export const AnalyzeProvenanceSchema = z.object({
  recorded: z.boolean(),
  event_id: z.string().nullable(),
  chain_head: z.string().nullable(),
  sequence: z.number().int().nullable(),
  note: z.string(),
});
export type AnalyzeProvenance = z.infer<typeof AnalyzeProvenanceSchema>;

export const AnalyzeResponseSchema = z.object({
  dispute_id: z.string(),
  prompt_version: z.string(),
  generated_at: isoDateTimeSchema,
  classification: AnalyzeClassificationSchema,
  win_probability: WinProbabilitySchema,
  expected_value: EvBreakdownSchema,
  narrative: AnalyzeNarrativeSchema,
  explanation: AnalyzeExplanationSchema,
  provenance: AnalyzeProvenanceSchema,
  degraded: z.boolean(),
  degraded_reason: z.string().nullable(),
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;

export type AnalyzeRequestInput = {
  claim_text?: string | null;
};

/* ----------------------------------------------------------------- dossier */

/**
 * Everything a judge needs to verify a downloaded dossier independently:
 * the SHA-256 of the exact bytes, the chain head it was built from and where to
 * fetch it. ``snapshot_hash`` is the frozen evidence set the PDF was rendered from.
 */
export const DossierManifestSchema = z.object({
  dispute_id: z.string(),
  run_id: z.string().nullable().default(null),
  filename: z.string(),
  sha256: z.string(),
  size_bytes: z.number().int(),
  generated_at: isoDateTimeSchema,
  chain_head: z.string().nullable().default(null),
  chain_valid: z.boolean().nullable().default(null),
  event_count: z.number().int().default(0),
  narrative_source: z.string().default("template"),
  snapshot_hash: z.string().nullable().default(null),
  download_url: z.string(),
});
export type DossierManifest = z.infer<typeof DossierManifestSchema>;

/**
 * Result of re-rendering the dossier from its frozen snapshot and diffing the
 * bytes. ``verified`` false must be shown as a failure, never as a warning.
 */
export const DossierVerificationSchema = z.object({
  dispute_id: z.string(),
  verified: z.boolean(),
  expected_sha256: z.string().nullable().default(null),
  actual_sha256: z.string().nullable().default(null),
  verified_at: isoDateTimeSchema,
  detail: z.string(),
  checks: z.record(z.boolean()).default({}),
});
export type DossierVerification = z.infer<typeof DossierVerificationSchema>;
