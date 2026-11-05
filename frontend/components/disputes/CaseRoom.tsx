"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";

import { ActionRail } from "@/components/disputes/ActionRail";
import { CaseFactsPanel } from "@/components/disputes/CaseFactsPanel";
import { DossierPanel } from "@/components/disputes/DossierPanel";
import { EvWaterfall } from "@/components/disputes/EvWaterfall";
import { WinProbabilityPanel } from "@/components/disputes/WinProbabilityPanel";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatAbsolute,
  formatDueIn,
  formatLatency,
  formatPercent,
  formatUsd,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { ActionStatus, DisputeDetail } from "@/lib/types";
import {
  ACTION_META,
  CHANNEL_META,
  REASON_META,
  RECOMMENDATION_META,
  STAGE_META,
  STATUS_META,
  type Tone,
} from "@/lib/vocab";

const ACTION_STATUS_TONE: Record<ActionStatus, Tone> = {
  EXECUTED: "emerald",
  FAILED: "rose",
  SKIPPED: "amber",
};

function BackLink() {
  return (
    <Link
      href="/disputes"
      className="inline-flex items-center gap-1.5 text-[11.5px] text-muted transition-colors hover:text-ink"
    >
      <ChevronLeft size={13} aria-hidden />
      Triage queue
    </Link>
  );
}

function CaseSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading case">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-[84px] w-full" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Skeleton className="h-[260px] w-full" />
          <Skeleton className="h-[320px] w-full" />
          <Skeleton className="h-[380px] w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-[280px] w-full" />
          <Skeleton className="h-[320px] w-full" />
        </div>
      </div>
      <SkeletonLines lines={2} />
    </div>
  );
}

function DecisionPanel({ detail }: { detail: DisputeDetail }) {
  const meta = RECOMMENDATION_META[detail.recommended_action];
  return (
    <Panel>
      <PanelHeader
        kicker="Decision"
        title={`Recommendation · ${meta.label}`}
        description="First-match rule from the deterministic triage policy."
        actions={
          <Badge tone={meta.tone} size="sm" dot>
            {detail.recommended_action}
          </Badge>
        }
      />
      <PanelBody className="space-y-1.5">
        {detail.rationale.length === 0 ? (
          <p className="text-[11px] text-muted">No rationale was returned for this case.</p>
        ) : (
          <ul className="space-y-1.5">
            {detail.rationale.map((item) => (
              <li
                key={item.key}
                className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2"
              >
                <div className="text-[10.5px] font-medium text-ink">{item.label}</div>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">{item.detail}</p>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function ActionAuditPanel({ detail }: { detail: DisputeDetail }) {
  return (
    <Panel>
      <PanelHeader
        kicker="Audit log"
        title="Actions on this case"
        description="Every PayPal call is recorded with latency and outcome."
        actions={
          <Badge tone="neutral" mono>
            {detail.actions.length} records
          </Badge>
        }
      />
      <PanelBody>
        {detail.actions.length === 0 ? (
          <p className="text-[11px] text-muted">
            No action has been executed yet. The action rail is the only write path.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <caption className="sr-only">Dispute action audit log</caption>
              <thead>
                <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.12em] text-dim">
                  <th scope="col" className="px-2 py-1.5 font-medium">Action</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Status</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Latency</th>
                  <th scope="col" className="px-2 py-1.5 font-medium">Action id</th>
                  <th scope="col" className="px-2 py-1.5 text-right font-medium">Created</th>
                </tr>
              </thead>
              <tbody>
                {detail.actions.map((record) => (
                  <tr key={record.action_id} className="border-b border-hairline/60 last:border-b-0">
                    <td className="px-2 py-2 text-[10.5px] text-ink">
                      {ACTION_META[record.action].label}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={ACTION_STATUS_TONE[record.status]}>{record.status}</Badge>
                    </td>
                    <td className="num px-2 py-2 text-[10px] text-muted">
                      {formatLatency(record.latency_ms)}
                    </td>
                    <td className="num px-2 py-2 text-[10px] text-muted" title={record.action_id}>
                      {shortHash(record.action_id, 10, 4)}
                    </td>
                    <td className="num px-2 py-2 text-right text-[10px] text-muted">
                      {formatAbsolute(record.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.actions.some((record) => record.error) ? (
          <p className="mt-2 text-[10px] text-rose">
            {detail.actions.length} actions recorded · the most recent failure is in the audit
            payload.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** /disputes/[id] — the case room: EV waterfall, signals, facts, actions and dossier. */
export function CaseRoom({ caseId }: { caseId: string }) {
  const now = useNow(15000);
  const query = usePolledQuery(
    `case-room:${caseId}`,
    (signal) => api.getDispute(caseId, signal),
    { intervalMs: 2000 },
  );
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageError, setTriageError] = useState<ApiError | null>(null);
  const [triageNote, setTriageNote] = useState<string | null>(null);

  const refresh = query.refresh;
  const detail = query.data;

  const runTriage = useCallback(async () => {
    if (!detail || triageLoading) return;
    setTriageLoading(true);
    setTriageError(null);
    setTriageNote(null);
    try {
      const response = await api.triageDispute(detail.dispute_id);
      setTriageNote(`Recomputed · ${response.recommended_action}`);
      refresh();
    } catch (caught) {
      setTriageError(toApiError(caught));
    } finally {
      setTriageLoading(false);
    }
  }, [detail, refresh, triageLoading]);

  return (
    <div className="space-y-4">
      <BackLink />

      {query.error && !detail ? (
        <div className="space-y-3">
          <ErrorBanner
            error={query.error}
            context={`Case ${caseId} could not be loaded from the API.`}
            onRetry={refresh}
          />
          <Link
            href="/disputes"
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink"
          >
            <ChevronLeft size={13} aria-hidden />
            Back to the triage queue
          </Link>
        </div>
      ) : !detail ? (
        <CaseSkeleton />
      ) : (
        <>
          <div className="flex flex-col gap-4 border-b border-hairline pb-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="kicker">Case room</span>
                <Badge tone={STATUS_META[detail.status].tone} dot>
                  {STATUS_META[detail.status].short}
                </Badge>
                <Badge tone={STAGE_META[detail.stage].tone}>{STAGE_META[detail.stage].short}</Badge>
                <Badge tone={CHANNEL_META[detail.channel].tone} mono>
                  {CHANNEL_META[detail.channel].short}
                </Badge>
                <Badge tone={REASON_META[detail.reason_code].tone} title={REASON_META[detail.reason_code].label}>
                  {REASON_META[detail.reason_code].short}
                </Badge>
                {detail.subscription_suspended ? (
                  <Badge tone="emerald" dot>
                    SUBSCRIPTION SUSPENDED
                  </Badge>
                ) : null}
              </div>
              <h1 className="num mt-2 break-all text-[21px] font-medium tracking-[-0.02em] text-ink sm:text-[23px]">
                {detail.dispute_id}
              </h1>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
                <span title={detail.payer_id}>payer {detail.payer_id}</span>
                <span title={detail.order_id}>order {detail.order_id}</span>
                {detail.subscription_id ? (
                  <span title={detail.subscription_id}>sub {detail.subscription_id}</span>
                ) : (
                  <span className="text-dim">no subscription</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
              <div>
                <div className="kicker">Claim amount</div>
                <div className="num mt-1 text-[23px] font-medium tracking-[-0.02em] text-ink">
                  {formatUsd(detail.amount_usd)}
                </div>
              </div>
              <div>
                <div className="kicker">Seller response due</div>
                <div
                  className="num mt-1 text-[12px] text-ink"
                  title={formatAbsolute(detail.seller_response_due_date)}
                >
                  {now === null ? "—" : formatDueIn(detail.seller_response_due_date, now)}
                </div>
              </div>
              <div>
                <div className="kicker">p(win)</div>
                <div className="num mt-1 text-[12px] text-ink">{formatPercent(detail.p_win)}</div>
              </div>
              <div>
                <div className="kicker">Fight EV</div>
                <div className="num mt-1 text-[12px] text-rose">
                  {formatUsd(detail.ev_fight_usd)}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={triageLoading}
                icon={<RefreshCw size={12} aria-hidden />}
                onClick={() => {
                  void runTriage();
                }}
              >
                Recompute EV
              </Button>
            </div>
          </div>

          {query.error ? (
            <ErrorBanner
              error={query.error}
              context="Showing the last known case state while the API recovers."
              onRetry={refresh}
            />
          ) : null}
          {triageError ? (
            <ErrorBanner error={triageError} context="Triage recompute failed." />
          ) : null}
          {triageNote ? (
            <p className="font-mono text-[10px] text-emerald">{triageNote}</p>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="space-y-4">
              <EvWaterfall detail={detail} />
              <WinProbabilityPanel probability={detail.win_probability} />
              <CaseFactsPanel facts={detail.facts} />
              <ActionAuditPanel detail={detail} />
            </div>
            <div className={cn("space-y-4")}>
              <DecisionPanel detail={detail} />
              <ActionRail detail={detail} onCompleted={refresh} />
              <DossierPanel caseId={detail.dispute_id} available={detail.dossier_available} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}