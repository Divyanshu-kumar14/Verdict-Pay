import { TriangleAlert } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { cn } from "@/lib/cn";
import {
  bestEvPath,
  evPathValue,
  feeComponents,
  fightEvNote,
  offerEvNote,
  settleEvNote,
  type EvPath,
} from "@/lib/ev";
import { formatPercent, formatUsd } from "@/lib/format";
import type { DisputeAction, DisputeDetail } from "@/lib/types";
import { type Tone, TONE_BAR } from "@/lib/vocab";

const PATH_META: Record<EvPath, { label: string; tone: Tone; action: DisputeAction; verb: string }> = {
  fight: { label: "Fight", tone: "emerald", action: "PROVIDE_EVIDENCE", verb: "Provide evidence" },
  settle: { label: "Settle", tone: "amber", action: "ACCEPT_CLAIM", verb: "Accept claim" },
  offer: { label: "Offer", tone: "sky", action: "MAKE_OFFER", verb: "Make offer" },
};

/** Three scaled EV bars with the fee annotations that make the decision legible. */
export function EvWaterfall({ detail }: { detail: DisputeDetail }) {
  const breakdown = detail.breakdown;
  const best = bestEvPath(breakdown);
  const bestValue = evPathValue(breakdown, best);
  const maxAbs = Math.max(
    Math.abs(breakdown.ev_fight_usd),
    Math.abs(breakdown.ev_settle_usd),
    Math.abs(breakdown.ev_offer_usd),
    1,
  );

  const paths: Array<{ key: EvPath; note: string }> = [
    { key: "fight", note: fightEvNote(breakdown) },
    { key: "settle", note: settleEvNote(breakdown, detail.stage) },
    { key: "offer", note: offerEvNote(breakdown) },
  ];

  return (
    <SpotlightCard className="p-4 sm:p-5">
      <FieldLabel rule tone="ice">
        EV comparison · expected value after non-refundable fees
      </FieldLabel>
      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-medium tracking-[-0.01em] text-ink">
          Fight, settle or offer
        </h2>
        <span className="num font-mono text-[10px] text-dim">
          scale 0 – {formatUsd(-maxAbs)} loss
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-muted">
        Bars are scaled to the largest loss. The least-negative bar is the cheapest correct
        response.
      </p>

      <div className="mt-4" role="list" aria-label="Expected value by response path">
        {paths.map(({ key, note }, index) => {
          const meta = PATH_META[key];
          const value = evPathValue(breakdown, key);
          const width = Math.max((Math.abs(value) / maxAbs) * 100, 2);
          const isBest = key === best;
          const exposed = detail.allowed_actions.find(
            (candidate) => candidate.action === meta.action,
          );
          const blocked = !exposed?.allowed;
          const gap = value - bestValue;
          return (
            <div key={key} role="listitem" className="relative flex gap-3">
              <div className="flex w-16 shrink-0 flex-col items-end pt-1" aria-hidden>
                <span className="num font-mono text-[10px] text-dim">
                  {"0" + String(index + 1)}
                </span>
              </div>
              <div
                className={cn(
                  "relative mb-3 flex-1 rounded-lg border p-3",
                  isBest && !blocked
                    ? "border-emerald/30 bg-emerald/[0.045]"
                    : "border-hairline bg-white/[0.012]",
                  blocked && "border-dashed opacity-75",
                )}
                title={blocked ? (exposed?.reason ?? "Not exposed by PayPal at this stage") : undefined}
              >
                {isBest && !blocked ? (
                  <span aria-hidden className="absolute inset-y-2 left-0 w-[2px] rounded-full bg-emerald" />
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-ink">{meta.label}</span>
                    <span className="num font-mono text-[9.5px] text-dim">{meta.verb}</span>
                    {isBest ? (
                      <Badge tone="emerald" dot>
                        LEAST LOSS
                      </Badge>
                    ) : (
                      <span className="num font-mono text-[9.5px] text-dim">
                        +{formatUsd(Math.abs(gap))} vs cheapest
                      </span>
                    )}
                    {blocked ? (
                      <Badge tone="neutral" title={exposed?.reason ?? undefined}>
                        BLOCKED AT STAGE
                      </Badge>
                    ) : null}
                  </div>
                  <span
                    className={cn(
                      "num text-[19px] font-medium tracking-[-0.02em]",
                      isBest ? "text-emerald" : "text-ink",
                    )}
                  >
                    {formatUsd(value)}
                  </span>
                </div>
                <div
                  className="relative mt-2.5 h-[9px] overflow-hidden rounded-full bg-white/[0.05]"
                  role="img"
                  aria-label={meta.label + " expected value " + formatUsd(value)}
                >
                  <div aria-hidden className="instrument-ticks absolute inset-0 opacity-50" />
                  <div
                    className={cn("absolute inset-y-0 left-0 rounded-full", TONE_BAR[isBest ? "emerald" : meta.tone])}
                    style={{ width: width + "%" }}
                  />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                  <span className="num font-mono text-[9.5px] text-muted">{note}</span>
                  <span className="num font-mono text-[9.5px] text-dim">
                    {Math.round(width)}% of scale
                  </span>
                </div>
                {blocked ? (
                  <p className="mt-1 font-mono text-[9px] leading-snug text-dim">
                    {exposed?.reason ?? "actions/" + meta.action + " is not exposed at this stage"}
                  </p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {breakdown.crosses_cliff ? (
        <p
          role="note"
          className="flex items-start gap-2 rounded-lg border border-rose/30 bg-rose/[0.06] px-3 py-2.5 text-[11px] leading-snug text-rose"
        >
          <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold tracking-[0.06em]">FEE CLIFF · </span>
            dispute ratio {formatPercent(breakdown.ratio_before, 2)} →{" "}
            {formatPercent(breakdown.ratio_after, 2)} crosses 1.5%. Penalty{" "}
            <span className="num font-semibold">{formatUsd(breakdown.penalty_ratio_usd)}</span>{" "}
            applies to the fight path.
          </span>
        </p>
      ) : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2" aria-label="Fee components">
        {feeComponents(breakdown, detail.stage).map((component) => (
          <div
            key={component.label}
            className="rounded-md border border-hairline bg-white/[0.012] px-2.5 py-2"
          >
            <FieldLabel>{component.label}</FieldLabel>
            <div className="mt-1 flex items-baseline justify-between gap-2">
              <span className="num text-[13px] font-medium text-ink">{component.value}</span>
              <span className="text-[10px] text-dim">{component.note}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-white/[0.012] px-2.5 py-2 font-mono text-[9.5px] text-dim">
        <span>
          dispute ratio {formatPercent(breakdown.ratio_before, 2)} →{" "}
          {formatPercent(breakdown.ratio_after, 2)} · cliff at 1.5%
        </span>
        <span className={breakdown.crosses_cliff ? "font-medium text-rose" : "text-muted"}>
          {breakdown.crosses_cliff ? "CROSSES CLIFF" : "below cliff"}
        </span>
      </div>

      {breakdown.formula_notes.length > 0 ? (
        <details className="mt-2 rounded-md border border-hairline bg-white/[0.01] px-3 py-2">
          <summary className="cursor-pointer text-[11px] text-muted">
            Formula notes ({breakdown.formula_notes.length})
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[9.5px] leading-relaxed text-muted">
            {breakdown.formula_notes.map((note, index) => (
              <li key={index + "-" + note.slice(0, 12)}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </SpotlightCard>
  );
}
