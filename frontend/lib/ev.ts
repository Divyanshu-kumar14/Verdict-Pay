/**
 * Shared EV presentation helpers.
 *
 * The money comes from the backend's frozen breakdown; these helpers only turn
 * those numbers into the fee annotations the UI shows. No arithmetic invents a
 * value that the API did not return — the loss annotation is composed from the
 * returned fee components, never recomputed as a recommendation.
 *
 * The high-volume threshold is data, not a constant. `ratio_threshold` and the
 * authoritative `ratio_relation` word both come from the breakdown, so a merchant
 * already above the line is never described as "below" it. `evRatioState` is the
 * single place that decides which of the three genuinely different states the
 * copy is allowed to claim; every sentence below is generated from it.
 */

import { formatInteger, formatPercent, formatUsd } from "./format";
import type { DisputeStage, EvBreakdown } from "./types";

export type EvPath = "fight" | "settle" | "offer";

/**
 * Which of the three genuinely different ratio states a case is in.
 *
 * - `crossing` — below the line before this dispute, at or above it after: a new
 *                cliff penalty lands on the fight path.
 * - `above`    — already at or above the line before this dispute: the penalty
 *                regime is already active, so this one adds no new cliff.
 * - `below`    — below the line and stays below it: no penalty at all.
 *
 * `ratio_relation` is the backend's authoritative word and is never re-derived
 * from `crosses_cliff`; only the "did it cross *now*" question is answered by
 * the crossing flag, and it is checked first because a crossing is also
 * technically "at or above".
 */
export type EvRatioState = "crossing" | "above" | "below";

export function evRatioState(breakdown: EvBreakdown): EvRatioState {
  if (breakdown.threshold_crossed_now || breakdown.crosses_cliff) return "crossing";
  return breakdown.ratio_relation === "at_or_above" ? "above" : "below";
}

/** The real threshold as a percentage, at the same 2 decimals as the ratios. */
export function thresholdLabel(breakdown: EvBreakdown): string {
  return formatPercent(breakdown.ratio_threshold, 2);
}

/**
 * How the line is actually computed: disputes over sales across three months,
 * applied only to merchants that clear the sales gate. Both numbers come from
 * the payload so the explanation cannot drift from the scoring rule.
 */
export function highVolumeRuleNote(breakdown: EvBreakdown): string {
  return `${formatPercent(breakdown.ratio_threshold, 2)} of 3-month sales, on merchants with ${formatInteger(
    breakdown.high_volume_min_sales,
  )}+ sales`;
}

/**
 * One sentence stating the ratio, the real threshold and the relation the
 * payload asserts. Every branch is generated from `evRatioState`, so the numbers
 * and the words cannot disagree.
 */
export function ratioExplain(breakdown: EvBreakdown): string {
  const threshold = thresholdLabel(breakdown);
  const before = formatPercent(breakdown.ratio_before, 2);
  const after = formatPercent(breakdown.ratio_after, 2);

  switch (evRatioState(breakdown)) {
    case "crossing":
      return `The dispute ratio moves from ${before} to ${after}, crossing this merchant's ${threshold} high-volume line. A penalty of ${formatUsd(
        breakdown.penalty_ratio_usd,
      )} lands on the fight path.`;
    case "above":
      return `The dispute ratio moves from ${before} to ${after}, already at or above this merchant's ${threshold} high-volume line. The penalty regime is already active, so this dispute adds no new cliff penalty.`;
    default:
      return `The dispute ratio moves from ${before} to ${after}, staying below this merchant's ${threshold} high-volume line. No cliff penalty lands on the fight path.`;
  }
}

/** A fee-row annotation: what the relation actually is, against the real line. */
export function ratioRelationNote(breakdown: EvBreakdown): string {
  const threshold = thresholdLabel(breakdown);
  switch (evRatioState(breakdown)) {
    case "crossing":
      return `this dispute crosses ${threshold}`;
    case "above":
      return `already above ${threshold}`;
    default:
      return `below ${threshold}`;
  }
}

/** The footer verdict, short enough to sit on one line beside the ratios. */
export function ratioVerdict(breakdown: EvBreakdown): string {
  const threshold = thresholdLabel(breakdown);
  switch (evRatioState(breakdown)) {
    case "crossing":
      return `Crosses ${threshold} now`;
    case "above":
      return `Already above ${threshold}`;
    default:
      return `Below ${threshold}`;
  }
}

/** The cheapest response path by expected value. Ties prefer fight, then settle. */
export function bestEvPath(breakdown: EvBreakdown): EvPath {
  const fight = breakdown.ev_fight_usd;
  const settle = breakdown.ev_settle_usd;
  const offer = breakdown.ev_offer_usd;
  if (fight >= settle && fight >= offer) return "fight";
  if (settle >= offer) return "settle";
  return "offer";
}

export function evPathValue(breakdown: EvBreakdown, path: EvPath): number {
  if (path === "fight") return breakdown.ev_fight_usd;
  if (path === "settle") return breakdown.ev_settle_usd;
  return breakdown.ev_offer_usd;
}

export function fightEvNote(breakdown: EvBreakdown): string {
  const highVolumeFee = breakdown.high_volume ? breakdown.high_volume_fee_usd : 0;
  const loss =
    breakdown.amount_usd +
    breakdown.standard_fee_usd +
    highVolumeFee +
    breakdown.penalty_ratio_usd;
  const cliff = breakdown.crosses_cliff
    ? ` · cliff ${formatUsd(-breakdown.penalty_ratio_usd)}`
    : "";
  return `win ${formatUsd(-highVolumeFee)} · loss ${formatUsd(-loss)}${cliff}`;
}

export function settleEvNote(breakdown: EvBreakdown, stage: DisputeStage): string {
  return stage === "INQUIRY"
    ? "principal only · no claim fee yet"
    : `principal + ${formatUsd(breakdown.standard_fee_usd)} claim fee`;
}

export function offerEvNote(breakdown: EvBreakdown): string {
  return `${formatPercent(breakdown.offer_ratio, 0)} of ${formatUsd(breakdown.amount_usd)} claim`;
}

export type FeeComponent = { label: string; value: string; note: string };

/** Fee annotations shown under the EV waterfall. */
export function feeComponents(breakdown: EvBreakdown, stage: DisputeStage): FeeComponent[] {
  return [
    {
      label: "Standard fee",
      value: formatUsd(breakdown.standard_fee_usd),
      note: "refunded on a win",
    },
    {
      label: "High-volume fee",
      value: formatUsd(breakdown.high_volume_fee_usd),
      note: breakdown.high_volume ? "never refunded" : "not applied",
    },
    {
      label: "Cliff penalty",
      value: formatUsd(breakdown.penalty_ratio_usd),
      note: ratioRelationNote(breakdown),
    },
    {
      label: "Offer ratio",
      value: formatPercent(breakdown.offer_ratio, 0),
      note: stage === "INQUIRY" ? "no claim fee yet" : "claim fee attached",
    },
  ];
}
