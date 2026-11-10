"use client";

import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { ppmPercent } from "@/lib/ev";
import { formatInteger, formatUsd } from "@/lib/format";
import type { HighVolumeStatus, VampStatus } from "@/lib/types";

/** A horizontal gauge: the bar fills to ratio / (2 x threshold); the tick marks the cliff. */
function Gauge({
  ratioPpm,
  thresholdPpm,
  warningPpm,
  label,
}: {
  ratioPpm: number;
  thresholdPpm: number;
  warningPpm?: number;
  label: string;
}) {
  const span = Math.max(thresholdPpm * 2, ratioPpm, 1);
  const fill = Math.min(100, (ratioPpm / span) * 100);
  const tick = (thresholdPpm / span) * 100;
  const warn = warningPpm ? (warningPpm / span) * 100 : null;
  const over = ratioPpm >= thresholdPpm;
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={span}
      aria-valuenow={ratioPpm}
      className="relative h-3 w-full overflow-hidden rounded-full bg-rule"
    >
      <div
        className={over ? "h-full bg-negative" : "h-full bg-accent"}
        style={{ width: `${fill}%` }}
      />
      {warn !== null ? (
        <div className="absolute inset-y-0 w-px bg-warning" style={{ left: `${warn}%` }} />
      ) : null}
      <div className="absolute inset-y-0 w-0.5 bg-ink" style={{ left: `${tick}%` }} />
    </div>
  );
}

export function TwoAxisCliffs({
  hvd,
  vamp,
}: {
  hvd: HighVolumeStatus;
  vamp: VampStatus | null;
}) {
  return (
    <Panel data-testid="two-axis-cliffs">
      <PanelHeader
        title="Two-axis 1.5% cliffs"
        description="PayPal HVD is dollar-weighted (disputed wallet INR/SNAD dollars / net sales, 3 full months). Visa VAMP is count-weighted ((TC40 + TC15) / TC05, monthly, >= 1,500 events). The same 1.5% means different things on each axis."
      />
      <PanelBody className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            PayPal HVD · wallet
            <Badge tone="accent">[LIVE PAYPAL SANDBOX]</Badge>
            <Badge tone={hvd.flag ? "negative" : "positive"} dot>
              {hvd.flag ? "In HVD tier" : "Standard tier"}
            </Badge>
          </p>
          <Gauge ratioPpm={hvd.ratio_ppm} thresholdPpm={hvd.threshold_ppm} label="PayPal HVD ratio" />
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted">Ratio (exact)</dt>
            <dd className="num font-mono text-ink">
              {ppmPercent(hvd.ratio_ppm)} · {hvd.ratio_ppm} ppm
            </dd>
            <dt className="text-muted">Disputed / net sales</dt>
            <dd className="num font-mono text-ink">
              {formatUsd(hvd.disputed_amount_minor_3m / 100)} / {formatUsd(hvd.net_sales_minor_3m / 100)}
            </dd>
            <dt className="text-muted">Settled sales (need &gt; 100)</dt>
            <dd className="num font-mono text-ink">{formatInteger(hvd.sales_3mo)}</dd>
            <dt className="text-muted">Headroom to cliff</dt>
            <dd className="num font-mono text-ink">{formatUsd(hvd.amount_until_cliff_minor / 100)}</dd>
            <dt className="text-muted">Fee · SLA</dt>
            <dd className="num font-mono text-ink">
              {formatUsd(hvd.active_fee_tier_usd_cents / 100)}{" "}
              {hvd.fee_reimbursable_on_win ? "(refunded on win)" : "(charged even on win)"} ·{" "}
              {hvd.sla_response_days} days
            </dd>
          </dl>
        </div>
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
            Visa VAMP · unbranded card
            <Badge tone="warning">[VISA-TC40 / ACQUIRER-FEED SIMULATION]</Badge>
            {vamp ? (
              <Badge tone={vamp.excessive_enforcement_active ? "negative" : "positive"} dot>
                {vamp.excessive_enforcement_active ? "Excessive: $8/event" : "Below enforcement"}
              </Badge>
            ) : null}
          </p>
          {vamp ? (
            <>
              <Gauge ratioPpm={vamp.ratio_ppm} thresholdPpm={vamp.threshold_ppm} label="Visa VAMP ratio" />
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <dt className="text-muted">Ratio (exact)</dt>
                <dd className="num font-mono text-ink">
                  {ppmPercent(vamp.ratio_ppm)} · {vamp.ratio_ppm} ppm
                </dd>
                <dt className="text-muted">TC40 + TC15 / TC05</dt>
                <dd className="num font-mono text-ink">
                  {formatInteger(vamp.tc40_fraud_count)} + {formatInteger(vamp.tc15_dispute_count)} /{" "}
                  {formatInteger(vamp.tc05_settled_cnp)}
                </dd>
                <dt className="text-muted">Events (floor 1,500)</dt>
                <dd className="num font-mono text-ink">
                  {formatInteger(vamp.combined_events)} · {formatInteger(vamp.dual_counted_events)} double-counted
                </dd>
                <dt className="text-muted">Events to cliff</dt>
                <dd className="num font-mono text-ink">{formatInteger(vamp.events_until_cliff)}</dd>
                <dt className="text-muted">Projected fines</dt>
                <dd className="num font-mono text-ink">${vamp.projected_vamp_fines_str}</dd>
              </dl>
              <p className="pt-2 text-sm text-ink">Mastercard ECP</p>
              <Gauge
                ratioPpm={vamp.ecp_ratio_ppm}
                thresholdPpm={vamp.ecp_threshold_ppm}
                warningPpm={10000}
                label="Mastercard ECP ratio"
              />
              <p className="text-xs text-muted">
                {ppmPercent(vamp.ecp_ratio_ppm)} · {formatInteger(vamp.mc_chargebacks)} chargebacks /{" "}
                {formatInteger(vamp.mc_prior_month_settled)} prior-month settled ·{" "}
                {vamp.ecp_breached ? "breached" : vamp.ecp_warning ? "1.0% warning band" : "clear"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted">No simulated card-network feed loaded.</p>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
