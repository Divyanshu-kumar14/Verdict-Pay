"use client";

/**
 * /analytics - exposure canvas. A ruled ledger of what is at risk, the fee
 * cliff as the sealed centrepiece, then the decision mix, win-rate gauge,
 * intake slope, stage stack and the live queue. Every number is served by
 * GET /api/v1/reporting/summary or GET /api/v1/disputes.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { animate } from "motion/react";
import { ArrowRight } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { BarChart, DonutGauge, LineSpark, StackedBar, ThresholdMeter } from "@/components/charts";
import type { BarDatum } from "@/components/charts";
import type { StackSegment } from "@/components/charts";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { FieldLabel, LiquidGlass, NumberTicker, Reveal } from "@/components/premium";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatDayLabel, formatInteger, formatPercent, formatUsd, isoToMs } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeStage, DisputeSummary, RecommendedAction } from "@/lib/types";
import { RECOMMENDATION_META, RECOMMENDATION_ORDER, STAGE_META, TONE_DOT, TONE_TEXT } from "@/lib/vocab";

const STAGE_ORDER: DisputeStage[] = ["INQUIRY", "CHARGEBACK", "PRE_ARBITRATION", "RESOLVED", "CLOSED"];
const DAY_MS = 86_400_000;

/** Money that resolves with the same spring as NumberTicker, but grouped. */
function MoneyTicker({ value, className }: { value: number; className?: string }): React.JSX.Element {
  const [text, setText] = useState(() => formatUsd(0));
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setText(formatUsd(value));
      return;
    }
    const controls = animate(0, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setText(formatUsd(latest)),
      onComplete: () => setText(formatUsd(value)),
    });
    return () => controls.stop();
  }, [value]);
  return <span className={cn("tnum font-mono", className)}>{text}</span>;
}

function MeasuredRow({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "amber" | "rose" | "sky" }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline/60 py-2 last:border-b-0">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-dim">{label}</span>
      <span className={cn("tnum text-right font-mono text-[12px] text-ink", tone === "emerald" && "text-emerald", tone === "amber" && "text-amber", tone === "rose" && "text-rose", tone === "sky" && "text-sky")}>
        {value}
      </span>
    </div>
  );
}

function bucketIntake(rows: DisputeSummary[], nowMs: number): { labels: string[]; points: number[] } {
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const labels: string[] = [];
  const points: number[] = [];
  for (let back = 13; back >= 0; back -= 1) {
    const start = dayStart - back * DAY_MS;
    labels.push(formatDayLabel(start));
    let count = 0;
    for (const row of rows) {
      const ms = isoToMs(row.created_at);
      if (ms !== null && ms >= start && ms < start + DAY_MS) count += 1;
    }
    points.push(count);
  }
  return { labels, points };
}

/** /analytics - exposure canvas: KPI ledger, fee cliff, decision mix and queue. */
export function AnalyticsWorkspace(): React.JSX.Element {
  const router = useRouter();
  const now = useNow(30000);
  const summary = usePolledQuery("analytics:summary", (signal) => api.reportingSummary(signal), { intervalMs: 5000 });
  const queue = usePolledQuery("analytics:queue", (signal) => api.listDisputes({ page: 1, perPage: 100 }, signal), { intervalMs: 5000 });

  const queueData = queue.data?.data;
  const rows = useMemo(() => queueData ?? [], [queueData]);
  const meta = queue.data?.meta ?? null;
  const highVolume = summary.data?.high_volume ?? null;
  const nowMs = now ?? Date.now();

  const bars: BarDatum[] = useMemo(
    () =>
      RECOMMENDATION_ORDER.map((action: RecommendedAction) => {
        const count = rows.filter((row) => row.recommended_action === action).length;
        const total = rows.length;
        return { key: action, label: RECOMMENDATION_META[action].short, value: count, tone: RECOMMENDATION_META[action].tone, hint: total > 0 ? formatPercent(count / total, 0) + " of queue" : "0% of queue" };
      }),
    [rows],
  );
  const barSummary = useMemo(() => {
    const parts = RECOMMENDATION_ORDER.map((action) => {
      const found = bars.find((bar) => bar.key === action);
      return RECOMMENDATION_META[action].label + " " + (found ? found.value : 0);
    });
    return "Cases by recommendation: " + parts.join(", ") + ". Total " + rows.length + " cases.";
  }, [bars, rows.length]);

  const segments: StackSegment[] = useMemo(
    () => STAGE_ORDER.map((stage) => ({ key: stage, label: STAGE_META[stage].label, value: rows.filter((row) => row.stage === stage).length, tone: STAGE_META[stage].tone })),
    [rows],
  );
  const stageSummary = useMemo(() => {
    const parts = segments.map((item) => item.label + " " + item.value);
    return "Queue by stage: " + parts.join(", ") + ". Total " + rows.length + " cases.";
  }, [segments, rows.length]);

  const intake = useMemo(() => bucketIntake(rows, nowMs), [rows, nowMs]);
  const intakeTotal = intake.points.reduce((sum, value) => sum + value, 0);
  const intakePeak = intake.points.reduce((peak, value) => Math.max(peak, value), 0);
  const intakePeakIndex = intake.points.indexOf(intakePeak);
  const intakePeakLabel = intakePeakIndex >= 0 ? (intake.labels[intakePeakIndex] ?? "") : "";
  const intakeSummary = "New cases per day, last 14 days: total " + intakeTotal + ", peak " + intakePeak + (intakePeakLabel === "" ? "" : " on " + intakePeakLabel) + ".";

  const loading = summary.loading;
  const openCases = summary.data?.open_cases ?? 0;
  const avgPWin = summary.data?.avg_p_win ?? Number.NaN;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Exposure canvas | Aurora Analytics"
        title="Portfolio exposure"
        description="Money at risk, money protected and the fee cliff that decides whether fighting a claim is rational. All figures come from the reporting and triage APIs."
        meta={<>
          <PageMeta label="Open cases" value={summary.data ? String(openCases) : "-"} />
          <PageMeta label="Queue" value={meta ? String(meta.total) : "-"} />
          <PageMeta label="As of" value={now === null ? "-" : new Date(now).toLocaleTimeString("en-GB", { hour12: false })} />
        </>}
      />

      <Reveal>
        <Panel className="overflow-hidden">
          <div className="grid divide-y divide-hairline md:grid-cols-[1.45fr_1fr_1fr_1fr] md:divide-x md:divide-y-0">
            <div className="p-5">
              <FieldLabel rule tone="rose">Open exposure</FieldLabel>
              <div className="mt-3 text-[34px] font-medium leading-none tracking-[-0.02em] text-ink">
                {loading || summary.data === null ? <span aria-label="Loading open exposure">-</span> : <MoneyTicker value={summary.data.total_exposure_usd} />}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                {summary.data ? summary.data.open_cases + " open cases | " + summary.data.in_inquiry + " inquiry / " + summary.data.in_claim + " claim" : "Reporting is unreachable; no exposure figure is shown rather than a guess."}
              </p>
            </div>
            <div className="p-5">
              <FieldLabel rule tone="emerald">Protected</FieldLabel>
              <div className="tnum mt-3 font-mono text-[22px] font-medium leading-none text-emerald">
                {loading || summary.data === null ? <span aria-label="Loading protected value">-</span> : <MoneyTicker value={summary.data.protected_usd} className="text-emerald" />}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">Value defended by the deterministic path.</p>
            </div>
            <div className="p-5">
              <FieldLabel rule tone="emerald">Fees avoided</FieldLabel>
              <div className="tnum mt-3 font-mono text-[22px] font-medium leading-none text-emerald">
                {loading || summary.data === null ? <span aria-label="Loading fees avoided">-</span> : <MoneyTicker value={summary.data.fees_avoided_usd} className="text-emerald" />}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">Saved versus fighting every inquiry.</p>
            </div>
            <div className="p-5">
              <FieldLabel rule tone="ice">Avg p(win)</FieldLabel>
              <div className="tnum mt-3 font-mono text-[22px] font-medium leading-none text-ink">
                {loading || summary.data === null ? <span aria-label="Loading average win probability">-</span> : <NumberTicker key={Math.round(avgPWin * 1000)} value={avgPWin * 100} decimals={1} suffix="%" />}
              </div>
              <p className="mt-2 text-[11px] leading-snug text-muted">
                {summary.data ? "Win-rate estimate " + formatPercent(summary.data.win_rate_estimate) + " | " + summary.data.chain_verified_customers + " verified customers" : "Reporting is unreachable."}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-chrome px-5 py-2 font-mono text-[9.5px] text-dim">
            <span>GET /api/v1/reporting/summary</span>
            <span aria-hidden>|</span>
            <span>{summary.updatedAt ? "read " + new Date(summary.updatedAt).toLocaleTimeString("en-GB", { hour12: false }) : "awaiting first read"}</span>
            <span aria-hidden>|</span>
            <span>polling 5s | paused while hidden</span>
          </div>
        </Panel>
      </Reveal>

      {summary.error ? <ErrorBanner error={summary.error} context="Portfolio KPIs could not be refreshed." onRetry={summary.refresh} /> : null}

      <Reveal>
        {highVolume !== null ? (
          <LiquidGlass depth={2} grid accent={highVolume.flag ? "rose" : "emerald"}>
            <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <div className="border-b border-white/10 p-6 lg:border-b-0 lg:border-r">
                <FieldLabel rule tone={highVolume.flag ? "rose" : "emerald"}>Rolling dispute ratio</FieldLabel>
                <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2">
                  <span className="tnum font-mono text-[44px] font-medium leading-none tracking-[-0.02em] text-ink">{formatPercent(highVolume.ratio, 2)}</span>
                  <Badge tone={highVolume.flag ? "rose" : "emerald"} dot>{highVolume.flag ? "ABOVE THRESHOLD" : "BELOW THRESHOLD"}</Badge>
                </div>
                <p className="mt-3 max-w-xl text-[12px] leading-relaxed text-muted">High-volume merchants pay a $30 fee that is not refunded on a win: above the line, a $25 claim can lose money even when fought. Every fight decision is priced against this line first.</p>
                <ThresholdMeter ratio={highVolume.ratio} limit={highVolume.threshold} summary={"Rolling dispute ratio " + formatPercent(highVolume.ratio, 2) + " against the high-volume limit " + formatPercent(highVolume.threshold, 2)} className="mt-4" />
              </div>
              <div className="p-6">
                <FieldLabel rule>Measured inputs</FieldLabel>
                <div className="mt-2">
                  <MeasuredRow label="3-month sales" value={formatInteger(highVolume.sales_3mo)} />
                  <MeasuredRow label="3-month disputes" value={formatInteger(highVolume.disputes_3mo)} />
                  <MeasuredRow label="High-volume line" value={formatPercent(highVolume.threshold, 2)} tone="amber" />
                  <MeasuredRow label="Headroom" value={highVolume.flag ? "+" + formatPercent(highVolume.ratio - highVolume.threshold, 2) + " over" : formatPercent(highVolume.threshold - highVolume.ratio, 2) + " under"} tone={highVolume.flag ? "rose" : "emerald"} />
                  <MeasuredRow label="Status" value={highVolume.flag ? "fee cliff applies" : "standard fees"} tone={highVolume.flag ? "rose" : "emerald"} />
                </div>
              </div>
            </div>
          </LiquidGlass>
        ) : (
          <Panel>
            <PanelHeader kicker="Fee cliff" title="Rolling dispute ratio" />
            <PanelBody>{summary.loading ? <Skeleton className="h-[150px] w-full" /> : <p className="text-[11.5px] text-muted">High-volume status is unavailable.</p>}</PanelBody>
          </Panel>
        )}
      </Reveal>

      <div className="grid gap-4 xl:grid-cols-2">
        <Reveal className="min-w-0">
          <Panel className="h-full">
            <PanelHeader kicker="Decision mix" title="Cases by recommendation" description={meta ? "Live queue: " + rows.length + " of " + meta.total + " cases, counted from the triage API." : "Live triage queue."} actions={<span className="inline-flex items-center gap-1.5 font-mono text-[9.5px] text-dim"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />polling 5s</span>} />
            <PanelBody>
              {queue.loading ? <Skeleton className="h-[190px] w-full" /> : rows.length === 0 ? <EmptyState title="No cases to chart" description="The analytics canvas reads the live triage queue. Open an inquiry in the sandbox to populate it." action={<Link href="/" className="inline-flex h-8 items-center rounded-md border border-emerald/30 bg-emerald/10 px-3 text-[12px] font-medium text-emerald transition-colors hover:bg-emerald/15">Run the sandbox flow</Link>} /> : <BarChart data={bars} orientation="horizontal" formatValue={(value) => formatInteger(value)} summary={barSummary} />}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal className="min-w-0" delay={0.06}>
          <Panel className="h-full">
            <PanelHeader kicker="Calibration" title="Win-rate estimate" description="Share of decided cases the model expects to win, from the reporting API." />
            <PanelBody>
              {summary.loading || summary.data === null ? <Skeleton className="h-[190px] w-full" /> : (
                <div className="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
                  <DonutGauge value={summary.data.win_rate_estimate} formatValue={(value) => formatPercent(value, 0)} summary={"Win-rate estimate " + formatPercent(summary.data.win_rate_estimate, 1) + " of decided cases."} tone="emerald" caption="of decided cases" />
                  <div>
                    <FieldLabel rule>Model readouts</FieldLabel>
                    <div className="mt-2">
                      <MeasuredRow label="Avg p(win)" value={formatPercent(summary.data.avg_p_win, 1)} tone="sky" />
                      <MeasuredRow label="Verified customers" value={formatInteger(summary.data.chain_verified_customers)} />
                      <MeasuredRow label="Suspended subscriptions" value={formatInteger(summary.data.subscription_suspensions)} tone="amber" />
                      <MeasuredRow label="Total cases" value={formatInteger(summary.data.total_cases)} />
                    </div>
                  </div>
                </div>
              )}
            </PanelBody>
          </Panel>
        </Reveal>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Reveal className="min-w-0">
          <Panel className="h-full">
            <PanelHeader kicker="Intake" title="New cases per day" description="Queue arrivals over the last 14 days, bucketed from case creation timestamps." />
            <PanelBody>
              {queue.loading ? <Skeleton className="h-[120px] w-full" /> : (<>
                <LineSpark points={intake.points} labels={intake.labels} formatValue={(value) => formatInteger(value)} summary={intakeSummary} tone="sky" height={84} />
                <p className="tnum mt-2 font-mono text-[10px] text-dim">{intakeTotal === 0 ? "No arrivals in the last 14 days." : "Total " + intakeTotal + " arrivals | peak " + intakePeak + (intakePeakLabel === "" ? "" : " on " + intakePeakLabel) + "."}</p>
              </>)}
            </PanelBody>
          </Panel>
        </Reveal>
        <Reveal className="min-w-0" delay={0.06}>
          <Panel className="h-full">
            <PanelHeader kicker="Composition" title="Queue by stage" description="Where the live queue sits in the dispute lifecycle." />
            <PanelBody>
              {queue.loading ? <Skeleton className="h-[120px] w-full" /> : rows.length === 0 ? <p className="text-[11.5px] text-muted">No cases on the queue.</p> : <StackedBar segments={segments} formatValue={(value) => formatInteger(value)} summary={stageSummary} />}
            </PanelBody>
          </Panel>
        </Reveal>
      </div>

      <Panel className="overflow-hidden">
        <PanelHeader kicker="Queue snapshot" title="Triage queue" description="Compact view of the live queue; filters and full EV columns live on the triage page." actions={<Link href="/disputes" className="inline-flex items-center gap-1 text-[11px] text-muted transition-colors hover:text-ink">Full queue<ArrowRight size={11} aria-hidden /></Link>} />
        <div className="border-t border-hairline">
          {queue.loading ? (
            <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading queue snapshot">
              <Skeleton className="h-8 w-full" />
              {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-10 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4"><EmptyState title="No cases on the queue" description="Run the sandbox flow to create a dispute, then this canvas will price it." /></div>
          ) : (
            <DisputesGridLoader rows={rows} now={nowMs} height={300} compact onRowClick={(disputeId) => { router.push("/disputes/" + encodeURIComponent(disputeId)); }} />
          )}
        </div>
        {queue.error ? <div className="p-3"><ErrorBanner error={queue.error} context="The queue snapshot could not be refreshed." onRetry={queue.refresh} /></div> : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-hairline bg-white/[0.012] px-3 py-2.5 text-[9.5px] text-dim">
        {RECOMMENDATION_ORDER.map((action) => {
          const item = RECOMMENDATION_META[action];
          return (
            <span key={action} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[item.tone])} />
              <span className={TONE_TEXT[item.tone]}>{item.short}</span>
              <span className="text-dim">|</span>
              <span>{item.label}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}