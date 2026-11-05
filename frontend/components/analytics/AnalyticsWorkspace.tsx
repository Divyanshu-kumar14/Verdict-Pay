"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatInteger, formatPercent, formatUsd } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { RecommendedAction } from "@/lib/types";
import {
  RECOMMENDATION_META,
  RECOMMENDATION_ORDER,
  type Tone,
  TONE_DOT,
  TONE_TEXT,
} from "@/lib/vocab";

const SERIES_FILL: Record<Tone, string> = {
  emerald: "#34D399",
  amber: "#FBBF24",
  rose: "#FB7185",
  sky: "#7DD3FC",
  neutral: "#B0B4BA",
};

function RecommendationChart({
  rows,
}: {
  rows: { recommended_action: RecommendedAction }[];
}) {
  const series = RECOMMENDATION_ORDER.map((action) => ({
    action,
    meta: RECOMMENDATION_META[action],
    count: rows.filter((row) => row.recommended_action === action).length,
  }));
  const maxCount = Math.max(1, ...series.map((item) => item.count));
  const total = series.reduce((sum, item) => sum + item.count, 0);

  const width = 660;
  const height = 250;
  const padding = { top: 18, right: 14, bottom: 38, left: 38 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const slot = plotWidth / series.length;
  const barWidth = Math.min(62, slot * 0.5);

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Cases by recommendation: ${series
          .map((item) => `${item.meta.label} ${item.count}`)
          .join(", ")}. Total ${total} cases.`}
      >
        {ticks.map((tick) => {
          const y = padding.top + plotHeight - tick * plotHeight;
          const value = Math.round(tick * maxCount);
          return (
            <g key={tick}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.055)"
                strokeWidth={1}
              />
              <text
                x={padding.left - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="#74869B"
                fontFamily="var(--font-geist-mono), ui-monospace, monospace"
              >
                {value}
              </text>
            </g>
          );
        })}

        {series.map((item, index) => {
          const barHeight = (item.count / maxCount) * plotHeight;
          const x = padding.left + slot * index + (slot - barWidth) / 2;
          const y = padding.top + plotHeight - barHeight;
          return (
            <g key={item.action}>
              <rect
                x={x}
                y={item.count === 0 ? padding.top + plotHeight - 1 : y}
                width={barWidth}
                height={item.count === 0 ? 1 : barHeight}
                rx={2}
                fill={SERIES_FILL[item.meta.tone]}
                fillOpacity={item.count === 0 ? 0.25 : 0.82}
              />
              <text
                x={x + barWidth / 2}
                y={y - 6}
                textAnchor="middle"
                fontSize={10}
                fill="#E6EDF3"
                fontFamily="var(--font-geist-mono), ui-monospace, monospace"
              >
                {item.count}
              </text>
              <text
                x={x + barWidth / 2}
                y={padding.top + plotHeight + 16}
                textAnchor="middle"
                fontSize={9}
                fill="#93A1B0"
                letterSpacing="0.04em"
              >
                {item.meta.short}
              </text>
              <text
                x={x + barWidth / 2}
                y={padding.top + plotHeight + 28}
                textAnchor="middle"
                fontSize={8}
                fill="#74869B"
                fontFamily="var(--font-geist-mono), ui-monospace, monospace"
              >
                {formatPercent(total > 0 ? item.count / total : 0, 0)}
              </text>
            </g>
          );
        })}

        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={padding.top + plotHeight}
          y2={padding.top + plotHeight}
          stroke="rgba(255,255,255,0.14)"
          strokeWidth={1}
        />
      </svg>
    </figure>
  );
}

function FeeCliffPanel({
  ratio,
  threshold,
  flag,
  sales3mo,
  disputes3mo,
}: {
  ratio: number;
  threshold: number;
  flag: boolean;
  sales3mo: number;
  disputes3mo: number;
}) {
  const scaleMax = Math.max(0.02, threshold * 1.4);
  const ratioPct = Math.min(100, (ratio / scaleMax) * 100);
  const thresholdPct = Math.min(100, (threshold / scaleMax) * 100);

  return (
    <Panel>
      <PanelHeader
        kicker="Fee cliff"
        title="Rolling dispute ratio"
        description="High-volume merchants pay a $30 fee that is not refunded on a win: above 1.5%, a $25 claim can lose money even when fought."
        actions={
          <Badge tone={flag ? "rose" : "emerald"} dot>
            {flag ? "ABOVE THRESHOLD" : "BELOW THRESHOLD"}
          </Badge>
        }
      />
      <PanelBody className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="kicker">Current ratio</div>
            <div className="num mt-1 text-[22px] font-medium tracking-[-0.02em] text-ink">
              {formatPercent(ratio, 2)}
            </div>
          </div>
          <div className="text-right">
            <div className="kicker">Threshold</div>
            <div className="num mt-1 text-[12px] text-amber">{formatPercent(threshold, 2)}</div>
          </div>
        </div>

        <div
          className="relative h-3 rounded-full bg-white/[0.06]"
          role="img"
          aria-label={`Rolling dispute ratio ${formatPercent(ratio, 2)} against the ${formatPercent(threshold, 2)} high-volume threshold`}
        >
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", flag ? "bg-rose/70" : "bg-emerald/60")}
            style={{ width: `${ratioPct}%` }}
          />
          <div
            className="absolute -inset-y-1 w-px bg-amber"
            style={{ left: `${thresholdPct}%` }}
            title={`Threshold ${formatPercent(threshold, 2)}`}
          />
        </div>
        <div className="flex justify-between font-mono text-[9px] text-dim">
          <span>0%</span>
          <span className="text-amber">threshold {formatPercent(threshold, 2)}</span>
          <span>{formatPercent(scaleMax, 1)}</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2">
            <div className="kicker">3-month sales</div>
            <div className="num mt-0.5 text-[12px] text-ink">{formatInteger(sales3mo)}</div>
          </div>
          <div className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2">
            <div className="kicker">3-month disputes</div>
            <div className="num mt-0.5 text-[12px] text-ink">{formatInteger(disputes3mo)}</div>
          </div>
        </div>
      </PanelBody>
    </Panel>
  );
}

/** /analytics — exposure canvas: KPI tiles, recommendation chart and a compact queue. */
export function AnalyticsWorkspace() {
  const router = useRouter();
  const now = useNow(30000);
  const summary = usePolledQuery("analytics:summary", (signal) => api.reportingSummary(signal), {
    intervalMs: 5000,
  });
  const queue = usePolledQuery(
    "analytics:queue",
    (signal) => api.listDisputes({ page: 1, perPage: 100 }, signal),
    { intervalMs: 5000 },
  );

  const rows = queue.data?.data ?? [];
  const meta = queue.data?.meta ?? null;
  const highVolume = summary.data?.high_volume ?? null;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Exposure canvas · Aurora Analytics"
        title="Portfolio exposure"
        description="Money at risk, money protected and the fee cliff that decides whether fighting a claim is rational. All figures come from the reporting and triage APIs."
        meta={
          <>
            <PageMeta label="Open cases" value={summary.data ? summary.data.open_cases : "—"} />
            <PageMeta label="Queue" value={meta ? meta.total : "—"} />
            <PageMeta
              label="As of"
              value={now === null ? "—" : new Date(now).toLocaleTimeString("en-GB", { hour12: false })}
            />
          </>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {summary.loading ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[96px] w-full" />
          ))
        ) : (
          <>
            <StatTile
              label="Open exposure"
              value={summary.data ? formatUsd(summary.data.total_exposure_usd) : "—"}
              sub={summary.data ? `${summary.data.open_cases} open cases · ${summary.data.in_inquiry} inquiry / ${summary.data.in_claim} claim` : "Reporting unavailable"}
              emphasis="headline"
            />
            <StatTile
              label="Protected"
              value={summary.data ? formatUsd(summary.data.protected_usd) : "—"}
              sub="Value defended by the deterministic path"
              tone="emerald"
            />
            <StatTile
              label="Fees avoided"
              value={summary.data ? formatUsd(summary.data.fees_avoided_usd) : "—"}
              sub="Versus fighting every inquiry"
              tone="emerald"
            />
            <StatTile
              label="Avg p(win)"
              value={summary.data ? formatPercent(summary.data.avg_p_win) : "—"}
              sub={
                summary.data
                  ? `Win-rate estimate ${formatPercent(summary.data.win_rate_estimate)} · ${summary.data.chain_verified_customers} verified customers`
                  : "Reporting unavailable"
              }
              tone="sky"
            />
          </>
        )}
      </div>

      {summary.error ? (
        <ErrorBanner
          error={summary.error}
          context="Portfolio KPIs could not be refreshed."
          onRetry={summary.refresh}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            kicker="Decision mix"
            title="Cases by recommendation"
            description={
              meta
                ? `Current queue: ${rows.length} of ${meta.total} cases. Counts are computed from the triage API, not sampled.`
                : "Current triage queue."
            }
            actions={
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-dim">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />
                polling 5s
              </span>
            }
          />
          <PanelBody>
            {queue.loading ? (
              <Skeleton className="h-[250px] w-full" />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No cases to chart"
                description="The analytics canvas reads the live triage queue. Open an inquiry in the sandbox to populate it."
                action={
                  <Link
                    href="/"
                    className="inline-flex h-8 items-center rounded-md border border-emerald/30 bg-emerald/10 px-3 text-[12px] font-medium text-emerald transition-colors hover:bg-emerald/15"
                  >
                    Run the sandbox flow
                  </Link>
                }
              />
            ) : (
              <RecommendationChart rows={rows} />
            )}
          </PanelBody>
        </Panel>

        {highVolume ? (
          <FeeCliffPanel
            ratio={highVolume.ratio}
            threshold={highVolume.threshold}
            flag={highVolume.flag}
            sales3mo={highVolume.sales_3mo}
            disputes3mo={highVolume.disputes_3mo}
          />
        ) : (
          <Panel>
            <PanelHeader kicker="Fee cliff" title="Rolling dispute ratio" />
            <PanelBody>
              {summary.loading ? <Skeleton className="h-[150px] w-full" /> : <p className="text-[11.5px] text-muted">High-volume status is unavailable.</p>}
            </PanelBody>
          </Panel>
        )}
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader
          kicker="Queue snapshot"
          title="Triage queue"
          description="Compact view of the live queue; filters and full EV columns live on the triage page."
          actions={
            <Link
              href="/disputes"
              className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-ink"
            >
              Full queue
              <ArrowRight size={11} aria-hidden />
            </Link>
          }
        />
        <div className="border-t border-hairline">
          {queue.loading ? (
            <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading queue snapshot">
              <Skeleton className="h-8 w-full" />
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No cases on the queue"
                description="Run the sandbox flow to create a dispute, then this canvas will price it."
              />
            </div>
          ) : (
            <DisputesGridLoader
              rows={rows}
              now={now ?? Date.now()}
              height={300}
              compact
              onRowClick={(disputeId) => {
                router.push(`/disputes/${encodeURIComponent(disputeId)}`);
              }}
            />
          )}
        </div>
        {queue.error ? (
          <div className="p-3">
            <ErrorBanner
              error={queue.error}
              context="The queue snapshot could not be refreshed."
              onRetry={queue.refresh}
            />
          </div>
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-hairline bg-white/[0.012] px-3 py-2.5 text-[9.5px] text-dim">
        {RECOMMENDATION_ORDER.map((action) => {
          const meta = RECOMMENDATION_META[action];
          return (
            <span key={action} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[meta.tone])} />
              <span className={TONE_TEXT[meta.tone]}>{meta.short}</span>
              <span className="text-dim">·</span>
              <span>{meta.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
