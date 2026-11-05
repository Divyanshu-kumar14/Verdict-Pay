"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useState } from "react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api } from "@/lib/api";
import { formatPercent, formatUsd } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeSummary } from "@/lib/types";

const PER_PAGE = 25;
const GRID_HEIGHT = 560;

function KpiSkeletons() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-[82px] w-full" />
      ))}
    </>
  );
}

/** /disputes — the triage queue, priced and sorted by deadline. */
export function DisputesWorkspace() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState("");
  const now = useNow(15000);

  const query = usePolledQuery(
    `disputes:${page}`,
    (signal) => api.listDisputes({ page, perPage: PER_PAGE }, signal),
    { intervalMs: 2000 },
  );
  const summary = usePolledQuery("reporting:disputes-summary", (signal) => api.reportingSummary(signal), {
    intervalMs: 10000,
  });

  const rows: DisputeSummary[] = query.data?.data ?? [];
  const meta = query.data?.meta ?? null;
  const highVolume = summary.data?.high_volume ?? null;
  const totalPages = meta?.total_pages && meta.total_pages > 0 ? meta.total_pages : 1;

  return (
    <div className="space-y-5">
      <PageHeader
        kicker="Triage queue · Aurora Analytics"
        title="Dispute exposure"
        description="Every case is priced by the deterministic EV engine. Sort or filter any column; click a row to open the case room, or use Open for keyboard navigation."
        meta={
          <>
            <PageMeta label="Cases" value={meta ? meta.total : "—"} />
            <PageMeta label="Per page" value={PER_PAGE} />
            <PageMeta label="Refresh" value="2s while visible" />
          </>
        }
        actions={
          highVolume ? (
            <Badge tone={highVolume.flag ? "rose" : "emerald"} dot>
              {highVolume.flag ? "High-volume merchant" : "Standard fee tier"} · ratio{" "}
              {formatPercent(highVolume.ratio, 2)} / {formatPercent(highVolume.threshold, 2)}
            </Badge>
          ) : null
        }
      />

      <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
        {summary.loading ? (
          <KpiSkeletons />
        ) : (
          <>
            <StatTile
              label="Open exposure"
              value={summary.data ? formatUsd(summary.data.total_exposure_usd) : "—"}
              sub={
                summary.data
                  ? `${summary.data.open_cases} open · ${summary.data.in_inquiry} inquiry / ${summary.data.in_claim} claim`
                  : "Reporting unavailable"
              }
            />
            <StatTile
              label="Protected"
              value={summary.data ? formatUsd(summary.data.protected_usd) : "—"}
              sub={
                summary.data
                  ? `${summary.data.chain_verified_customers} chain-verified customers`
                  : "Reporting unavailable"
              }
              tone="emerald"
            />
            <StatTile
              label="Fees avoided"
              value={summary.data ? formatUsd(summary.data.fees_avoided_usd) : "—"}
              sub={
                summary.data
                  ? `${summary.data.subscription_suspensions} subscriptions suspended`
                  : "Reporting unavailable"
              }
              tone="emerald"
            />
            <StatTile
              label="Avg p(win)"
              value={summary.data ? formatPercent(summary.data.avg_p_win) : "—"}
              sub={
                summary.data
                  ? `Win-rate estimate ${formatPercent(summary.data.win_rate_estimate)}`
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
          context="Exposure KPIs could not be refreshed."
          onRetry={summary.refresh}
        />
      ) : null}

      <Panel className="overflow-hidden">
        <PanelHeader
          kicker="Triage queue"
          title={meta ? `${meta.total} cases · page ${meta.page} of ${totalPages}` : "Loading cases"}
          description="Default sort: seller response due date, soonest first."
          actions={
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-dim">
              <span
                aria-hidden
                className={
                  query.data
                    ? "h-1.5 w-1.5 rounded-full bg-emerald live-dot"
                    : "h-1.5 w-1.5 rounded-full bg-white/25"
                }
              />
              {query.data ? "polling 2s" : "connecting"}
            </span>
          }
        />

        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3 py-2.5">
          <div className="relative">
            <Search
              size={12}
              aria-hidden
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim"
            />
            <input
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter id, payer, reason, stage…"
              aria-label="Filter dispute cases"
              className="h-8 w-56 rounded-md border border-border-strong bg-chrome pl-8 pr-2.5 text-[11.5px] text-ink placeholder:text-dim"
            />
          </div>
          <span className="hidden text-[10px] text-dim sm:inline">
            Column filters and sorting are available in every header.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Badge tone="neutral" mono>
              {rows.length} rows
            </Badge>
            <Button
              variant="secondary"
              size="sm"
              onClick={query.refresh}
              loading={query.refreshing}
            >
              Refresh
            </Button>
          </div>
        </div>

        <div className="border-b border-hairline">
          {query.error && !query.data ? (
            <div className="p-3">
              <ErrorBanner
                error={query.error}
                context="The triage queue could not be loaded."
                onRetry={query.refresh}
              />
            </div>
          ) : query.loading ? (
            <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading disputes">
              <Skeleton className="h-8 w-full" />
              {Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No disputes in the queue"
                description="The merchant has no open PayPal disputes. Run the three-button sandbox flow to open one through the real webhook path."
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
            <div className="overflow-hidden" style={{ height: GRID_HEIGHT }}>
              <DisputesGridLoader
                rows={rows}
                now={now ?? Date.now()}
                height={GRID_HEIGHT}
                onRowClick={(disputeId) => {
                  router.push(`/disputes/${encodeURIComponent(disputeId)}`);
                }}
              />
            </div>
          )}
        </div>

        {query.error && query.data ? (
          <div className="p-3">
            <ErrorBanner
              error={query.error}
              context="Showing the last successful queue page while the API recovers."
              onRetry={query.refresh}
            />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
          <span className="font-mono text-[10px] text-dim">
            {meta
              ? `page ${meta.page} / ${totalPages} · ${meta.total} cases · ${meta.per_page} per page`
              : "page —"}
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              icon={<ChevronLeft size={12} aria-hidden />}
            >
              Prev
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              trailingIcon={<ChevronRight size={12} aria-hidden />}
            >
              Next
            </Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}