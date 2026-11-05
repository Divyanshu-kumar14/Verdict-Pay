/**
 * One vocabulary for every badge, chip and colour in the product.
 * Colour is never the only signal: each entry carries a short text label too.
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

export type Tone = "emerald" | "amber" | "rose" | "sky" | "neutral";

export const TONE_TEXT: Record<Tone, string> = {
  emerald: "text-emerald",
  amber: "text-amber",
  rose: "text-rose",
  sky: "text-sky",
  neutral: "text-muted",
};

export const TONE_BADGE: Record<Tone, string> = {
  emerald: "border-emerald/25 bg-emerald/10 text-emerald",
  amber: "border-amber/25 bg-amber/10 text-amber",
  rose: "border-rose/25 bg-rose/10 text-rose",
  sky: "border-sky/25 bg-sky/10 text-sky",
  neutral: "border-white/10 bg-white/[0.04] text-muted",
};

export const TONE_DOT: Record<Tone, string> = {
  emerald: "bg-emerald",
  amber: "bg-amber",
  rose: "bg-rose",
  sky: "bg-sky",
  neutral: "bg-white/30",
};

export const TONE_BAR: Record<Tone, string> = {
  emerald: "bg-emerald",
  amber: "bg-amber",
  rose: "bg-rose",
  sky: "bg-sky",
  neutral: "bg-white/25",
};

type Meta = { short: string; label: string; tone: Tone };

export const REASON_META: Record<DisputeReason, Meta> = {
  MERCHANDISE_OR_SERVICE_NOT_RECEIVED: {
    short: "INR",
    label: "Item not received",
    tone: "amber",
  },
  MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED: {
    short: "SNAD",
    label: "Not as described",
    tone: "rose",
  },
  UNAUTHORIZED: { short: "UA", label: "Unauthorized", tone: "rose" },
  OTHER: { short: "OTHER", label: "Other", tone: "neutral" },
};

export const STAGE_META: Record<DisputeStage, Meta> = {
  INQUIRY: { short: "INQUIRY", label: "Inquiry", tone: "amber" },
  CHARGEBACK: { short: "CHARGEBACK", label: "Chargeback", tone: "rose" },
  PRE_ARBITRATION: { short: "PRE-ARB", label: "Pre-arbitration", tone: "rose" },
  RESOLVED: { short: "RESOLVED", label: "Resolved", tone: "emerald" },
  CLOSED: { short: "CLOSED", label: "Closed", tone: "neutral" },
};

export const CHANNEL_META: Record<DisputeChannel, Meta> = {
  INTERNAL: { short: "INTERNAL", label: "PayPal channel", tone: "neutral" },
  EXTERNAL: { short: "EXTERNAL", label: "Card / bank channel", tone: "sky" },
};

export const STATUS_META: Record<DisputeStatus, Meta> = {
  OPEN: { short: "OPEN", label: "Open", tone: "sky" },
  WAITING_FOR_SELLER_RESPONSE: {
    short: "AWAITING REPLY",
    label: "Waiting for seller response",
    tone: "amber",
  },
  UNDER_REVIEW: { short: "UNDER REVIEW", label: "Under review", tone: "sky" },
  RESOLVED: { short: "RESOLVED", label: "Resolved", tone: "emerald" },
  CLOSED: { short: "CLOSED", label: "Closed", tone: "neutral" },
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
    short: "DEFLECT",
    label: "Deflect inquiry",
    tone: "amber",
    action: "SEND_MESSAGE",
    verb: "Deflect inquiry",
  },
  MAKE_OFFER: {
    short: "OFFER",
    label: "Make offer",
    tone: "sky",
    action: "MAKE_OFFER",
    verb: "Make offer",
  },
  ACCEPT_CLAIM: {
    short: "ACCEPT",
    label: "Accept claim",
    tone: "rose",
    action: "ACCEPT_CLAIM",
    verb: "Accept claim",
  },
  PROVIDE_EVIDENCE: {
    short: "EVIDENCE",
    label: "Provide evidence",
    tone: "emerald",
    action: "PROVIDE_EVIDENCE",
    verb: "Provide evidence",
  },
  MONITOR: {
    short: "MONITOR",
    label: "Monitor",
    tone: "neutral",
    action: null,
    verb: "Monitor only",
  },
};

export const ACTION_META: Record<DisputeAction, { label: string; description: string; tone: Tone }> = {
  SEND_MESSAGE: {
    label: "Send message",
    description: "Reply in the PayPal resolution centre. No fee at INQUIRY stage.",
    tone: "amber",
  },
  MAKE_OFFER: {
    label: "Make offer",
    description: "Offer a partial refund to close the inquiry before it escalates.",
    tone: "sky",
  },
  ACCEPT_CLAIM: {
    label: "Accept claim",
    description: "Concede the dispute and refund the claimed amount.",
    tone: "rose",
  },
  PROVIDE_EVIDENCE: {
    label: "Provide evidence",
    description: "Upload the signed seller-protection dossier to PayPal.",
    tone: "emerald",
  },
};

export const EVENT_META: Record<TelemetryEventType, { short: string; label: string }> = {
  TOS_ACCEPTED: { short: "TOS", label: "Terms accepted" },
  SESSION_AUTH: { short: "AUTH", label: "Session authenticated" },
  ASSET_DELIVERED: { short: "DELIVER", label: "Asset delivered" },
  USAGE_METERED: { short: "USAGE", label: "Metered usage" },
};

/** Recommendation order used by the analytics chart. */
export const RECOMMENDATION_ORDER: RecommendedAction[] = [
  "DEFLECT_INQUIRY",
  "MAKE_OFFER",
  "PROVIDE_EVIDENCE",
  "ACCEPT_CLAIM",
  "MONITOR",
];