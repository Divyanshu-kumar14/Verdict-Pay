"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { MotionConfig } from "motion/react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { DisputesGridLoader } from "@/components/disputes/DisputesGridLoader";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { NumberTicker } from "@/components/premium/NumberTicker";
import { Reveal, Stagger, StaggerItem } from "@/components/premium/Reveal";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatPercent, isoToMs } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeSummary } from "@/lib/types";

const PER_PAGE = 25;
const GRID_HEIGHT = 560;
const DAY_MS = 86_400_000;

type QuickFilter = "all" | "due72" | "overdue" | "chargeback" | "nodossier";

const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "due72", label: "Due < 72h" },
  { key: "overdue", label: "Overdue" },
  { key: "chargeback", label: "Chargeback" },
  { key: "nodossier", label: "No dossier" },
];

function KpiSkeletons() {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton key={index} className="h-[104px] w-full" />
      ))}
    </>
  );
}

function KpiTile({
  label,
  children,
  sub,
}: {
  label: string;
  children: ReactNode;
  sub: ReactNode;
}) {
  return (
    <SpotlightCard className="px-4 py-3.5">
      <FieldLabel>{label}</FieldLabel>
      <div className="num mt-2 text-[26px] font-medium leading-none tracking-[-0.02em] text-ink">
        {children}
      </div>
      <div className="mt-2 text-[11px] leading-snug text-muted">{sub}</div>
    </SpotlightCard>
  );
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

/** /disputes — the triage queue, priced and sorted by deadline. */
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

  return (
    <MotionConfig reducedMotion="user">
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

        <Reveal>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4" aria-label="Exposure indicators">
            {summary.loading ? (
              <KpiSkeletons />
            ) : summary.data ? (
              <Stagger className="contents" step={0.06}>
                <StaggerItem className="contents">
                  <KpiTile
                    label="Open exposure"
                    sub={
                      <span>
                        {summary.data.open_cases} open · {summary.data.in_inquiry} inquiry /{" "}
                        {summary.data.in_claim} claim
                      </span>
                    }
                  >
                    <NumberTicker value={summary.data.total_exposure_usd} decimals={2} prefix="$" />
                  </KpiTile>
                </StaggerItem>
                <StaggerItem className="contents">
                  <KpiTile
                    label="Protected"
                    sub={<span>{summary.data.chain_verified_customers} chain-verified customers</span>}
                  >
                    <NumberTicker value={summary.data.protected_usd} decimals={2} prefix="$" />
                  </KpiTile>
                </StaggerItem>
                <StaggerItem className="contents">
                  <KpiTile
                    label="Fees avoided"
                    sub={<span>{summary.data.subscription_suspensions} subscriptions suspended</span>}
                  >
                    <NumberTicker value={summary.data.fees_avoided_usd} decimals={2} prefix="$" />
                  </KpiTile>
                </StaggerItem>
                <StaggerItem className="contents">
                  <KpiTile
                    label="Dispute ratio vs threshold"
                    sub={
                      <span>
                        win-rate estimate {formatPercent(summary.data.win_rate_estimate)} · avg p(win){" "}
                        {formatPercent(summary.data.avg_p_win)}
                      </span>
                    }
                  >
                    <NumberTicker
                      value={summary.data.high_volume.ratio * 100}
                      decimals={2}
                      suffix="%"
                    />
                  </KpiTile>
                </StaggerItem>
              </Stagger>
            ) : (
              <>
                <KpiTile label="Open exposure" sub={<span>Reporting unavailable</span>}>
                  —
                </KpiTile>
                <KpiTile label="Protected" sub={<span>Reporting unavailable</span>}>
                  —
                </KpiTile>
                <KpiTile label="Fees avoided" sub={<span>Reporting unavailable</span>}>
                  —
                </KpiTile>
                <KpiTile label="Dispute ratio" sub={<span>Reporting unavailable</span>}>
                  —
                </KpiTile>
              </>
            )}
          </div>
        </Reveal>

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
            title={meta ? meta.total + " cases · page " + String(meta.page) + " of " + String(totalPages) : "Loading cases"}
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
          <div aria-hidden className="rule-instrument h-px w-full" />

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
                      "h-7 rounded-full border px-2.5 font-mono text-[10px] transition-colors",
                      active
                        ? "border-ice/40 bg-ice/10 text-ice"
                        : "border-hairline bg-white/[0.02] text-muted hover:border-white/20 hover:text-ink",
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="num font-mono text-[10px] text-dim" aria-live="polite">
                {visible.length} of {rows.length} rows
                {activeFilterCount > 0 ? " · filtered" : ""}
              </span>
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
                <div className="rounded-lg border border-hairline bg-sunken px-6 py-8">
                  <FieldLabel rule tone="ice">
                    Queue empty · instrument idle
                  </FieldLabel>
                  <EmptyState
                    className="border-0 bg-transparent py-6"
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
                  <p className="text-center font-mono text-[9.5px] text-dim">
                    GET /api/v1/disputes · page 1 · per_page {PER_PAGE}
                  </p>
                </div>
              </div>
            ) : visible.length === 0 ? (
              <div className="p-4">
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
              </div>
            ) : (
              <div className="overflow-hidden" style={{ height: GRID_HEIGHT }}>
                <DisputesGridLoader
                  rows={visible}
                  now={referenceNow}
                  height={GRID_HEIGHT}
                  onRowClick={(disputeId) => {
                    router.push("/disputes/" + encodeURIComponent(disputeId));
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

          <PanelBody className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-3 py-2.5">
            <span className="num font-mono text-[10px] text-dim">
              {meta
                ? "page " + String(meta.page) + " / " + String(totalPages) + " · " + String(meta.total) + " cases · " + String(meta.per_page) + " per page"
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
          </PanelBody>
        </Panel>
      </div>
    </MotionConfig>
  );
}
