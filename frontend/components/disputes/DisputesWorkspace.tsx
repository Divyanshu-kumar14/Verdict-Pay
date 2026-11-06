"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatPercent, formatUsd, isoToMs } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeSummary } from "@/lib/types";

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

/** A KPI reading: label over a tabular figure, right-aligned in its column. */
function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub: ReactNode }) {
  return (
    <StatTile
      className="bg-surface"
      label={label}
      value={<span className="block text-right">{value}</span>}
      sub={sub}
    />
  );
}

function KpiValueBar() {
  return <span aria-hidden className="skeleton ml-auto block h-5 w-28" />;
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
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const [quick, setQuick] = useState<QuickFilter>("all");
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

      <Panel role="group" aria-label="Exposure readings" className="grid grid-cols-2 gap-px overflow-hidden bg-rule xl:grid-cols-4">
        <Kpi
          label="Open exposure"
          value={summaryData ? formatUsd(summaryData.total_exposure_usd) : summary.loading ? <KpiValueBar /> : "-"}
          sub={
            summaryData ? (
              summaryData.open_cases + " open · " + summaryData.in_inquiry + " inquiry / " + summaryData.in_claim + " claim"
            ) : summary.loading ? (
              <KpiSubBar />
            ) : (
              "Reporting unavailable"
            )
          }
        />
        <Kpi
          label="Protected"
          value={summaryData ? formatUsd(summaryData.protected_usd) : summary.loading ? <KpiValueBar /> : "-"}
          sub={
            summaryData ? (
              summaryData.chain_verified_customers + " chain-verified customers"
            ) : summary.loading ? (
              <KpiSubBar />
            ) : (
              "Reporting unavailable"
            )
          }
        />
        <Kpi
          label="Fees avoided"
          value={summaryData ? formatUsd(summaryData.fees_avoided_usd) : summary.loading ? <KpiValueBar /> : "-"}
          sub={
            summaryData ? (
              summaryData.subscription_suspensions + " subscriptions suspended"
            ) : summary.loading ? (
              <KpiSubBar />
            ) : (
              "Reporting unavailable"
            )
          }
        />
        <Kpi
          label="Average p(win)"
          value={summaryData ? formatPercent(summaryData.avg_p_win) : summary.loading ? <KpiValueBar /> : "-"}
          sub={
            summaryData ? (
              "win-rate estimate " +
              formatPercent(summaryData.win_rate_estimate) +
              " · ratio " +
              formatPercent(summaryData.high_volume.ratio, 2) +
              " / " +
              formatPercent(summaryData.high_volume.threshold, 2)
            ) : summary.loading ? (
              <KpiSubBar />
            ) : (
              "Reporting unavailable"
            )
          }
        />
      </Panel>

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
          <div className="relative">
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
              className="h-control w-64 rounded-card border border-control bg-raised pr-3 pl-8 text-sm text-ink placeholder:text-muted"
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="group" aria-label="Quick filters">
            {QUICK_FILTERS.map((option) => {
              const active = quick === option.key;
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setQuick(option.key)}
                  className={cn(
                    "relative py-1 text-sm transition-colors duration-120",
                    active ? "sig text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {option.label}
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
                  className="inline-flex h-8 items-center rounded-full border border-control bg-raised px-3 text-xs font-medium text-ink transition-colors duration-120 hover:bg-[#29282c]"
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
                now={referenceNow}
                height={gridHeight}
                onRowClick={(disputeId) => {
                  router.push("/disputes/" + encodeURIComponent(disputeId));
                }}
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

        <PanelBody className="row-rule flex flex-wrap items-center justify-between gap-2">
          <span className="num text-2xs text-muted">
            {meta
              ? "page " + meta.page + " / " + totalPages + " · " + meta.total + " cases · " + meta.per_page + " per page"
              : "page -"}
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
        </PanelBody>
      </Panel>
    </div>
  );
}
