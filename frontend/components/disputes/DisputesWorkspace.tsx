"use client";

import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useMemo, useState, type ReactNode } from "react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { StackedBar } from "@/components/charts";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { DisputeDrawer } from "@/components/disputes/DisputeDrawer";
import { SealMark } from "@/components/evidence/SealMark";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatInteger, formatPercent, formatUsd, isoToMs } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { SPRING, stagger, staggerItem } from "@/lib/motion";
import type { DisputeSummary } from "@/lib/types";
import type { Tone } from "@/lib/vocab";

const PER_PAGE = 25;
const DAY_MS = 86_400_000;
// The grid frame follows the page it is showing (theme row height 42 + header 38),
// capped so a long page scrolls inside the card instead of stretching the panel.
const GRID_ROW_HEIGHT = 42;
const GRID_HEADER_HEIGHT = 38;
const GRID_MIN_HEIGHT = 170;
const GRID_MAX_HEIGHT = 560;

type QuickFilter = "all" | "due72" | "overdue" | "chargeback" | "nodossier";

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "due72", label: "Due in 72h" },
  { key: "overdue", label: "Overdue" },
  { key: "chargeback", label: "Chargeback" },
  { key: "nodossier", label: "No dossier" },
];

type KpiStatus = "loading" | "ready" | "error";

/** A KPI reading: a count-up tabular figure with a supporting line beneath it. */
function KpiTile({
  label,
  tone = "neutral",
  status,
  valueNumber,
  valueFormat,
  sub,
}: {
  label: string;
  tone?: Tone;
  status: KpiStatus;
  valueNumber: number;
  valueFormat: (n: number) => string;
  sub: ReactNode;
}) {
  // The semantic tone applies only once the figure is real; the zero count-up
  // and the error dash both render in neutral ink rather than a false polarity.
  const ready = status === "ready";
  return (
    <StatTile
      className="h-full [&_.value]:font-mono"
      label={label}
      tone={ready ? tone : "neutral"}
      sub={sub}
      value={ready || status === "loading" ? undefined : "—"}
      countValue={ready || status === "loading" ? valueNumber : undefined}
      countFormat={ready || status === "loading" ? valueFormat : undefined}
    />
  );
}

function KpiSubBar() {
  return <span aria-hidden className="skeleton block h-3 w-32" />;
}

function matchesQuery(row: DisputeSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return (
    row.dispute_id.toLowerCase().includes(needle) ||
    row.payer_id.toLowerCase().includes(needle) ||
    row.reason_code.toLowerCase().includes(needle) ||
    row.stage.toLowerCase().includes(needle) ||
    row.channel.toLowerCase().includes(needle)
  );
}

function matchesQuick(row: DisputeSummary, quick: QuickFilter, now: number): boolean {
  if (quick === "all") return true;
  if (quick === "chargeback") return row.stage === "CHARGEBACK" || row.stage === "PRE_ARBITRATION";
  if (quick === "nodossier") return !row.dossier_available;
  const dueMs = isoToMs(row.seller_response_due_date);
  if (dueMs === null) return false;
  if (quick === "overdue") return dueMs < now;
  return dueMs - now <= 3 * DAY_MS;
}

/** /disputes - the triage queue, priced by the EV engine and read by deadline. */
export function DisputesWorkspace() {
  const reduced = useReducedMotion() ?? false;
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const now = useNow(15000);

  const query = usePolledQuery(
    "disputes:" + String(page),
    (signal) => api.listDisputes({ page, perPage: PER_PAGE }, signal),
    { intervalMs: 2000 },
  );
  const summary = usePolledQuery("reporting:disputes-summary", (signal) => api.reportingSummary(signal), {
    intervalMs: 10000,
  });

  const rows: DisputeSummary[] = useMemo(() => query.data?.data ?? [], [query.data]);
  const meta = query.data?.meta ?? null;
  const highVolume = summary.data?.high_volume ?? null;
  const totalPages = meta?.total_pages && meta.total_pages > 0 ? meta.total_pages : 1;
  const referenceNow = now ?? Date.now();

  const visible = useMemo(
    () => rows.filter((row) => matchesQuick(row, quick, referenceNow) && matchesQuery(row, filter)),
    [rows, quick, filter, referenceNow],
  );

  const activeFilterCount = (filter.trim().length > 0 ? 1 : 0) + (quick === "all" ? 0 : 1);
  const summaryData = summary.data;
  const summaryStatus: KpiStatus = summaryData ? "ready" : summary.error ? "error" : "loading";

  const otherOpen =
    summaryData && summaryData.open_cases > 0
      ? Math.max(0, summaryData.open_cases - summaryData.in_inquiry - summaryData.in_claim)
      : 0;

  // SLA risk is read off this page's real seller_response_due_date values with
  // the same 72h arithmetic the quick filters use — never a fabricated series.
  const overdueCount = rows.filter((row) => {
    const dueMs = isoToMs(row.seller_response_due_date);
    return dueMs !== null && dueMs < referenceNow;
  }).length;
  const dueSoonCount = rows.filter((row) => {
    const dueMs = isoToMs(row.seller_response_due_date);
    return dueMs !== null && dueMs >= referenceNow && dueMs - referenceNow <= 3 * DAY_MS;
  }).length;
  const slaTone: Tone = overdueCount > 0 ? "negative" : dueSoonCount > 0 ? "warning" : "neutral";

  const gridHeight = Math.min(
    GRID_MAX_HEIGHT,
    Math.max(GRID_MIN_HEIGHT, visible.length * GRID_ROW_HEIGHT + GRID_HEADER_HEIGHT + 2),
  );
  const skeletonRows = Math.max(
    1,
    Math.floor((gridHeight - GRID_HEADER_HEIGHT - 12) / GRID_ROW_HEIGHT),
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dispute exposure"
        description="Every case is priced by the deterministic EV engine, with the seller response deadline tracked to the hour."
        meta={
          <>
            <PageMeta label="Cases" value={meta ? meta.total : "-"} />
            <PageMeta label="Per page" value={PER_PAGE} />
            <PageMeta label="Refresh" value="2s while visible" />
          </>
        }
        actions={
          highVolume ? (
            <Badge tone={highVolume.flag ? "negative" : "positive"} dot>
              {highVolume.flag ? "High-volume merchant" : "Standard fee tier"}
              {" · ratio " + formatPercent(highVolume.ratio, 2) + " / " + formatPercent(highVolume.threshold, 2)}
            </Badge>
          ) : null
        }
      />

      <motion.div
        variants={stagger}
        initial={reduced ? false : "hidden"}
        animate="show"
        role="group"
        aria-label="Exposure readings"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
      >
        <motion.article variants={staggerItem} className="panel-raised p-5 sm:col-span-2 xl:col-span-4">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="label">Open exposure</p>
                {summaryData ? (
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
                ) : null}
              </div>
              <div className="value mt-1.5 font-mono text-2xl text-ink">
                {summaryStatus === "error" ? (
                  "—"
                ) : (
                  <AnimatedNumber
                    value={summaryData ? summaryData.total_exposure_usd : 0}
                    format={formatUsd}
                  />
                )}
              </div>
              <p className="mt-1.5 text-xs text-muted">
                {summaryData ? (
                  summaryData.open_cases +
                  " open · " +
                  summaryData.in_inquiry +
                  " in inquiry · " +
                  summaryData.in_claim +
                  " in claim"
                ) : summaryStatus === "error" ? (
                  "Reporting unavailable"
                ) : (
                  <KpiSubBar />
                )}
              </p>
            </div>

            {summaryData && summaryData.open_cases > 0 ? (
              <div className="w-full shrink-0 sm:w-72">
                <StackedBar
                  segments={[
                    {
                      key: "claim",
                      label: "In claim",
                      value: summaryData.in_claim,
                      tone: "negative",
                    },
                    {
                      key: "inquiry",
                      label: "In inquiry",
                      value: summaryData.in_inquiry,
                      tone: "warning",
                    },
                    { key: "other", label: "Other open", value: otherOpen, tone: "neutral" },
                  ]}
                  summary={
                    "Open exposure composition: " +
                    summaryData.in_claim +
                    " in claim, " +
                    summaryData.in_inquiry +
                    " in inquiry, " +
                    otherOpen +
                    " other open."
                  }
                />
              </div>
            ) : null}
          </div>
        </motion.article>

        {/* No sparklines: the reporting summary exposes point-in-time totals
            only, with no time series — a trend line here would be fabricated. */}
        <motion.article variants={staggerItem} className="panel">
          <KpiTile
            label="Open disputes"
            tone="neutral"
            status={summaryStatus}
            valueNumber={summaryData ? summaryData.open_cases : 0}
            valueFormat={formatInteger}
            sub={
              summaryData ? (
                <span className="num">
                  {summaryData.in_inquiry} in inquiry · {summaryData.in_claim} in claim
                </span>
              ) : summaryStatus === "error" ? (
                "Reporting unavailable"
              ) : (
                <KpiSubBar />
              )
            }
          />
        </motion.article>

        <motion.article variants={staggerItem} className="panel">
          <KpiTile
            label="Win rate"
            tone="accent"
            status={summaryStatus}
            valueNumber={summaryData ? summaryData.win_rate_estimate : 0}
            valueFormat={formatPercent}
            sub={
              summaryData ? (
                <span className="block">
                  <span className="num block">
                    avg p(win) {formatPercent(summaryData.avg_p_win)}
                  </span>
                  <ProgressBar
                    value={summaryData.avg_p_win}
                    tone="accent"
                    label="Average win probability"
                    className="mt-2"
                  />
                </span>
              ) : summaryStatus === "error" ? (
                "Reporting unavailable"
              ) : (
                <KpiSubBar />
              )
            }
          />
        </motion.article>

        <motion.article variants={staggerItem} className="panel">
          <KpiTile
            label="Exposure defended"
            tone="positive"
            status={summaryStatus}
            valueNumber={summaryData ? summaryData.protected_usd : 0}
            valueFormat={formatUsd}
            sub={
              summaryData ? (
                <span className="num inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                  <SealMark size={14} tone="positive" />
                  {formatUsd(summaryData.fees_avoided_usd)} fees avoided ·{" "}
                  {summaryData.subscription_suspensions} suspensions ·{" "}
                  {summaryData.chain_verified_customers} chain-verified
                </span>
              ) : summaryStatus === "error" ? (
                "Reporting unavailable"
              ) : (
                <KpiSubBar />
              )
            }
          />
        </motion.article>

        <motion.article variants={staggerItem} className="panel">
          <KpiTile
            label="SLA risk"
            tone={slaTone}
            status={query.data ? "ready" : query.error ? "error" : "loading"}
            valueNumber={overdueCount + dueSoonCount}
            valueFormat={formatInteger}
            sub={
              query.data ? (
                <span className="num">
                  {overdueCount} overdue · {dueSoonCount} due in 72h · this page
                </span>
              ) : query.error ? (
                "Queue unavailable"
              ) : (
                <KpiSubBar />
              )
            }
          />
        </motion.article>
      </motion.div>

      {summary.error ? (
        <ErrorBanner
          error={summary.error}
          context="Exposure readings could not be refreshed."
          onRetry={summary.refresh}
        />
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHeader
          title={meta ? meta.total + " cases · page " + meta.page + " of " + totalPages : "Loading cases"}
          description="Default order: seller response due date, soonest first."
          actions={
            <span className="num text-2xs text-muted">
              {query.data ? "Polling every 2s" : "Connecting"}
            </span>
          }
        />

        <div className="row-rule flex flex-wrap items-center gap-x-3 gap-y-2.5 px-4 py-2.5">
          <div className="relative w-full sm:w-64">
            <Search
              size={13}
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted"
            />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter id, payer, or reason"
              aria-label="Filter dispute cases"
              className="h-control w-full rounded-card border border-control bg-raised pr-8 pl-8 text-sm text-ink placeholder:text-muted [&::-webkit-search-cancel-button]:hidden"
            />
            {filter.length > 0 ? (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setFilter("")}
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted transition-colors duration-120 hover:text-ink"
              >
                <X size={13} aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
            {QUICK_FILTERS.map((option) => {
              const active = quick === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQuick(option.key)}
                  className={cn(
                    "relative h-7 rounded-full px-3 text-sm transition-colors duration-120",
                    active ? "text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {active ? (
                    reduced ? (
                      <span
                        aria-hidden
                        className="absolute inset-0 rounded-full border border-line bg-raised"
                      />
                    ) : (
                      <motion.span
                        layoutId="disputes-quick-filter"
                        transition={SPRING}
                        aria-hidden
                        className="absolute inset-0 rounded-full border border-line bg-raised"
                      />
                    )
                  ) : null}
                  <span className="relative z-[1]">{option.label}</span>
                </button>
              );
            })}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <span className="num text-2xs text-muted" aria-live="polite">
              {visible.length} of {rows.length} rows
              {activeFilterCount > 0 ? " · filtered" : ""}
            </span>
            <Button variant="secondary" size="sm" onClick={query.refresh} loading={query.refreshing}>
              Refresh
            </Button>
          </div>
        </div>

        <div className="row-rule">
          {query.error && !query.data ? (
            <div className="p-4">
              <ErrorBanner
                error={query.error}
                context="The triage queue could not be loaded."
                onRetry={query.refresh}
              />
            </div>
          ) : query.loading ? (
            <div className="space-y-2.5 p-4" style={{ height: gridHeight }} aria-busy="true" aria-label="Loading disputes">
              <Skeleton className="h-9 w-full" />
              {Array.from({ length: skeletonRows }, (_, index) => (
                <Skeleton key={index} className="h-row w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <EmptyState
              title="No disputes in the queue"
              description="The merchant has no open PayPal disputes. Run the three-button sandbox flow to open one through the real webhook path."
              action={
                <Link
                  href="/"
                  className="inline-flex h-8 items-center rounded-full border border-control bg-raised px-3 text-xs font-medium text-ink transition-colors duration-120 hover:bg-raised/80"
                >
                  Run the sandbox flow
                </Link>
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="No cases match this filter"
              description="Loosen the text query or clear the quick filter to return to the full page."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFilter("");
                    setQuick("all");
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <div className="overflow-hidden" style={{ height: gridHeight }}>
              <DisputesGridLoader
                rows={visible}
                height={gridHeight}
                onRowClick={(disputeId) => setSelectedId(disputeId)}
              />
            </div>
          )}
        </div>

        {query.error && query.data ? (
          <div className="row-rule p-4">
            <ErrorBanner
              error={query.error}
              context="Showing the last successful queue page while the API recovers."
              onRetry={query.refresh}
            />
          </div>
        ) : null}

        <PanelFooter className="flex flex-wrap items-center justify-between gap-2">
          <span className="num text-2xs text-muted">
            {meta ? meta.total + " cases · " + meta.per_page + " per page" : "0 cases"}
          </span>
          <span className="hidden text-2xs text-muted md:inline" aria-hidden>
            ↑↓ to move · Enter opens the case
          </span>
          <div className="flex items-center gap-2">
            <span className="num text-2xs text-muted">
              Page {meta ? meta.page : 1} of {totalPages}
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                icon={<ChevronLeft size={13} aria-hidden />}
              >
                Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                trailingIcon={<ChevronRight size={13} aria-hidden />}
              >
                Next
              </Button>
            </div>
          </div>
        </PanelFooter>
      </Panel>

      <DisputeDrawer
        disputeId={selectedId ?? ""}
        open={selectedId !== null}
        onClose={() => setSelectedId(null)}
      />
    </div>
  );
}
