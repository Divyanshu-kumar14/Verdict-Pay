"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  ChevronLeft,
  Eye,
  Flag,
  MessageSquare,
  RefreshCw,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from "lucide-react";

import { ActionRail, ACTION_STATUS_META } from "@/components/disputes/ActionRail";
import { CaseFactsPanel } from "@/components/disputes/CaseFactsPanel";
import { DossierPanel } from "@/components/disputes/DossierPanel";
import { EvWaterfall } from "@/components/disputes/EvWaterfall";
import { WinProbabilityPanel } from "@/components/disputes/WinProbabilityPanel";
import { PageHeader, PageMeta } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { PageTransition } from "@/components/ui/PageTransition";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatAbsolute,
  formatDueIn,
  formatLatency,
  formatPercent,
  formatUsd,
  isoToMs,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeDetail, RecommendedAction } from "@/lib/types";
import {
  ACTION_META,
  CHANNEL_META,
  REASON_META,
  RECOMMENDATION_META,
  STAGE_META,
  STATUS_META,
  TONE_BADGE,
} from "@/lib/vocab";

const RECOMMENDATION_ICON: Record<RecommendedAction, LucideIcon> = {
  DEFLECT_INQUIRY: MessageSquare,
  MAKE_OFFER: Tag,
  ACCEPT_CLAIM: Flag,
  PROVIDE_EVIDENCE: ShieldCheck,
  MONITOR: Eye,
};

function BackLink() {
  return (
    <Link
      href="/disputes"
      className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-120 hover:text-ink"
    >
      <ChevronLeft size={14} aria-hidden />
      Triage queue
    </Link>
  );
}

/** The recommendation and seller deadline sit at the very top of the room, always visible. */
function DecisionBanner({ detail, now }: { detail: DisputeDetail; now: number | null }) {
  const recommendation = RECOMMENDATION_META[detail.recommended_action];
  const Icon = RECOMMENDATION_ICON[detail.recommended_action];
  const dueMs = isoToMs(detail.seller_response_due_date);
  const overdue = now !== null && dueMs !== null && dueMs < now;

  return (
    <Panel className="panel-raised">
      <div className="flex flex-col gap-4 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3.5">
          <span
            aria-hidden
            className={cn(
              "grid h-11 w-11 shrink-0 place-items-center rounded-full",
              TONE_BADGE[recommendation.tone],
            )}
          >
            <Icon size={18} strokeWidth={1.7} />
          </span>
          <div className="min-w-0">
            <p className="label">Recommended response</p>
            <p className="title-card mt-0.5">{recommendation.label}</p>
            <p className="mt-0.5 truncate text-sm text-muted">
              {REASON_META[detail.reason_code].short} · {STAGE_META[detail.stage].short} ·{" "}
              {STATUS_META[detail.status].short}
            </p>
          </div>
        </div>

        <div className="min-w-[9rem] text-left sm:text-right">
          <p className="label">Seller response due</p>
          <p
            className={cn(
              "num mt-1 text-lg font-semibold",
              overdue ? "text-negative" : "text-ink",
            )}
          >
            {now === null ? "--" : formatDueIn(detail.seller_response_due_date, now)}
          </p>
          <p className="num text-2xs text-muted">{formatAbsolute(detail.seller_response_due_date)}</p>
        </div>
      </div>
    </Panel>
  );
}

function CaseSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading case">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-8">
          <Skeleton className="h-10 w-24" />
          <Skeleton className="h-10 w-24" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="space-y-6">
          <Skeleton className="h-[300px] w-full" />
          <Skeleton className="h-[300px] w-full" />
          <SkeletonLines lines={2} />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-[260px] w-full" />
          <Skeleton className="h-[280px] w-full" />
        </div>
      </div>
    </div>
  );
}

/** The chain path is drawn by hand: a rail of slots, hairline rules and dots. */
function CustodyPath({ detail }: { detail: DisputeDetail }) {
  const nodes = [
    { caption: "Ledger", value: shortHash(detail.facts.chain_head, 8, 4) },
    { caption: "Case", value: shortHash(detail.dispute_id, 8, 4) },
    { caption: "PayPal", value: "Resolution centre" },
  ];
  return (
    <ol className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2" aria-label="Chain of custody">
      {nodes.map((node, index) => (
        <li key={node.caption} className="flex min-w-0 items-center gap-3">
          {index > 0 ? <span aria-hidden className="h-px w-6 shrink-0 bg-rule" /> : null}
          <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" />
          <span className="min-w-0">
            <span className="label block">{node.caption}</span>
            <span
              className="num block max-w-[16rem] truncate text-sm text-ink"
              title={node.value}
            >
              {node.value}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The verdict carries the page: its action is the h1, its rule sits directly under it. */
function VerdictPanel({ detail }: { detail: DisputeDetail }) {
  const meta = RECOMMENDATION_META[detail.recommended_action];
  const paypalAction = meta.action;
  const fee = paypalAction
    ? (detail.allowed_actions.find((candidate) => candidate.action === paypalAction)?.fee_usd ?? 0)
    : 0;
  const cheapest = Math.max(detail.ev_fight_usd, detail.ev_settle_usd, detail.ev_offer_usd);

  return (
    <Panel>
      <PanelHeader
        title="Verdict"
        description="Read from the deterministic triage policy, never from a language model. The action rail executes exactly this action."
        actions={
          <Badge tone={meta.tone} dot>
            {meta.label}
          </Badge>
        }
      />
      <PanelBody className="pt-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_META[detail.status].tone} dot>
            {STATUS_META[detail.status].short}
          </Badge>
          <Badge tone={STAGE_META[detail.stage].tone}>{STAGE_META[detail.stage].label}</Badge>
          <Badge tone={CHANNEL_META[detail.channel].tone}>{CHANNEL_META[detail.channel].label}</Badge>
          <Badge tone={REASON_META[detail.reason_code].tone}>
            {REASON_META[detail.reason_code].label}
          </Badge>
          {detail.subscription_suspended ? (
            <Badge tone="negative" dot>
              Subscription suspended
            </Badge>
          ) : null}
        </div>

        <dl className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="label">Payer</dt>
            <dd className="num mt-1 truncate text-sm text-ink" title={detail.payer_id}>
              {detail.payer_id}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Order</dt>
            <dd className="num mt-1 truncate text-sm text-ink" title={detail.order_id}>
              {detail.order_id}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="label">Subscription</dt>
            <dd className="num mt-1 truncate text-sm text-ink">
              {detail.subscription_id ?? "None on this order"}
            </dd>
          </div>
        </dl>

        <CustodyPath detail={detail} />

        <h3 className="label mt-5">Why this verdict</h3>
        {detail.rationale.length > 0 ? (
          <ol className="row-rule mt-2" aria-label="Verdict rationale">
            {detail.rationale.map((item, index) => (
              <li
                key={item.key}
                className="row-rule flex gap-3 py-2.5 first:border-t-0 first:pt-2.5"
              >
                <span aria-hidden className="num w-4 shrink-0 text-xs text-muted">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-ink">{item.label}</p>
                  <p className="mt-0.5 text-sm leading-snug break-words text-muted">
                    {item.detail}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-muted">No rationale was returned for this case.</p>
        )}
      </PanelBody>
      <PanelFooter>
        <p className="text-sm text-muted">
          Cheapest path <span className="num text-ink">{formatUsd(cheapest)}</span>, PayPal fee{" "}
          <span className="num text-ink">{formatUsd(fee)}</span>, claim{" "}
          <span className="num text-ink">{formatUsd(detail.amount_usd)}</span>.
        </p>
      </PanelFooter>
    </Panel>
  );
}

function ActionAuditPanel({ detail }: { detail: DisputeDetail }) {
  return (
    <Panel aria-label="Actions on this case">
      <PanelHeader
        title="Actions on this case"
        description="Every PayPal call this case has made, with its latency and outcome."
        actions={<Badge tone="neutral">{detail.actions.length} records</Badge>}
      />
      <PanelBody className="pt-0">
        {detail.actions.length === 0 ? (
          <p className="text-sm text-muted">
            No action has been executed yet. The action rail is the only write path.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <caption className="sr-only">Dispute action audit log</caption>
              <thead>
                <tr className="border-b border-rule text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Action
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Latency
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Action id
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {detail.actions.map((record) => (
                  <tr key={record.action_id} className="row-rule">
                    <td className="py-2.5 pr-3 text-sm text-ink">
                      {ACTION_META[record.action].label}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge tone={ACTION_STATUS_META[record.status].tone}>
                        {ACTION_STATUS_META[record.status].word}
                      </Badge>
                    </td>
                    <td className="num py-2.5 pr-3 text-sm text-muted">
                      {formatLatency(record.latency_ms)}
                    </td>
                    <td
                      className="num py-2.5 pr-3 text-sm text-muted"
                      title={record.action_id}
                    >
                      {shortHash(record.action_id, 10, 4)}
                    </td>
                    <td className="num py-2.5 text-right text-sm text-muted">
                      {formatAbsolute(record.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.actions.some((record) => record.error) ? (
          <p className="row-rule mt-3 pt-2.5 text-sm text-muted">
            The most recent failure is recorded in the audit payload for this case.
          </p>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

/** /disputes/[id]: the case room, verdict, evidence, model readouts and dossier. */
export function CaseRoom({ caseId }: { caseId: string }) {
  const now = useNow(15000);
  const query = usePolledQuery(
    "case-room:" + caseId,
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
      setTriageNote("Recomputed. Recommended action: " + RECOMMENDATION_META[response.recommended_action].label + ".");
      refresh();
    } catch (caught) {
      setTriageError(toApiError(caught));
    } finally {
      setTriageLoading(false);
    }
  }, [detail, refresh, triageLoading]);

  if (query.error && !detail) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader
          title="Case room"
          description={"Case " + caseId + " could not be loaded."}
        />
        <div className="space-y-3">
          <ErrorBanner
            error={query.error}
            context={"Case " + caseId + " could not be loaded from the API."}
            onRetry={refresh}
          />
          <Link
            href="/disputes"
            className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors duration-120 hover:text-ink"
          >
            <ChevronLeft size={14} aria-hidden />
            Back to the triage queue
          </Link>
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="space-y-6">
        <BackLink />
        <PageHeader
          title="Case room"
          description="Loading the verdict, evidence chain and model readouts."
        />
        <CaseSkeleton />
      </div>
    );
  }

  const verdict = RECOMMENDATION_META[detail.recommended_action];

  return (
    <PageTransition className="space-y-6">
      <BackLink />

      <PageHeader
        title={verdict.verb}
        description={
          "Dispute " +
          detail.dispute_id +
          ", " +
          REASON_META[detail.reason_code].label.toLowerCase() +
          " at " +
          STAGE_META[detail.stage].label.toLowerCase() +
          " stage. The deterministic triage policy returns this response."
        }
        meta={
          <>
            <PageMeta label="Claim" value={formatUsd(detail.amount_usd)} />
            <PageMeta label="p(win)" value={formatPercent(detail.p_win)} />
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={triageLoading}
            icon={<RefreshCw size={13} aria-hidden />}
            onClick={() => {
              void runTriage();
            }}
          >
            Recompute EV
          </Button>
        }
      />

      <DecisionBanner detail={detail} now={now} />

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
      {triageNote ? <p className="text-sm text-positive">{triageNote}</p> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="min-w-0 space-y-6">
          <VerdictPanel detail={detail} />
          <EvWaterfall detail={detail} />
          <CaseFactsPanel facts={detail.facts} />
          <ActionAuditPanel detail={detail} />
        </div>
        <div className="min-w-0 space-y-6">
          <ActionRail detail={detail} onCompleted={refresh} />
          <WinProbabilityPanel probability={detail.win_probability} />
          <DossierPanel caseId={detail.dispute_id} available={detail.dossier_available} />
        </div>
      </div>
    </PageTransition>
  );
}
