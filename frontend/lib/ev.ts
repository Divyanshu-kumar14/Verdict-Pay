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

/**
 * An integer ppm ratio as a percent, truncated (never rounded up across a cliff):
 * 14999 ppm -> "1.49%", 15000 ppm -> "1.50%".
 */
export function ppmPercent(ppm: number): string {
  const hundredths = Math.trunc(ppm / 100);
  const whole = Math.trunc(hundredths / 100);
  const fraction = String(Math.abs(hundredths % 100)).padStart(2, "0");
  return `${whole}.${fraction}%`;
}

/** The real threshold as a percentage, from the exact ppm value. */
export function thresholdLabel(breakdown: EvBreakdown): string {
  return ppmPercent(breakdown.ratio_threshold_ppm);
}

/**
 * How the line is actually computed: disputes over sales across three months,
 * applied only to merchants that clear the sales gate. Both numbers come from
 * the payload so the explanation cannot drift from the scoring rule.
 */
export function highVolumeRuleNote(breakdown: EvBreakdown): string {
  return `${thresholdLabel(breakdown)} of 3-month net sales in disputed dollars, on merchants with more than ${formatInteger(
    breakdown.high_volume_min_sales,
  )} sales`;
}

/**
 * One sentence stating the ratio, the real threshold and the relation the
 * payload asserts. Every branch is generated from `evRatioState`, so the numbers
 * and the words cannot disagree.
 */
export function ratioExplain(breakdown: EvBreakdown): string {
  const threshold = thresholdLabel(breakdown);
  const before = ppmPercent(breakdown.ratio_before_ppm);
  const after = ppmPercent(breakdown.ratio_after_ppm);
  const subject = "The disputed-dollar ratio (wallet INR/SNAD claims / net sales)";

  if (!breakdown.hvd_countable) {
    return `This ${breakdown.payment_rail === "UNBRANDED_CARD" ? "unbranded card" : "non-INR/SNAD"} dispute does not count toward PayPal's ${threshold} high-volume line (${before} today).`;
  }
  switch (evRatioState(breakdown)) {
    case "crossing":
      return breakdown.penalty_ratio_usd > 0
        ? `${subject} would move from ${before} to ${after} if this inquiry escalated, crossing the ${threshold} high-volume line. A ${formatUsd(
            breakdown.penalty_ratio_usd,
          )} portfolio penalty lands on the fight path.`
        : `${subject} moves from ${before} to ${after} with this claim, crossing the ${threshold} line: the $30 fee now replaces $15.`;
    case "above":
      return `${subject} is ${before} before this dispute, already at or above the ${threshold} high-volume line: the $30 fee replaces $15 and is not refunded on a win.`;
    default:
      return `${subject} moves from ${before} to ${after}, staying below the ${threshold} high-volume line. No cliff penalty lands on the fight path.`;
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

/** One fee, never two: the HVD $30 replaces the standard $15. */
export function fightEvNote(breakdown: EvBreakdown): string {
  const loss = breakdown.amount_usd + breakdown.fight_fee_usd + breakdown.penalty_ratio_usd;
  const cliff = breakdown.penalty_ratio_usd > 0
    ? ` · cliff ${formatUsd(-breakdown.penalty_ratio_usd)}`
    : "";
  const win = breakdown.win_fee_usd === 0 ? 0 : -breakdown.win_fee_usd;
  return `win ${formatUsd(win)} · loss ${formatUsd(-loss)}${cliff}`;
}

export function settleEvNote(breakdown: EvBreakdown, stage: DisputeStage): string {
  return stage === "INQUIRY"
    ? "principal only · $0 fee in inquiry"
    : `principal + ${formatUsd(breakdown.accept_fee_usd)} ${breakdown.high_volume ? "HVD" : "standard"} claim fee`;
}

export function offerEvNote(breakdown: EvBreakdown): string {
  return `${formatPercent(breakdown.offer_ratio, 0)} of ${formatUsd(breakdown.amount_usd)} claim`;
}

export type FeeComponent = { label: string; value: string; note: string };

/** Fee annotations shown under the EV waterfall. */
export function feeComponents(breakdown: EvBreakdown, stage: DisputeStage): FeeComponent[] {
  const hvdClaim = breakdown.fight_fee_usd > breakdown.standard_fee_usd;
  return [
    {
      label: hvdClaim ? "HVD dispute fee" : "Standard dispute fee",
      value: formatUsd(breakdown.fight_fee_usd),
      note: hvdClaim
        ? `replaces ${formatUsd(breakdown.standard_fee_usd)} · charged even on a win`
        : "refunded on a win",
    },
    {
      label: "Response SLA",
      value: `${breakdown.sla_response_days} days`,
      note: breakdown.sla_response_days <= 3 ? "HVD tier: 10 -> 3 days" : "standard tier",
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
