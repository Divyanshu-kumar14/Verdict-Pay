import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
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

const PATH_META: Record<EvPath, { label: string; tone: Tone; action: DisputeAction }> = {
  fight: { label: "Fight", tone: "rose", action: "PROVIDE_EVIDENCE" },
  settle: { label: "Settle", tone: "amber", action: "ACCEPT_CLAIM" },
  offer: { label: "Offer", tone: "sky", action: "MAKE_OFFER" },
};

/** Three horizontal EV bars with the fee annotations that make the decision legible. */
export function EvWaterfall({ detail }: { detail: DisputeDetail }) {
  const breakdown = detail.breakdown;
  const best = bestEvPath(breakdown);
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
    <Panel>
      <PanelHeader
        kicker="EV waterfall"
        title="Fight, settle or offer"
        description="Expected value after non-refundable PayPal fees. The least-negative bar is the cheapest correct response."
      />
      <PanelBody className="space-y-3.5">
        {paths.map(({ key, note }) => {
          const meta = PATH_META[key];
          const value = evPathValue(breakdown, key);
          const width = Math.max((Math.abs(value) / maxAbs) * 100, 2);
          const exposed = detail.allowed_actions.find(
            (candidate) => candidate.action === meta.action,
          );
          const blocked = !exposed?.allowed;
          return (
            <div
              key={key}
              className={cn(
                "rounded-md border p-3",
                key === best && !blocked
                  ? "border-emerald/25 bg-emerald/[0.03]"
                  : "border-hairline bg-white/[0.012]",
                blocked && "border-dashed opacity-80",
              )}
              title={blocked ? (exposed?.reason ?? "Not exposed by PayPal at this stage") : undefined}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12px] font-medium text-ink">{meta.label}</span>
                  {key === best ? (
                    <Badge tone="emerald" dot>
                      LEAST LOSS
                    </Badge>
                  ) : null}
                  {blocked ? (
                    <Badge tone="neutral" title={exposed?.reason ?? undefined}>
                      BLOCKED AT STAGE
                    </Badge>
                  ) : null}
                </div>
                <span className="num text-[15px] font-medium tracking-[-0.02em] text-ink">
                  {formatUsd(value)}
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className={cn("h-full rounded-full", TONE_BAR[meta.tone])}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="mt-1.5 font-mono text-[9.5px] text-muted">{note}</div>
              {blocked ? (
                <div className="mt-1 font-mono text-[9px] leading-snug text-dim">
                  {exposed?.reason ?? `actions/${meta.action} is not exposed at this stage`}
                </div>
              ) : null}
            </div>
          );
        })}

        <div className="grid gap-2 sm:grid-cols-2">
          {feeComponents(breakdown, detail.stage).map((component) => (
            <div
              key={component.label}
              className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2"
            >
              <div className="kicker">{component.label}</div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2">
                <span className="num text-[11.5px] text-ink">{component.value}</span>
                <span className="text-[9.5px] text-dim">{component.note}</span>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-hairline bg-white/[0.012] px-2.5 py-2 font-mono text-[9.5px] text-dim">
          <span>
            dispute ratio {formatPercent(breakdown.ratio_before, 2)} →{" "}
            {formatPercent(breakdown.ratio_after, 2)} · cliff at 1.5%
          </span>
          <span className={breakdown.crosses_cliff ? "text-rose" : "text-muted"}>
            {breakdown.crosses_cliff ? "crosses cliff" : "below cliff"}
          </span>
        </div>

        {breakdown.formula_notes.length > 0 ? (
          <details className="rounded border border-hairline bg-white/[0.01] px-3 py-2">
            <summary className="cursor-pointer text-[10.5px] text-muted">
              Formula notes ({breakdown.formula_notes.length})
            </summary>
            <ul className="mt-2 space-y-1 font-mono text-[9.5px] leading-relaxed text-muted">
              {breakdown.formula_notes.map((note, index) => (
                <li key={index}>{note}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </PanelBody>
    </Panel>
  );
}