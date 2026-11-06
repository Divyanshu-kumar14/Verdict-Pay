"use client";

import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import {
  bestEvPath,
  evPathValue,
  feeComponents,
  fightEvNote,
  highVolumeRuleNote,
  offerEvNote,
  ratioExplain,
  ratioRelationNote,
  ratioVerdict,
  settleEvNote,
  thresholdLabel,
  type EvPath,
} from "@/lib/ev";
import { formatInteger, formatPercent, formatUsd } from "@/lib/format";
import type { DisputeAction, DisputeDetail, EvBreakdown } from "@/lib/types";
import { TONE_BAR, type Tone } from "@/lib/vocab";

const PATH_META: Record<EvPath, { label: string; verb: string; action: DisputeAction }> = {
  fight: { label: "Fight", verb: "Provide evidence", action: "PROVIDE_EVIDENCE" },
  settle: { label: "Settle", verb: "Accept claim", action: "ACCEPT_CLAIM" },
  offer: { label: "Offer", verb: "Make offer", action: "MAKE_OFFER" },
};

type FlowStep = { key: string; label: string; value: number; tone: Tone; note: string };

/**
 * The fee cascade, built only from frozen EvBreakdown fields. The running total
 * lands on the fight-path loss lib/ev.ts already derives — amount + standard fee
 * + high-volume fee + cliff penalty — so nothing here invents a number.
 */
function waterflowSteps(breakdown: EvBreakdown): FlowStep[] {
  return [
    {
      key: "amount",
      label: "Claim amount",
      value: breakdown.amount_usd,
      tone: "neutral",
      note: "principal under dispute",
    },
    {
      key: "high-volume",
      label: "High-volume fee",
      value: breakdown.high_volume_fee_usd,
      tone: "warning",
      note: breakdown.high_volume ? "never refunded" : "not applied",
    },
    {
      key: "standard",
      label: "Standard fee",
      value: breakdown.standard_fee_usd,
      tone: "accent",
      note: "refunded on a win",
    },
    {
      key: "penalty",
      label: "Penalty cliff",
      value: breakdown.penalty_ratio_usd,
      tone: "negative",
      note: ratioRelationNote(breakdown),
    },
  ];
}

export function EvWaterfall({ detail }: { detail: DisputeDetail }) {
  const breakdown = detail.breakdown;

  /* --- the fee cascade -------------------------------------------------- */
  const steps = waterflowSteps(breakdown);
  const total = steps.reduce((sum, step) => sum + step.value, 0);
  const scale = Math.max(total, 1);
  let running = 0;

  /* --- the three expected-value paths ----------------------------------- */
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

  const waterflowSummary =
    steps.map((step) => step.label + " " + formatUsd(step.value)).join(", ") +
    "; fight-path exposure " +
    formatUsd(total);

  return (
    <Panel>
      <PanelHeader
        title="Fee waterflow"
        description="Each cost that lands on the fight path, stacked from the claim amount. The running total is the exposure if the claim is contested and lost."
        actions={<span className="num text-xs text-muted">Scale 0 to {formatUsd(scale)}</span>}
      />

      <PanelBody className="pt-0">
        <div role="img" aria-label={waterflowSummary}>
          <div className="space-y-1">
            {steps.map((step) => {
              const left = (running / scale) * 100;
              const width = Math.max((step.value / scale) * 100, step.value > 0 ? 2 : 0);
              running += step.value;
              return (
                <div
                  key={step.key}
                  className="grid grid-cols-[112px_minmax(0,1fr)_92px] items-center gap-3"
                >
                  <span className="truncate text-xs text-muted" title={step.note}>
                    {step.label}
                  </span>
                  <span className="relative block h-6 overflow-hidden rounded-[2px] bg-raised">
                    <span
                      aria-hidden
                      className={cn(
                        "absolute inset-y-0 rounded-[2px] transition-[left,width] duration-240",
                        TONE_BAR[step.tone],
                      )}
                      style={{ left: left + "%", width: width + "%" }}
                    />
                  </span>
                  <span className="num text-right text-sm text-ink">{formatUsd(step.value)}</span>
                </div>
              );
            })}

            <div className="row-rule mt-2 grid grid-cols-[112px_minmax(0,1fr)_92px] items-center gap-3 pt-2">
              <span className="text-xs font-medium text-ink">Fight exposure</span>
              <span className="relative block h-6 overflow-hidden rounded-[2px] bg-raised">
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-[2px] bg-chart-1"
                  style={{ width: "100%" }}
                />
              </span>
              <span className="num text-right text-sm font-semibold text-ink">
                {formatUsd(total)}
              </span>
            </div>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {steps.map((step) => (
              <span key={step.key} className="flex items-center gap-1.5 text-2xs text-muted">
                <span
                  aria-hidden
                  className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_BAR[step.tone])}
                />
                {step.label}
              </span>
            ))}
          </div>
        </div>

        <div className="sr-only">
          <table>
            <caption>{waterflowSummary}</caption>
            <thead>
              <tr>
                <th scope="col">Component</th>
                <th scope="col" className="text-right">
                  Value
                </th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.key}>
                  <th scope="row">{step.label}</th>
                  <td className="num text-right">{formatUsd(step.value)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Fight exposure</th>
                <td className="num text-right">{formatUsd(total)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* the three expected-value paths, one scale, least-loss marked */}
        <div className="row-rule mt-4 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="label">Least-loss path</p>
            <span className="num text-2xs text-muted">Scale 0 to {formatUsd(-maxAbs)}</span>
          </div>

          <div role="list" aria-label="Expected value by response path" className="mt-1">
            {paths.map(({ key, note }) => {
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
                <div key={key} role="listitem" className="row-rule py-3 first:border-t-0 first:pt-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
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
                          Blocked
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
                </div>
              );
            })}
          </div>
        </div>

        {/* The sentence is generated from the payload's own threshold and its
            authoritative relation, so it can never print a ratio beside a
            threshold it does not actually sit behind. */}
        <p className="row-rule mt-2 pt-3 text-sm leading-relaxed text-ink">{ratioExplain(breakdown)}</p>
        {/* How the line itself is computed — the threshold and the sales gate both
            come from the payload, so the explanation cannot drift from scoring. */}
        <p className="mt-1.5 text-xs text-muted">
          The line is {highVolumeRuleNote(breakdown)}:{" "}
          <span className="num">{formatInteger(breakdown.disputes_3mo)}</span> disputes on{" "}
          <span className="num">{formatInteger(breakdown.sales_3mo)}</span> sales.
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
          {formatPercent(breakdown.ratio_after, 2)}, cliff at {thresholdLabel(breakdown)}
        </span>
        <span className="text-sm text-muted">{ratioVerdict(breakdown)}</span>
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
