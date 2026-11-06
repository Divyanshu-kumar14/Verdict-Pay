import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
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

const PATH_META: Record<EvPath, { label: string; verb: string; action: DisputeAction }> = {
  fight: { label: "Fight", verb: "Provide evidence", action: "PROVIDE_EVIDENCE" },
  settle: { label: "Settle", verb: "Accept claim", action: "ACCEPT_CLAIM" },
  offer: { label: "Offer", verb: "Make offer", action: "MAKE_OFFER" },
};

/**
 * Three expected-value bars on one scale. All three are the same neutral fill:
 * the cheapest path is marked by the 1px accent line under its label, never by
 * a colour, and every figure sits at the end of its own row.
 */
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
    <Panel>
      <PanelHeader
        title="Fight, settle or offer"
        description="Expected value after non-refundable fees. The bars share one scale; the least negative is the cheapest correct response."
        actions={
          <span className="num text-xs text-muted">
            Scale 0 to {formatUsd(-maxAbs)}
          </span>
        }
      />
      <PanelBody className="pt-0">
        <div
          className="flex items-baseline justify-between border-b border-rule pb-1.5 text-2xs text-muted"
          aria-hidden
        >
          <span className="num">0</span>
          <span className="num">{formatUsd(-maxAbs / 2)}</span>
          <span className="num">{formatUsd(-maxAbs)}</span>
        </div>

        <div role="list" aria-label="Expected value by response path">
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
              <div
                key={key}
                role="listitem"
                className="row-rule py-3 first:border-t-0 first:pt-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="num w-4 shrink-0 text-xs text-muted" aria-hidden>
                      {index + 1}
                    </span>
                    <span className={cn("text-base text-ink", isBest && "sig")}>
                      {meta.label}
                    </span>
                    <span className="text-sm text-muted">{meta.verb}</span>
                    {isBest ? (
                      <span className="text-sm text-muted">least loss</span>
                    ) : (
                      <span className="num text-sm text-muted">
                        +{formatUsd(Math.abs(gap))} vs least loss
                      </span>
                    )}
                    {blocked ? (
                      <Badge
                        tone="neutral"
                        title={exposed?.reason ?? "PayPal does not expose this action at this stage."}
                      >
                        Blocked at this stage
                      </Badge>
                    ) : null}
                  </div>
                  <span className="num text-lg text-ink">{formatUsd(value)}</span>
                </div>

                <div
                  className="mt-2 h-2 overflow-hidden rounded-[2px] bg-raised"
                  role="img"
                  aria-label={meta.label + " expected value " + formatUsd(value)}
                >
                  <div
                    aria-hidden
                    className="h-full rounded-[2px] bg-chart-1"
                    style={{ width: width + "%" }}
                  />
                </div>

                <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="num text-sm text-muted">{note}</span>
                  <span className="num text-sm text-muted">{Math.round(width)}% of scale</span>
                </div>

                {blocked ? (
                  <p className="mt-1 text-sm leading-snug text-muted">
                    {exposed?.reason ?? "actions/" + meta.action + " is not exposed at this stage"}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>

        <p className="row-rule mt-2 pt-3 text-sm leading-relaxed text-ink">
          {breakdown.crosses_cliff ? (
            <>
              The dispute ratio moves from{" "}
              <span className="num">{formatPercent(breakdown.ratio_before, 2)}</span> to{" "}
              <span className="num">{formatPercent(breakdown.ratio_after, 2)}</span>, crossing the
              1.5% line. A penalty of{" "}
              <span className="num">{formatUsd(breakdown.penalty_ratio_usd)}</span> lands on the
              fight path.
            </>
          ) : (
            <>
              The dispute ratio sits at{" "}
              <span className="num">{formatPercent(breakdown.ratio_after, 2)}</span>, below the 1.5%
              line. No cliff penalty lands on the fight path.
            </>
          )}
        </p>

        <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2" aria-label="Fee components">
          {feeComponents(breakdown, detail.stage).map((component) => (
            <div key={component.label} className="row-rule pt-3 first:border-t-0 first:pt-0">
              <p className="label">{component.label}</p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="num text-base text-ink">{component.value}</span>
                <span className="text-sm text-muted">{component.note}</span>
              </div>
            </div>
          ))}
        </div>
      </PanelBody>

      <PanelFooter className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="num text-sm text-muted">
          Dispute ratio {formatPercent(breakdown.ratio_before, 2)} to{" "}
          {formatPercent(breakdown.ratio_after, 2)}, cliff at 1.5%
        </span>
        <span className="text-sm text-muted">
          {breakdown.crosses_cliff ? "Crosses the cliff" : "Below the cliff"}
        </span>
      </PanelFooter>

      {breakdown.formula_notes.length > 0 ? (
        <details className="border-t border-rule px-4 py-3">
          <summary className="cursor-pointer text-sm text-muted">
            Formula notes ({breakdown.formula_notes.length})
          </summary>
          <ul className="mt-2 space-y-1 text-sm leading-relaxed text-muted">
            {breakdown.formula_notes.map((note, index) => (
              <li key={index + "-" + note.slice(0, 12)}>{note}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}
