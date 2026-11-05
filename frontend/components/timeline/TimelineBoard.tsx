"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  clamp,
  formatAbsolute,
  formatClock,
  formatDayLabel,
  formatDueIn,
  formatUsd,
  formatWeekday,
  isoToMs,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeSummary } from "@/lib/types";
import { REASON_META, type Tone, TONE_BAR, TONE_BADGE, TONE_DOT } from "@/lib/vocab";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
const OPEN_STATUSES: DisputeSummary["status"][] = [
  "OPEN",
  "WAITING_FOR_SELLER_RESPONSE",
  "UNDER_REVIEW",
];

type Urgency = {
  label: string;
  tone: Tone;
};

function urgencyFor(daysLeft: number): Urgency {
  if (daysLeft <= 0) return { label: "overdue", tone: "rose" };
  if (daysLeft <= 3) return { label: "≤ 3 days", tone: "amber" };
  if (daysLeft <= 7) return { label: "≤ 7 days", tone: "sky" };
  return { label: "> 7 days", tone: "emerald" };
}

const LEGEND: Urgency[] = [
  { label: "Overdue", tone: "rose" },
  { label: "≤ 3 days", tone: "amber" },
  { label: "≤ 7 days", tone: "sky" },
  { label: "> 7 days", tone: "emerald" },
];

function DayHeader({ now }: { now: number | null }) {
  return (
    <div className="grid grid-cols-[240px_minmax(0,1fr)] border-b border-hairline bg-[#0b1117]">
      <div className="flex items-center gap-2 px-3 py-2">
        <CalendarClock size={12} className="text-dim" aria-hidden />
        <span className="kicker">Case · seller response deadline</span>
      </div>
      <div
        className="relative grid"
        style={{ gridTemplateColumns: `repeat(${WINDOW_DAYS}, minmax(0, 1fr))` }}
      >
        {Array.from({ length: WINDOW_DAYS }, (_, index) => {
          const day = now === null ? null : new Date(now + index * DAY_MS);
          return (
            <div
              key={index}
              className={cn(
                "border-l border-hairline px-1.5 py-1.5",
                index === 0 && "bg-emerald/[0.035]",
              )}
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.08em] text-dim">
                {index === 0 ? "Today" : day ? formatWeekday(day) : "—"}
              </div>
              <div
                className={cn(
                  "font-mono text-[9.5px]",
                  index === 0 ? "text-emerald" : "text-muted",
                )}
              >
                {day ? formatDayLabel(day) : "—"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LaneGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      {Array.from({ length: WINDOW_DAYS }, (_, index) => (
        <span
          key={index}
          className="absolute inset-y-0 border-l border-hairline/70"
          style={{ left: `${(index / WINDOW_DAYS) * 100}%` }}
        />
      ))}
      <span className="absolute inset-y-0 left-0 w-px bg-emerald/40" />
    </div>
  );
}

function TimelineRow({ dispute, now }: { dispute: DisputeSummary; now: number }) {
  const dueMs = isoToMs(dispute.seller_response_due_date);
  const daysLeft = dueMs === null ? null : (dueMs - now) / DAY_MS;
  const urgency = daysLeft === null ? null : urgencyFor(daysLeft);
  const width =
    dueMs === null
      ? 0
      : clamp(((dueMs - now) / (WINDOW_DAYS * DAY_MS)) * 100, 1.4, 100);
  const beyondWindow = dueMs !== null && dueMs > now + WINDOW_DAYS * DAY_MS;
  const reason = REASON_META[dispute.reason_code];
  const overdue = daysLeft !== null && daysLeft <= 0;

  return (
    <Link
      href={`/disputes/${encodeURIComponent(dispute.dispute_id)}`}
      className="grid grid-cols-[240px_minmax(0,1fr)] border-b border-hairline/70 transition-colors last:border-b-0 hover:bg-white/[0.02] focus-visible:bg-white/[0.03]"
      aria-label={`Open case ${dispute.dispute_id}, ${urgency?.label ?? "no deadline"}`}
    >
      <div className="min-w-0 border-r border-hairline/70 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <span className="num truncate text-[10.5px] text-ink" title={dispute.dispute_id}>
            {shortHash(dispute.dispute_id, 10, 3)}
          </span>
          <span className="num shrink-0 text-[10px] text-muted">
            {formatUsd(dispute.amount_usd)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Badge tone={reason.tone} title={reason.label}>
            {reason.short}
          </Badge>
          <span
            className={cn(
              "truncate font-mono text-[9px]",
              overdue ? "text-rose" : "text-dim",
            )}
            title={formatAbsolute(dispute.seller_response_due_date)}
          >
            {dueMs === null ? "no deadline" : formatDueIn(dispute.seller_response_due_date, now)}
          </span>
        </div>
      </div>

      <div className="relative h-[46px]">
        <LaneGrid />
        {dueMs !== null && urgency ? (
          <span
            className="absolute top-1/2 -translate-y-1/2"
            style={{ left: 0, width: `${width}%` }}
            title={`${dispute.dispute_id} · due ${formatAbsolute(dispute.seller_response_due_date)}`}
          >
            <span
              className={cn(
                "block h-[9px] rounded-full",
                TONE_BAR[urgency.tone],
                overdue ? "opacity-80" : "opacity-70",
              )}
            />
            <span
              className={cn(
                "absolute -right-[3px] top-1/2 h-[13px] w-[3px] -translate-y-1/2 rounded-full",
                TONE_DOT[urgency.tone],
              )}
            />
            {beyondWindow ? (
              <span className="absolute -right-3 top-1/2 -translate-y-1/2 font-mono text-[9px] text-dim">
                ›
              </span>
            ) : null}
          </span>
        ) : (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-dim">
            no deadline
          </span>
        )}
      </div>
    </Link>
  );
}

/** /timeline — a 14-day SLA board over a Bryntum-shaped resource/event model. */
export function TimelineBoard() {
  const now = useNow(30000);
  const query = usePolledQuery(
    "timeline:queue",
    (signal) => api.listDisputes({ page: 1, perPage: 100 }, signal),
    { intervalMs: 2000 },
  );

  const rows = query.data?.data ?? [];
  const open = rows.filter((row) => OPEN_STATUSES.includes(row.status));
  const dated = open
    .filter((row) => row.seller_response_due_date !== null)
    .sort(
      (left, right) =>
        (isoToMs(left.seller_response_due_date) ?? Number.POSITIVE_INFINITY) -
        (isoToMs(right.seller_response_due_date) ?? Number.POSITIVE_INFINITY),
    );
  const undated = open.filter((row) => row.seller_response_due_date === null);

  const referenceNow = now ?? Date.now();

  const nextBreach = dated.find((row) => {
    const dueMs = isoToMs(row.seller_response_due_date);
    return dueMs !== null && dueMs > referenceNow;
  });

  const atRisk = open.filter((row) => {
    const dueMs = isoToMs(row.seller_response_due_date);
    if (dueMs === null) return false;
    return dueMs - referenceNow <= 3 * DAY_MS;
  });
  const atRiskExposure = atRisk.reduce((total, row) => total + row.amount_usd, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="SLA command board · Aurora Analytics"
        title="Seller response deadlines"
        description="Bryntum-shaped data model — drop-in scheduler swap documented in docs/. Bars run from now to each case's seller_response_due_date across a 14-day forward window."
        meta={
          <>
            <PageMeta label="Open cases" value={open.length} />
            <PageMeta label="Due ≤ 72h" value={atRisk.length} />
            <PageMeta
              label="Next breach"
              value={
                nextBreach
                  ? formatDueIn(nextBreach.seller_response_due_date, referenceNow)
                  : "none"
              }
            />
            <PageMeta label="Window" value="14 days" />
          </>
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {query.loading ? (
          Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[82px] w-full" />
          ))
        ) : (
          <>
            <StatTile
              label="Open cases"
              value={open.length}
              sub={
                query.data
                  ? `${query.data.meta.total} total cases on file`
                  : "Queue unavailable"
              }
            />
            <StatTile
              label="Due ≤ 72h"
              value={atRisk.length}
              sub="Includes overdue cases"
              tone="amber"
            />
            <StatTile
              label="Exposure ≤ 72h"
              value={formatUsd(atRiskExposure)}
              sub="Claim value approaching deadline"
              tone="rose"
            />
            <StatTile
              label="No deadline"
              value={undated.length}
              sub="No seller_response_due_date recorded"
            />
          </>
        )}
      </div>

      {query.error ? (
        <ErrorBanner
          error={query.error}
          context="The SLA board could not be refreshed."
          onRetry={query.refresh}
        />
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHeader
          kicker="Scheduler model"
          title="Resources × events"
          description="Each row is a resource (case) and one event from now to its deadline. Rendering is CSS grid, no scheduler runtime."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {LEGEND.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-medium",
                    TONE_BADGE[item.tone],
                  )}
                >
                  <span aria-hidden className={cn("h-1 w-1 rounded-full", TONE_DOT[item.tone])} />
                  {item.label}
                </span>
              ))}
            </div>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2 font-mono text-[9.5px] text-dim">
          <span>
            as of {now === null ? "—" : formatClock(now)} · {formatDayLabel(referenceNow)} →{" "}
            {formatDayLabel(referenceNow + WINDOW_DAYS * DAY_MS)}
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald live-dot" />
            polling every 2s while visible
          </span>
        </div>

        {query.loading ? (
          <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading timeline">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-[46px] w-full" />
            ))}
          </div>
        ) : open.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No open cases with deadlines"
              description="Closed and resolved cases are excluded from the SLA board. Open a case in the sandbox to populate the schedule."
              action={
                <Link
                  href="/"
                  className="inline-flex h-8 items-center rounded-md border border-emerald/30 bg-emerald/10 px-3 text-[12px] font-medium text-emerald transition-colors hover:bg-emerald/15"
                >
                  Run the sandbox flow
                </Link>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <DayHeader now={now} />
              {dated.map((dispute) => (
                <TimelineRow
                  key={dispute.dispute_id}
                  dispute={dispute}
                  now={referenceNow}
                />
              ))}
            </div>
          </div>
        )}
      </Panel>

      {undated.length > 0 ? (
        <Panel>
          <PanelHeader
            kicker="Unscheduleable"
            title={`${undated.length} open cases without a deadline`}
            description="PayPal has not returned seller_response_due_date for these cases. They are excluded from the 14-day window rather than guessed."
          />
          <ul className="divide-y divide-white/[0.045]">
            {undated.map((dispute) => (
              <li key={dispute.dispute_id}>
                <Link
                  href={`/disputes/${encodeURIComponent(dispute.dispute_id)}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5 text-[11px] transition-colors hover:bg-white/[0.02]"
                >
                  <span className="num text-ink">{shortHash(dispute.dispute_id, 12, 4)}</span>
                  <Badge tone={REASON_META[dispute.reason_code].tone}>
                    {REASON_META[dispute.reason_code].short}
                  </Badge>
                  <span className="num text-muted">{formatUsd(dispute.amount_usd)}</span>
                  <span className="ml-auto font-mono text-[9.5px] text-dim">
                    no seller_response_due_date
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-hairline bg-white/[0.012] px-3 py-2.5 font-mono text-[9.5px] text-dim">
        <span className="min-w-0 truncate">
          resources: [{"{"} id, name, stage {"}"}] · events: [{"{"} id, resourceId, startDate,
          endDate, color {"}"}]
        </span>
        <span className="shrink-0 text-muted">
          CSS grid renderer · Bryntum runtime not licensed, not emulated
        </span>
      </div>
    </div>
  );
}