"use client";

/**
 * /analytics - the research ledger. A ruled header carries the portfolio
 * figures, the breakdown the reader scans first sits beside the intake slope,
 * the high-volume fee cliff is the centrepiece, and the queue closes the page
 * as a full-width ruled table. Every number is served by
 * GET /api/v1/reporting/summary or GET /api/v1/disputes.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { LineSpark, ThresholdMeter } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatDayLabel,
  formatInteger,
  formatPercent,
  formatUsd,
  isoToMs,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import {
  DISPUTE_REASONS,
  type DisputeStage,
  type DisputeSummary,
  type RecommendedAction,
} from "@/lib/types";
import {
  REASON_META,
  RECOMMENDATION_META,
  RECOMMENDATION_ORDER,
  STAGE_META,
} from "@/lib/vocab";

const STAGE_ORDER: DisputeStage[] = [
  "INQUIRY",
  "CHARGEBACK",
  "PRE_ARBITRATION",
  "RESOLVED",
  "CLOSED",
];
const DAY_MS = 86_400_000;
const RANGE_OPTIONS = [7, 14, 30] as const;
type RangeDays = (typeof RANGE_OPTIONS)[number];

type Grouping = "stage" | "reason" | "recommendation";
const GROUPINGS: Array<{ key: Grouping; label: string; heading: string }> = [
  { key: "stage", label: "By stage", heading: "Cases by stage" },
  { key: "reason", label: "By reason", heading: "Cases by reason" },
  { key: "recommendation", label: "By recommendation", heading: "Cases by recommendation" },
];

/** "2026-11-06" for a ruled table cell. A missing date reads as a grey dash. */
function isoDate(value: string | null | undefined): string {
  const ms = isoToMs(value);
  return ms === null ? "-" : new Date(ms).toISOString().slice(0, 10);
}

/** Daily arrivals counted from case creation timestamps, one bucket per day. */
function bucketIntake(rows: DisputeSummary[], nowMs: number, days: number): { labels: string[]; points: number[] } {
  const dayStart = Math.floor(nowMs / DAY_MS) * DAY_MS;
  const labels: string[] = [];
  const points: number[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
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

type RankItem = { key: string; label: string; value: number };

function rankItems(rows: DisputeSummary[], grouping: Grouping): RankItem[] {
  if (grouping === "stage") {
    return STAGE_ORDER.map((stage) => ({
      key: stage,
      label: STAGE_META[stage].short,
      value: rows.filter((row) => row.stage === stage).length,
    }));
  }
  if (grouping === "reason") {
    return DISPUTE_REASONS.map((reason) => ({
      key: reason,
      label: REASON_META[reason].short,
      value: rows.filter((row) => row.reason_code === reason).length,
    }));
  }
  return RECOMMENDATION_ORDER.map((action: RecommendedAction) => ({
    key: action,
    label: RECOMMENDATION_META[action].short,
    value: rows.filter((row) => row.recommended_action === action).length,
  }));
}

/** /analytics - the exposure ledger: ranked breakdown, intake, fee cliff, queue. */
export function AnalyticsWorkspace(): React.JSX.Element {
  const now = useNow(30000);
  const summary = usePolledQuery("analytics:summary", (signal) => api.reportingSummary(signal), {
    intervalMs: 5000,
  });
  const queue = usePolledQuery(
    "analytics:queue",
    (signal) => api.listDisputes({ page: 1, perPage: 100 }, signal),
    { intervalMs: 5000 },
  );

  const [grouping, setGrouping] = useState<Grouping>("stage");
  const [range, setRange] = useState<RangeDays>(14);

  const queueData = queue.data?.data;
  const rows = useMemo(() => queueData ?? [], [queueData]);
  const meta = queue.data?.meta ?? null;
  const report = summary.data;
  const highVolume = report?.high_volume ?? null;
  const nowMs = now ?? Date.now();

  const groupingLabel = GROUPINGS.find((item) => item.key === grouping)?.heading ?? "Cases by stage";
  const ranked = useMemo(() => rankItems(rows, grouping), [rows, grouping]);
  const rankedPeak = ranked.reduce((peak, item) => Math.max(peak, item.value), 0);

  const intake = useMemo(() => bucketIntake(rows, nowMs, range), [rows, nowMs, range]);
  const intakeTotal = intake.points.reduce((sum, value) => sum + value, 0);
  const intakePeak = intake.points.reduce((peak, value) => Math.max(peak, value), 0);
  const intakePeakIndex = intake.points.indexOf(intakePeak);
  const intakePeakLabel = intakePeakIndex >= 0 ? (intake.labels[intakePeakIndex] ?? "") : "";
  const intakeSummary =
    "New cases per day, last " +
    range +
    " days: total " +
    intakeTotal +
    ", peak " +
    intakePeak +
    (intakePeakLabel === "" ? "" : " on " + intakePeakLabel) +
    ".";

  const tableRows = useMemo(
    () =>
      rows.map((row) => ({
        id: row.dispute_id,
        reason: REASON_META[row.reason_code].short,
        stage: STAGE_META[row.stage].short,
        stageTone: STAGE_META[row.stage].tone,
        amount: formatUsd(row.amount_usd),
        pWin: formatPercent(row.p_win, 1),
        evFight: formatUsd(row.ev_fight_usd),
        due: isoDate(row.seller_response_due_date),
        opened: isoDate(row.created_at),
      })),
    [rows],
  );
  const tableTotal = rows.reduce((sum, row) => sum + row.amount_usd, 0);

  const readouts: Array<[string, string]> = [
    ["Cases on file", meta ? formatInteger(meta.total) : "-"],
    ["In inquiry", report ? formatInteger(report.in_inquiry) : "-"],
    ["In claim", report ? formatInteger(report.in_claim) : "-"],
    ["Win-rate estimate", report ? formatPercent(report.win_rate_estimate, 1) : "-"],
    ["Verified customers", report ? formatInteger(report.chain_verified_customers) : "-"],
    ["Suspended subscriptions", report ? formatInteger(report.subscription_suspensions) : "-"],
  ];
  const readoutsLoading = summary.loading || report === null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={
          <span className="title-section">
            Last {range} days to {formatDayLabel(nowMs)}
          </span>
        }
        meta={
          <>
            <PageMeta
              label="Open exposure"
              value={
                summary.loading || report === null ? (
                  <span aria-hidden className="skeleton inline-block h-5 w-28 align-middle" />
                ) : (
                  "-" + formatUsd(report.total_exposure_usd)
                )
              }
            />
            <PageMeta
              label="Open cases"
              value={
                summary.loading || report === null ? (
                  <span aria-hidden className="skeleton inline-block h-5 w-10 align-middle" />
                ) : (
                  formatInteger(report.open_cases)
                )
              }
            />
            <PageMeta
              label="Protected"
              value={
                summary.loading || report === null ? (
                  <span aria-hidden className="skeleton inline-block h-5 w-28 align-middle" />
                ) : (
                  "+" + formatUsd(report.protected_usd)
                )
              }
            />
            <PageMeta
              label="Fees avoided"
              value={
                summary.loading || report === null ? (
                  <span aria-hidden className="skeleton inline-block h-5 w-28 align-middle" />
                ) : (
                  "+" + formatUsd(report.fees_avoided_usd)
                )
              }
            />
            <PageMeta
              label="Avg p(win)"
              value={
                summary.loading || report === null ? (
                  <span aria-hidden className="skeleton inline-block h-5 w-14 align-middle" />
                ) : (
                  formatPercent(report.avg_p_win, 1)
                )
              }
            />
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                loading={summary.refreshing}
                icon={<RefreshCw size={12} aria-hidden />}
                onClick={summary.refresh}
              >
                Refresh
              </Button>
            </div>
          </>
        }
      />

      <div
        role="tablist"
        aria-label="Breakdown"
        className="mt-5 flex flex-wrap items-end gap-x-6 gap-y-1"
      >
        {GROUPINGS.map((item) => {
          const active = item.key === grouping;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setGrouping(item.key)}
              className={cn(
                "relative pb-2.5 text-sm transition-colors duration-120",
                active ? "sig text-ink" : "text-muted hover:text-ink",
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div aria-hidden className="h-px w-full bg-rule" />

      {summary.error ? (
        <ErrorBanner
          error={summary.error}
          context="Portfolio KPIs could not be refreshed."
          onRetry={summary.refresh}
        />
      ) : null}

      {highVolume !== null ? (
        <Panel>
          <PanelHeader
            title="High-volume fee cliff"
            description="Above PayPal's rolling threshold the $30 fee is not refunded on a win, so a small claim can lose money even when it is fought."
            actions={
              <Badge tone={highVolume.flag ? "negative" : "positive"} dot>
                {highVolume.flag ? "Above threshold" : "Below threshold"}
              </Badge>
            }
          />
          <PanelBody className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-center">
            <div className="min-w-0">
              <p className="value text-xl text-ink">{formatPercent(highVolume.ratio, 2)}</p>
              <p className="mt-2 max-w-[44ch] text-sm text-muted">
                {formatPercent(highVolume.ratio, 2)} against the{" "}
                {formatPercent(highVolume.threshold, 2)} limit,{" "}
                {(Math.abs(highVolume.threshold - highVolume.ratio) * 100).toFixed(2)} points{" "}
                {highVolume.flag ? "over" : "under"}. Rolling 3-month disputes over sales.
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-x-6">
                <div className="row-rule flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-sm text-muted">3-month sales</dt>
                  <dd className="num text-right text-sm text-ink">{formatInteger(highVolume.sales_3mo)}</dd>
                </div>
                <div className="row-rule flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-sm text-muted">3-month disputes</dt>
                  <dd className="num text-right text-sm text-ink">{formatInteger(highVolume.disputes_3mo)}</dd>
                </div>
                <div className="row-rule col-span-2 flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-sm text-muted">Fee applied to a fought claim</dt>
                  <dd className="num text-right text-sm text-ink">
                    {highVolume.flag ? "$30, not refunded on a win" : "standard fees"}
                  </dd>
                </div>
              </dl>
            </div>
            <ThresholdMeter
              ratio={highVolume.ratio}
              limit={highVolume.threshold}
              summary={
                "Rolling dispute ratio " +
                formatPercent(highVolume.ratio, 2) +
                " against the high-volume limit " +
                formatPercent(highVolume.threshold, 2)
              }
            />
          </PanelBody>
        </Panel>
      ) : (
        <Panel>
          <PanelHeader title="High-volume fee cliff" />
          <PanelBody>
            {summary.loading ? (
              <Skeleton className="h-20 w-full" />
            ) : (
              <p className="text-sm text-muted">High-volume status is unavailable.</p>
            )}
          </PanelBody>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-[43fr_57fr]">
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <p className="label">{groupingLabel}</p>
            <p className="num text-2xs text-muted">
              {formatInteger(rows.length)}
              {meta ? " of " + formatInteger(meta.total) : ""} cases
            </p>
          </div>
          {queue.loading ? (
            <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading breakdown">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-5 w-full" />
              ))}
            </div>
          ) : (
            <ul className="mt-3">
              {ranked.map((item) => {
                const share = rankedPeak > 0 ? (item.value / rankedPeak) * 100 : 0;
                const percent = rows.length > 0 ? (item.value / rows.length) * 100 : 0;
                return (
                  <li key={item.key} className="flex h-7 items-center gap-3">
                    <span className="w-[104px] shrink-0 truncate text-sm text-ink" title={item.label}>
                      {item.label}
                    </span>
                    <span aria-hidden className="h-0.5 min-w-0 flex-1 rounded-full bg-raised">
                      <span className="block h-full rounded-full bg-chart-1" style={{ width: share + "%" }} />
                    </span>
                    <span className="num w-12 shrink-0 text-right text-sm text-muted">
                      {percent.toFixed(1)}%
                    </span>
                    <span className="num w-10 shrink-0 text-right text-sm text-ink">
                      {formatInteger(item.value)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-x-6">
            {readouts.map(([label, value]) => (
              <div key={label} className="row-rule flex items-baseline justify-between gap-3 py-2">
                <dt className="text-sm text-muted">{label}</dt>
                <dd className="num text-right text-sm text-ink">
                  {readoutsLoading ? (
                    <Skeleton className="h-3 w-12" />
                  ) : (
                    value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <Panel className="min-w-0">
          <PanelHeader
            title="New cases per day"
            description="Arrivals bucketed from case creation timestamps."
            actions={
              <span className="inline-flex items-center gap-1.5 text-sm text-muted">
                <span aria-hidden className="h-[5px] w-[5px] rounded-full bg-chart-1" />
                New cases
              </span>
            }
          />
          <PanelBody>
            {queue.loading ? (
              <Skeleton className="h-[120px] w-full" />
            ) : (
              <>
                <LineSpark
                  points={intake.points}
                  labels={intake.labels}
                  formatValue={formatInteger}
                  summary={intakeSummary}
                  tone="neutral"
                  height={96}
                />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="flex items-center gap-4" role="group" aria-label="Chart range">
                    {RANGE_OPTIONS.map((days) => {
                      const active = days === range;
                      return (
                        <button
                          key={days}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setRange(days)}
                          className={cn(
                            "pb-0.5 text-sm transition-colors duration-120",
                            active ? "sig text-ink" : "text-muted hover:text-ink",
                          )}
                        >
                          {days} days
                        </button>
                      );
                    })}
                  </div>
                  <span className="text-2xs text-muted">Updated daily</span>
                </div>
                <p className="num mt-2 text-2xs text-muted">
                  Total {formatInteger(intakeTotal)} arrivals
                  {intakePeakLabel === "" ? "" : " | peak " + formatInteger(intakePeak) + " on " + intakePeakLabel}
                </p>
              </>
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="space-y-3">
        <h2 className="title-section">Cases in the queue</h2>
        <Panel className="overflow-hidden">
          <table className="w-full border-collapse">
            <caption className="sr-only">
              Cases on the triage queue with stage, reason, amount, win probability, expected
              value of fighting and deadlines.
            </caption>
            <thead>
              <tr className="h-[38px] text-2xs text-muted">
                <th scope="col" className="pl-4 pr-3 text-left font-medium">
                  Case
                </th>
                <th scope="col" className="hidden px-3 text-left font-medium md:table-cell">
                  Reason
                </th>
                <th scope="col" className="px-3 text-left font-medium">
                  Stage
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="hidden px-3 text-right font-medium md:table-cell">
                  p(win)
                </th>
                <th scope="col" className="hidden px-3 text-right font-medium lg:table-cell">
                  EV to fight
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Seller due
                </th>
                <th scope="col" className="hidden pl-3 pr-4 text-right font-medium lg:table-cell">
                  Opened
                </th>
              </tr>
            </thead>
            {queue.loading ? (
              <tbody>
                {Array.from({ length: 6 }, (_, index) => (
                  <tr key={index} className="row-rule h-row">
                    <td colSpan={8} className="px-4">
                      <Skeleton className="h-3 w-full" />
                    </td>
                  </tr>
                ))}
              </tbody>
            ) : tableRows.length === 0 ? (
              <tbody>
                <tr className="row-rule">
                  <td colSpan={8}>
                    <EmptyState
                      title="No cases on the queue"
                      description="Run the sandbox flow to open an inquiry, then this ledger will price it."
                      action={
                        <Link
                          href="/"
                          className="inline-flex h-8 items-center rounded-full border border-control bg-raised px-3 text-sm font-medium text-ink transition-colors duration-120 hover:bg-[#29282c]"
                        >
                          Run the sandbox flow
                        </Link>
                      }
                    />
                  </td>
                </tr>
              </tbody>
            ) : (
              <>
                <tbody>
                  {tableRows.map((row) => (
                    <tr key={row.id} className="row-rule h-row">
                      <th scope="row" className="pl-4 pr-3 text-left font-normal">
                        <Link
                          href={"/disputes/" + encodeURIComponent(row.id)}
                          className="num text-sm text-ink transition-colors duration-120 hover:text-accent"
                          title={row.id}
                        >
                          {shortHash(row.id, 10, 4)}
                        </Link>
                      </th>
                      <td className="hidden px-3 text-sm text-muted md:table-cell">{row.reason}</td>
                      <td className="px-3">
                        <Badge tone={row.stageTone}>{row.stage}</Badge>
                      </td>
                      <td className="num px-3 text-right text-sm text-muted">{row.amount}</td>
                      <td className="num hidden px-3 text-right text-sm text-muted md:table-cell">
                        {row.pWin}
                      </td>
                      <td className="num hidden px-3 text-right text-sm text-muted lg:table-cell">
                        {row.evFight}
                      </td>
                      <td className="num px-3 text-right text-sm text-muted">{row.due}</td>
                      <td className="num hidden pl-3 pr-4 text-right text-sm text-muted lg:table-cell">
                        {row.opened}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="row-rule h-row">
                    <th scope="row" colSpan={3} className="pl-4 pr-3 text-left text-sm font-medium text-ink">
                      Total, {formatInteger(tableRows.length)} cases
                    </th>
                    <td className="num px-3 text-right text-sm text-ink">{formatUsd(tableTotal)}</td>
                    <td className="hidden px-3 text-right text-sm text-muted md:table-cell">-</td>
                    <td className="hidden px-3 text-right text-sm text-muted lg:table-cell">-</td>
                    <td className="px-3 text-right text-sm text-muted">-</td>
                    <td className="hidden pl-3 pr-4 text-right text-sm text-muted lg:table-cell">-</td>
                  </tr>
                </tfoot>
              </>
            )}
          </table>
        </Panel>
        {queue.error ? (
          <ErrorBanner
            error={queue.error}
            context="The queue could not be refreshed."
            onRetry={queue.refresh}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted">
        <span className="num">
          GET /api/v1/reporting/summary | GET /api/v1/disputes | polled every 5s while visible
        </span>
        <span className="num">
          {summary.updatedAt
            ? "Reporting read " + new Date(summary.updatedAt).toLocaleTimeString("en-GB", { hour12: false })
            : "Awaiting the first reporting read"}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/disputes"
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm text-muted transition-colors duration-120 hover:text-ink"
        >
          Open the full queue
          <ArrowRight size={12} aria-hidden />
        </Link>
      </div>
    </div>
  );
}
