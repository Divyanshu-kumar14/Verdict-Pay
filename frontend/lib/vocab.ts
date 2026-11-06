/**
 * One vocabulary for every badge, chip and colour in the product.
 * Colour is never the only signal: each entry carries a short text label too,
 * and the five tone names map onto the five hues the palette allows.
 */

import type {
  DisputeAction,
  DisputeChannel,
  DisputeReason,
  DisputeStage,
  DisputeStatus,
  RecommendedAction,
  TelemetryEventType,
} from "./types";

export type Tone = "positive" | "warning" | "negative" | "accent" | "neutral";

export const TONE_TEXT: Record<Tone, string> = {
  positive: "text-positive",
  warning: "text-warning",
  negative: "text-negative",
  accent: "text-accent",
  neutral: "text-muted",
};

/** A pill is a tinted ground with readable ink on it. */
export const TONE_BADGE: Record<Tone, string> = {
  positive: "bg-pill-positive text-pill-positive-ink",
  warning: "bg-pill-warning text-pill-warning-ink",
  negative: "bg-pill-negative text-pill-negative-ink",
  accent: "bg-pill-accent text-pill-accent-ink",
  neutral: "bg-pill-neutral text-pill-neutral-ink",
};

export const TONE_DOT: Record<Tone, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
  accent: "bg-accent",
  neutral: "bg-muted",
};

export const TONE_BAR: Record<Tone, string> = {
  positive: "bg-positive",
  warning: "bg-warning",
  negative: "bg-negative",
  accent: "bg-accent",
  neutral: "bg-chart-1",
};

type Meta = { short: string; label: string; tone: Tone };

export const REASON_META: Record<DisputeReason, Meta> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    short: "Not received",
    label: "Item not received",
    tone: "warning",
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    short: "Not as described",
    label: "Item not as described",
    tone: "negative",
  },
  UNAUTHORIZED: { short: "Unauthorized", label: "Unauthorized payment", tone: "negative" },
  OTHER: { short: "Other", label: "Other reason", tone: "neutral" },
};

export const STAGE_META: Record<DisputeStage, Meta> = {
  INQUIRY: { short: "Inquiry", label: "Inquiry", tone: "warning" },
  CHARGEBACK: { short: "Chargeback", label: "Chargeback", tone: "negative" },
  PRE_ARBITRATION: { short: "Pre-arbitration", label: "Pre-arbitration", tone: "negative" },
  RESOLVED: { short: "Resolved", label: "Resolved", tone: "positive" },
  CLOSED: { short: "Closed", label: "Closed", tone: "neutral" },
};

export const CHANNEL_META: Record<DisputeChannel, Meta> = {
  INTERNAL: { short: "PayPal", label: "PayPal channel", tone: "neutral" },
  EXTERNAL: { short: "Card / bank", label: "Card or bank channel", tone: "accent" },
};

export const STATUS_META: Record<DisputeStatus, Meta> = {
  OPEN: { short: "Open", label: "Open", tone: "accent" },
  WAITING_FOR_SELLER_RESPONSE: {
    short: "Awaiting reply",
    label: "Waiting for seller response",
    tone: "warning",
  },
  UNDER_REVIEW: { short: "Under review", label: "Under review", tone: "accent" },
  RESOLVED: { short: "Resolved", label: "Resolved", tone: "positive" },
  CLOSED: { short: "Closed", label: "Closed", tone: "neutral" },
};

export type RecommendationMeta = {
  short: string;
  label: string;
  tone: Tone;
  action: DisputeAction | null;
  verb: string;
};

export const RECOMMENDATION_META: Record<RecommendedAction, RecommendationMeta> = {
  DEFLECT_INQUIRY: {
    short: "Deflect",
    label: "Deflect inquiry",
    tone: "warning",
    action: "SEND_MESSAGE",
    verb: "Deflect inquiry",
  },
  MAKE_OFFER: {
    short: "Offer",
    label: "Make offer",
    tone: "accent",
    action: "MAKE_OFFER",
    verb: "Make offer",
  },
  ACCEPT_CLAIM: {
    short: "Accept",
    label: "Accept claim",
    tone: "negative",
    action: "ACCEPT_CLAIM",
    verb: "Accept claim",
  },
  PROVIDE_EVIDENCE: {
    short: "Evidence",
    label: "Provide evidence",
    tone: "positive",
    action: "PROVIDE_EVIDENCE",
    verb: "Provide evidence",
  },
  MONITOR: {
    short: "Monitor",
    label: "Monitor",
    tone: "neutral",
    action: null,
    verb: "Monitor only",
  },
};

export const ACTION_META: Record<
  DisputeAction,
  { label: string; description: string; tone: Tone }
> = {
  SEND_MESSAGE: {
    label: "Send message",
    description: "Reply in the PayPal resolution centre. No fee at inquiry stage.",
    tone: "warning",
  },
  MAKE_OFFER: {
    label: "Make offer",
    description: "Offer a partial refund to close the inquiry before it escalates.",
    tone: "accent",
  },
  ACCEPT_CLAIM: {
    label: "Accept claim",
    description: "Concede the dispute and refund the claimed amount.",
    tone: "negative",
  },
  PROVIDE_EVIDENCE: {
    label: "Provide evidence",
    description: "Upload the signed seller-protection dossier to PayPal.",
    tone: "positive",
  },
};

export const EVENT_META: Record<TelemetryEventType, { short: string; label: string }> = {
  TOS_ACCEPTED: { short: "Terms", label: "Terms accepted" },
  SESSION_AUTH: { short: "Session", label: "Session authenticated" },
  ASSET_DELIVERED: { short: "Delivery", label: "Asset delivered" },
  USAGE_METERED: { short: "Usage", label: "Metered usage" },
};

/** Recommendation order used by the analytics chart. */
export const RECOMMENDATION_ORDER: RecommendedAction[] = [
  "DEFLECT_INQUIRY",
  "MAKE_OFFER",
  "PROVIDE_EVIDENCE",
  "ACCEPT_CLAIM",
  "MONITOR",
];
