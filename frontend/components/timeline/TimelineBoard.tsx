"use client";

import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { Variants } from "motion/react";

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
  formatInteger,
  formatPercent,
  formatUsd,
  formatWeekday,
  isoToMs,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { EASE_OUT, stagger } from "@/lib/motion";
import type { DisputeSummary } from "@/lib/types";
import { REASON_META, TONE_BAR, TONE_DOT, type Tone } from "@/lib/vocab";

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 14;
const DAY_PCT = 100 / WINDOW_DAYS;
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
  if (daysLeft <= 0) return { label: "overdue", tone: "negative" };
  if (daysLeft <= 3) return { label: "3 days or less", tone: "warning" };
  if (daysLeft <= 7) return { label: "7 days or less", tone: "accent" };
  return { label: "more than 7 days", tone: "positive" };
}

const LEGEND: Urgency[] = [
  { label: "Overdue", tone: "negative" },
  { label: "3 days or less", tone: "warning" },
  { label: "7 days or less", tone: "accent" },
  { label: "More than 7 days", tone: "positive" },
];

/* The bar grows into place, the diamond end marker pops in after it. Both stay
   behind the shared stagger parent so the entrance runs only on first mount. */
const BAR_MOTION: Variants = {
  hidden: { scaleX: 0 },
  show: { scaleX: 1, transition: { duration: 0.5, ease: EASE_OUT } },
};

const DIAMOND_MOTION: Variants = {
  hidden: { opacity: 0, scale: 0.4 },
  show: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: EASE_OUT } },
};

/* Hour-and-minute clock for the now-line label (the full formatClock carries
   sub-second noise that a wall-clock tick does not need). */
const nowClock = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/* The day headers read in the viewer's own time zone, so a deadline cell printed
   as a UTC ISO date could name the day before or after the column it sits in
   near midnight. Format it with the same local-day helper the headers use. */
function isoDate(date: string | null): string {
  const ms = isoToMs(date);
  if (ms === null) return "-";
  return formatDayLabel(ms);
}

function DayHeader({ now }: { now: number | null }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] border-b border-rule md:grid-cols-[240px_minmax(0,1fr)]">
      <div className="sticky left-0 z-sticky flex items-center gap-2 border-r border-rule bg-surface px-3 py-2.5 md:px-4">
        <CalendarClock size={12} className="shrink-0 text-muted" aria-hidden />
        <span className="min-w-0 truncate text-sm text-muted">
          <span className="hidden md:inline">Case, seller response deadline</span>
          <span className="md:hidden">Case deadline</span>
        </span>
      </div>
      <div
        className="relative grid"
        style={{ gridTemplateColumns: "repeat(" + String(WINDOW_DAYS) + ", minmax(0, 1fr))" }}
      >
        {Array.from({ length: WINDOW_DAYS }, (_, index) => {
          const day = now === null ? null : new Date(now + index * DAY_MS);
          const isToday = index === 0;
          return (
            <div key={index} className="relative border-l border-rule px-2 pb-1.5 pt-2">
              {isToday ? (
                <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-accent" />
              ) : null}
              <div className={cn("text-sm", isToday ? "text-ink" : "text-muted")}>
                {isToday ? "Today" : day ? formatWeekday(day) : "-"}
              </div>
              {isToday && day ? (
                <div className="num mt-0.5 flex items-center gap-1 text-2xs font-medium text-accent">
                  <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-accent" />
                  now {nowClock.format(day)}
                </div>
              ) : (
                <div className="num mt-0.5 text-sm text-muted">
                  {day ? formatDayLabel(day) : "-"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* The current-time marker: a slow, restrained opacity drift (not a flash),
   disabled entirely under reduced motion. It reads "alive", never "alerting". */
function NowLine() {
  const reduced = useReducedMotion() ?? false;
  return (
    <motion.span
      aria-hidden
      className="absolute inset-y-0 left-0 w-[2px] bg-accent"
      animate={reduced ? { opacity: 0.9 } : { opacity: [0.9, 0.42, 0.9] }}
      transition={
        reduced
          ? { duration: 0 }
          : { duration: 3.2, ease: "easeInOut", repeat: Infinity }
      }
    />
  );
}

/* The lane backdrop: three severity bands read left-to-right from the now line
   (overdue → due-soon → future), then the 14 column rules and the accent now
   line on top. Rendered per row so every lane stays aligned to the grid. */
function LaneGrid() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <span
        className="absolute inset-y-0 left-0 bg-negative/10"
        style={{ width: DAY_PCT + "%" }}
      />
      <span
        className="absolute inset-y-0 bg-warning/5"
        style={{ left: DAY_PCT + "%", width: DAY_PCT * 2 + "%" }}
      />
      {Array.from({ length: WINDOW_DAYS }, (_, index) => (
        <span
          key={index}
          className="absolute inset-y-0 border-l border-rule"
          style={{ left: index * DAY_PCT + "%" }}
        />
      ))}
      <NowLine />
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
  const daysBeyond =
    beyondWindow && dueMs !== null
      ? Math.ceil((dueMs - (now + WINDOW_DAYS * DAY_MS)) / DAY_MS)
      : 0;
  const reason = REASON_META[dispute.reason_code];
  const overdue = daysLeft !== null && daysLeft <= 0;

  return (
    <Link
      href={"/disputes/" + encodeURIComponent(dispute.dispute_id)}
      className="group grid grid-cols-[180px_minmax(0,1fr)] border-b border-rule transition-colors duration-120 last:border-b-0 md:grid-cols-[240px_minmax(0,1fr)]"
      aria-label={"Open case " + dispute.dispute_id + ", " + (urgency ? urgency.label : "no deadline")}
    >
      <div className="relative min-w-0 border-r border-rule bg-surface px-3 py-2.5 transition-colors duration-120 group-hover:bg-raised/60 md:px-4">
        {overdue ? (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-[3px] bg-negative"
          />
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span className="num min-w-0 truncate text-base text-ink" title={dispute.dispute_id}>
            {shortHash(dispute.dispute_id, 10, 3)}
          </span>
          <span className="num shrink-0 text-sm text-muted">
            {formatUsd(dispute.amount_usd)}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Badge tone={reason.tone} title={reason.label}>
            {reason.short}
          </Badge>
          {overdue ? <Badge tone="negative">Overdue</Badge> : null}
          <span className="num hidden text-sm text-muted md:inline">
            {isoDate(dispute.seller_response_due_date)}
          </span>
        </div>
      </div>

      <div className="relative h-row transition-colors duration-120 group-hover:bg-raised/30">
        <LaneGrid />
        {dueMs !== null && urgency ? (
          <span className="absolute inset-y-0" style={{ left: 0, width: width + "%" }}>
            <span className="flex h-full items-center">
              <motion.span
                variants={BAR_MOTION}
                className={cn("block h-[9px] w-full rounded-full", TONE_BAR[urgency.tone])}
                style={{ transformOrigin: "left center" }}
              />
            </span>
            <span className="absolute right-[-5px] top-[calc(50%_-_5px)] h-2.5 w-2.5">
              <motion.span variants={DIAMOND_MOTION} className="block h-full w-full">
                <span
                  aria-hidden
                  className={cn("block h-full w-full rotate-45 rounded-[2px]", TONE_DOT[urgency.tone])}
                />
              </motion.span>
            </span>
            {beyondWindow ? (
              <span
                className="absolute right-[14px] top-1/2 -translate-y-1/2 rounded-control border border-line bg-raised px-1.5 text-2xs text-accent"
                title={daysBeyond + " days beyond the 14-day window"}
              >
                +{daysBeyond}
              </span>
            ) : null}
            <span className="pointer-events-none absolute bottom-full right-0 z-sticky mb-2 hidden w-60 rounded-card border border-line bg-raised p-2.5 text-left shadow-float group-hover:block group-focus-visible:block">
              <span className="block text-2xs text-muted">Open case</span>
              <span
                className="num mt-1 block text-sm font-medium text-ink"
                title={dispute.dispute_id}
              >
                {shortHash(dispute.dispute_id, 16, 6)}
              </span>
              <span className="num mt-0.5 block text-xs text-muted">
                payer {shortHash(dispute.payer_id, 8, 4)}
              </span>
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <Badge tone={reason.tone}>{reason.short}</Badge>
                <Badge tone={urgency.tone}>{urgency.label}</Badge>
              </span>
              <span className="num mt-1.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">amount</span>
                <span className="text-ink">{formatUsd(dispute.amount_usd)}</span>
              </span>
              <span className="num mt-0.5 flex items-center justify-between gap-2 text-xs">
                <span className="text-muted">deadline</span>
                <span className="text-ink">
                  {formatAbsolute(dispute.seller_response_due_date)}
                </span>
              </span>
              {beyondWindow ? (
                <span className="mt-1.5 block text-2xs text-accent">
                  +{daysBeyond} days beyond the 14-day window
                </span>
              ) : null}
            </span>
          </span>
        ) : (
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted">
            no deadline
          </span>
        )}
      </div>
    </Link>
  );
}

/** /timeline: a 14-day SLA board over a Bryntum-shaped resource/event model. */
export function TimelineBoard() {
  const reduced = useReducedMotion() ?? false;
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
    <div className="space-y-6">
      <PageHeader
        title="Seller response deadlines"
        description="Every open case runs from now to its seller response deadline across a 14-day window. Deadlines outside the window are flagged rather than clamped."
        meta={
          <>
            <PageMeta label="Open cases" value={open.length} />
            <PageMeta label="Due in 72h or less" value={atRisk.length} />
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

      <Panel className="overflow-hidden">
        <div className="grid gap-px bg-rule sm:grid-cols-2 xl:grid-cols-4">
          {query.loading ? (
            Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="bg-surface px-4 py-3.5">
                <Skeleton className="h-[76px] w-full" />
              </div>
            ))
          ) : (
            <>
              <StatTile
                className="bg-surface"
                label="Open cases"
                value={open.length}
                countValue={open.length}
                countFormat={formatInteger}
                sub={
                  query.data
                    ? query.data.meta.total + " total cases on file"
                    : "Queue unavailable"
                }
              />
              <StatTile
                className="bg-surface"
                label="Due in 72h or less"
                value={atRisk.length}
                countValue={atRisk.length}
                countFormat={formatInteger}
                sub="Includes overdue cases"
                tone="warning"
              />
              <StatTile
                className="bg-surface"
                label="Exposure in 72h or less"
                value={formatUsd(atRiskExposure)}
                sub="Claim value approaching deadline"
                tone="negative"
              />
              <StatTile
                className="bg-surface"
                label="No deadline"
                value={undated.length}
                countValue={undated.length}
                countFormat={formatInteger}
                sub="No seller_response_due_date recorded"
              />
            </>
          )}
        </div>
      </Panel>

      {query.error ? (
        <ErrorBanner
          error={query.error}
          context="The SLA board could not be refreshed."
          onRetry={query.refresh}
        />
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHeader
          title="Seller response deadlines"
          description="Each row is one case and one window from now to its deadline. The axis renders over the now line, an overdue rail, a due-soon band and a neutral future, on a CSS grid with no scheduler runtime."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {LEGEND.map((item) => (
                <Badge key={item.label} tone={item.tone} dot>
                  {item.label}
                </Badge>
              ))}
            </div>
          }
        />

        <div className="row-rule flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <span className="num text-xs text-muted">
            as of {now === null ? "--" : formatClock(now)} · {formatDayLabel(referenceNow)} to{" "}
            {formatDayLabel(referenceNow + WINDOW_DAYS * DAY_MS)}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-positive" />
            Polling every 2s while visible
          </span>
        </div>

        {query.loading ? (
          <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading timeline">
            <Skeleton className="h-10 w-full" />
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-row w-full" />
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
                  className="inline-flex h-8 items-center rounded-full border border-control bg-raised px-3 text-xs font-medium text-ink transition-colors duration-120 hover:bg-[#29282c]"
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
              <div className="border-t border-accent" aria-hidden />
              <motion.div
                variants={stagger}
                initial={reduced ? false : "hidden"}
                animate="show"
              >
                {dated.map((dispute) => (
                  <TimelineRow
                    key={dispute.dispute_id}
                    dispute={dispute}
                    now={referenceNow}
                  />
                ))}
              </motion.div>
            </div>
          </div>
        )}
      </Panel>

      {undated.length > 0 ? (
        <Panel>
          <PanelHeader
            title={undated.length + " open cases without a deadline"}
            description="PayPal has not returned seller_response_due_date for these cases. They are excluded from the 14-day window rather than guessed."
          />
          <ul>
            {undated.map((dispute) => (
              <li key={dispute.dispute_id} className="row-rule">
                <Link
                  href={"/disputes/" + encodeURIComponent(dispute.dispute_id)}
                  className="flex flex-wrap items-center gap-2 px-4 py-3 text-sm transition-colors duration-120 hover:bg-raised/60"
                >
                  <span className="num text-base text-ink">
                    {shortHash(dispute.dispute_id, 12, 4)}
                  </span>
                  <Badge tone={REASON_META[dispute.reason_code].tone}>
                    {REASON_META[dispute.reason_code].short}
                  </Badge>
                  <span className="num text-muted">{formatUsd(dispute.amount_usd)}</span>
                  <span className="num ml-auto text-sm text-muted">
                    p(win) {formatPercent(dispute.p_win)} · no seller_response_due_date
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-line px-4 py-3 text-xs text-muted">
        <span className="min-w-0 truncate">
          resources: [{"{"} id, name, stage {"}"}] · events: [{"{"} id, resourceId, startDate,
          endDate, color {"}"}]
        </span>
        <span className="min-w-0">
          CSS grid renderer · Bryntum runtime not licensed, not emulated
        </span>
      </div>
    </div>
  );
}
