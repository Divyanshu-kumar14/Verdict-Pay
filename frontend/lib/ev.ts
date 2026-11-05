/**
 * Shared EV presentation helpers.
 *
 * The money comes from the backend's frozen breakdown; these helpers only turn
 * those numbers into the fee annotations the UI shows. No arithmetic invents a
 * value that the API did not return — the loss annotation is composed from the
 * returned fee components, never recomputed as a recommendation.
 */

import { formatPercent, formatUsd } from "./format";
import type { DisputeStage, EvBreakdown } from "./types";

export type EvPath = "fight" | "settle" | "offer";

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
      note: breakdown.crosses_cliff ? "ratio crosses 1.5%" : "ratio below threshold",
    },
    {
      label: "Offer ratio",
      value: formatPercent(breakdown.offer_ratio, 0),
      note: stage === "INQUIRY" ? "no claim fee yet" : "claim fee attached",
    },
  ];
}
