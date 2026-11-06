/**
 * The containment circuit breaker reports a small, frozen dict. Parsing it here
 * keeps the command center honest: it renders the real latency or the real error,
 * never an invented success.
 */

import { z } from "zod";

import { formatLatency } from "./format";

import type { Tone } from "./vocab";

export const ContainmentSchema = z.object({
  attempted: z.boolean().default(false),
  suspended: z.boolean().default(false),
  latency_ms: z.number().int().nonnegative().default(0),
  subscription_id: z.string().nullable().default(null),
  error: z.string().nullable().default(null),
});

export type Containment = z.infer<typeof ContainmentSchema>;

/** Parse the server dict into a display-safe shape; unknown keys are ignored. */
export function parseContainment(raw: Record<string, unknown>): Containment {
  const parsed = ContainmentSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return { attempted: false, suspended: false, latency_ms: 0, subscription_id: null, error: null };
}

export type ContainmentHeadline = {
  text: string;
  detail: string | null;
  tone: Tone;
  suspended: boolean;
};

/** One-line containment result for the command center. */
export function describeContainment(containment: Containment): ContainmentHeadline {
  if (containment.suspended) {
    const latency =
      containment.latency_ms <= 0 ? "<1ms" : formatLatency(containment.latency_ms);
    return {
      text: `Subscription suspended in ${latency}`,
      detail: containment.subscription_id,
      tone: "positive",
      suspended: true,
    };
  }
  if (!containment.attempted) {
    return {
      text: "Containment skipped (no subscription)",
      detail: null,
      tone: "neutral",
      suspended: false,
    };
  }
  if (containment.error) {
    return {
      text: `Containment failed: ${containment.error}`,
      detail: containment.subscription_id,
      tone: "negative",
      suspended: false,
    };
  }
  return {
    text: "Containment ran without suspending billing",
    detail: containment.subscription_id,
    tone: "warning",
    suspended: false,
  };
}