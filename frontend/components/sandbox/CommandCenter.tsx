"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  Link2,
  RefreshCw,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { CustodyChain } from "@/components/sandbox/CustodyChain";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import { StatTile } from "@/components/ui/StatTile";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { describeContainment, parseContainment } from "@/lib/containment";
import { bestEvPath, fightEvNote, offerEvNote, settleEvNote } from "@/lib/ev";
import {
  formatClock,
  formatDelta,
  formatDueIn,
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd,
  humaniseAction,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import type { PolledQuery } from "@/lib/hooks/usePolledQuery";
import { SPRING, stagger, staggerItem } from "@/lib/motion";
import type {
  ActionResponse,
  CustomerTimeline,
  DisputeAction,
  DisputeDetail,
  DisputeSimulationResponse,
  TelemetryEventOut,
} from "@/lib/types";
import {
  ACTION_META,
  CHANNEL_META,
  EVENT_META,
  REASON_META,
  RECOMMENDATION_META,
  STAGE_META,
  STATUS_META,
} from "@/lib/vocab";

function EvComparison({
  breakdown,
  stage,
  bestKey,
  maxAbs,
}: {
  breakdown: DisputeDetail["breakdown"];
  stage: DisputeDetail["stage"];
  bestKey: "fight" | "settle" | "offer" | null;
  maxAbs: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const columns = [
    {
      key: "fight" as const,
      label: "Fight",
      value: breakdown.ev_fight_usd,
      note: fightEvNote(breakdown),
    },
    {
      key: "settle" as const,
      label: "Settle",
      value: breakdown.ev_settle_usd,
      note: settleEvNote(breakdown, stage),
    },
    {
      key: "offer" as const,
      label: "Offer",
      value: breakdown.ev_offer_usd,
      note: offerEvNote(breakdown),
    },
  ];

  return (
    <div className="grid border-t border-rule sm:grid-cols-3">
      {columns.map((col) => {
        const best = bestKey === col.key;
        const positive = col.value >= 0;
        const fraction = maxAbs > 0 ? Math.abs(col.value) / maxAbs : 0;
        return (
          <div
            key={col.key}
            className={cn(
              "relative flex flex-col border-t border-rule px-4 py-3.5 first:border-t-0 sm:border-t-0 sm:border-l sm:first:border-l-0",
              best && "sm:rounded-card sm:ring-1 sm:ring-inset sm:ring-accent/40",
            )}
          >
            {best ? (
              <span aria-hidden className="absolute inset-x-3 top-0 h-px bg-accent" />
            ) : null}
            <div className="flex items-center justify-between gap-2">
              <span className={cn("label", best && "sig")}>
                {col.label}
                {best ? <span className="sr-only"> (best expected value)</span> : null}
              </span>
              {best ? (
                <Badge tone="accent" size="sm">
                  Best
                </Badge>
              ) : null}
            </div>
            <p
              className={cn(
                "num mt-2 text-lg font-semibold",
                positive ? "text-ink" : "text-negative",
              )}
            >
              {formatUsd(col.value)}
            </p>
            <div
              role="img"
              aria-label={
                col.label +
                " expected value " +
                formatUsd(col.value) +
                ", magnitude " +
                formatPercent(fraction, 0) +
                " of the largest outcome"
              }
              className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-rule"
            >
              <motion.span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full",
                  positive ? "bg-positive" : "bg-negative",
                )}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: fraction }}
                transition={reduced ? { duration: 0 } : SPRING}
                style={{ transformOrigin: "left" }}
              />
            </div>
            <p className="mt-2.5 text-sm leading-relaxed text-muted">{col.note}</p>
          </div>
        );
      })}
    </div>
  );
}

function VerdictCard({
  detail,
  allowedAction,
  primaryAction,
  canAct,
  acting,
  blockedReason,
  actionResult,
  actionError,
  onExecute,
}: {
  detail: DisputeDetail;
  allowedAction: { allowed: boolean; reason: string | null; fee_usd: number } | undefined;
  primaryAction: DisputeAction | null;
  canAct: boolean;
  acting: boolean;
  blockedReason: string | null;
  actionResult: ActionResponse | null;
  actionError: ApiError | null;
  onExecute: () => void;
}) {
  const recMeta = RECOMMENDATION_META[detail.recommended_action];
  const status = STATUS_META[detail.status];
  const evRule = RECOMMENDATION_META[detail.breakdown.best_action];
  const winProbability = detail.win_probability;

  const actionSentence = primaryAction
    ? ACTION_META[primaryAction].description +
      " " +
      (allowedAction ? "PayPal fee " + formatUsd(allowedAction.fee_usd) + "." : "")
    : blockedReason;

  return (
    <Panel className="panel-raised relative overflow-hidden">
      <span aria-hidden className="sig-edge absolute inset-y-0 left-0" />

      <div className="px-4 py-4 sm:px-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="title-section">Live verdict</h2>
          <Badge tone={status.tone} dot>
            {status.short}
          </Badge>
        </div>

        <p className="mt-3 text-xl font-semibold text-ink">{recMeta.label}</p>
        <p className="mt-1.5 text-sm text-muted">EV rule picks {evRule.label}.</p>
        <p className="mt-2 max-w-[62ch] text-base leading-relaxed text-muted">
          {actionSentence}
        </p>
        {primaryAction && blockedReason ? (
          <p className="mt-2 max-w-[62ch] text-sm leading-relaxed text-warning">
            {blockedReason}
          </p>
        ) : null}

        {detail.rationale.length > 0 ? (
          <ul className="mt-3 max-w-[62ch] space-y-1.5">
            {detail.rationale.map((item) => (
              <li key={item.key} className="text-sm leading-relaxed break-words text-muted">
                <span className="text-ink">{item.label}.</span> {item.detail}
              </li>
            ))}
          </ul>
        ) : null}

        {primaryAction ? (
          <div className="mt-4 max-w-xs">
            <Button
              variant="primary"
              size="lg"
              block
              loading={acting}
              disabled={!canAct}
              onClick={onExecute}
              trailingIcon={<ArrowRight size={14} aria-hidden />}
            >
              {recMeta.verb}
            </Button>
          </div>
        ) : null}

        {actionError ? (
          <div className="mt-3">
            <ErrorBanner
              error={actionError}
              context="The PayPal action did not complete. The case was not changed optimistically."
            />
          </div>
        ) : null}

        {actionResult ? (
          <div
            role="status"
            className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-raised px-3 py-2 text-sm"
          >
            <span className="flex items-center gap-1.5">
              <CircleCheck size={14} aria-hidden className="text-muted" />
              <span className="text-ink">{humaniseAction(actionResult.status)}</span>
            </span>
            <span className="text-muted">{ACTION_META[actionResult.action].label}</span>
            <span className="num text-sm text-muted">{formatLatency(actionResult.latency_ms)}</span>
            <span className="num text-sm text-muted" title={actionResult.action_id}>
              {shortHash(actionResult.action_id, 10, 4)}
            </span>
          </div>
        ) : null}

        <div className="row-rule mt-5 pt-4">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <StatTile
              label="Win probability"
              tone="accent"
              countValue={detail.p_win}
              countFormat={formatPercent}
              className="px-0 py-0"
            />
            <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <div>
                <dt className="label">Completeness</dt>
                <dd className="num mt-0.5 text-ink">
                  {formatPercent(detail.telemetry_completeness, 0)}
                </dd>
              </div>
              <div>
                <dt className="label">Reason multiplier</dt>
                <dd className="num mt-0.5 text-ink">
                  {winProbability.reason_multiplier.toFixed(2)}x
                </dd>
              </div>
              <div>
                <dt className="label">Base</dt>
                <dd className="num mt-0.5 text-ink">{winProbability.base.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="label">Signal sum</dt>
                <dd className="num mt-0.5 text-ink">
                  {formatDelta(winProbability.signal_sum)}
                </dd>
              </div>
            </dl>
          </div>
          <ProgressBar
            value={detail.p_win}
            tone="neutral"
            label={"Win probability " + formatPercent(detail.p_win)}
            className="mt-3"
          />
        </div>
      </div>
    </Panel>
  );
}

function CaseSummary({ detail, now }: { detail: DisputeDetail; now: number | null }) {
  const reason = REASON_META[detail.reason_code];
  const stage = STAGE_META[detail.stage];
  const channel = CHANNEL_META[detail.channel];
  const status = STATUS_META[detail.status];

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4 px-4 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="title-section">Live case facts</h2>
            <Badge tone={status.tone} dot>
              {status.short}
            </Badge>
          </div>
          <p className="num mt-2 text-base text-ink" title={detail.dispute_id}>
            {shortHash(detail.dispute_id, 14, 4)}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={reason.tone} title={reason.label}>
              {reason.short}
            </Badge>
            <Badge tone={stage.tone} title={stage.label}>
              {stage.short}
            </Badge>
            <Badge tone={channel.tone} title={channel.label}>
              {channel.short}
            </Badge>
          </div>
          <dl className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <div className="flex gap-1.5">
              <dt className="text-muted">Payer</dt>
              <dd className="num text-ink" title={detail.payer_id}>
                {shortHash(detail.payer_id, 8, 4)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Order</dt>
              <dd className="num text-ink" title={detail.order_id}>
                {shortHash(detail.order_id, 8, 4)}
              </dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-muted">Sub</dt>
              {detail.subscription_id ? (
                <dd className="num text-ink" title={detail.subscription_id}>
                  {shortHash(detail.subscription_id, 8, 4)}
                </dd>
              ) : (
                <dd className="text-muted">None on file</dd>
              )}
            </div>
          </dl>
        </div>
        <div className="text-right">
          <StatTile
            label="Claim amount"
            tone="neutral"
            countValue={detail.amount_usd}
            countFormat={formatUsd}
            className="px-0 py-0"
            sub={
              now === null
                ? "Deadline unknown"
                : formatDueIn(detail.seller_response_due_date, now)
            }
          />
        </div>
      </div>
    </Panel>
  );
}

function TelemetryLedger({
  events,
  chainValid,
  chainHead,
  loading,
  error,
}: {
  events: TelemetryEventOut[];
  chainValid: boolean;
  chainHead: string | null;
  loading: boolean;
  error: ApiError | null;
}) {
  return (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
        <h2 className="title-section">Telemetry ledger</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="num text-sm text-muted">
            {events.length} events, append-only
            {events.length > 8 ? ", showing newest 8" : ""}
          </span>
          {chainHead ? (
            <span className="num text-sm text-muted" title={chainHead}>
              head {shortHash(chainHead, 8, 6)}
            </span>
          ) : null}
          <Badge tone={chainValid ? "positive" : "negative"} dot>
            {chainValid ? "Chain verified" : "Chain unverified"}
          </Badge>
        </div>
      </div>

      <div className="row-rule overflow-hidden">
        <div className="max-h-[280px] overflow-x-auto overflow-y-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Hash-chained telemetry events for the disputed payer
            </caption>
            <thead className="sticky top-0 z-sticky bg-surface">
              <tr className="border-b border-rule">
                <th scope="col" className="label px-4 py-2 font-medium">
                  Seq
                </th>
                <th scope="col" className="label px-3 py-2 font-medium">
                  Event
                </th>
                <th scope="col" className="label px-3 py-2 font-medium">
                  Chain hash
                </th>
                <th scope="col" className="label px-3 py-2 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="label px-4 py-2 text-right font-medium">
                  UTC
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-2.5">
                    <Skeleton className="h-9 w-full" />
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-sm text-muted">
                    No telemetry events on file yet. Run step 2 to append four signed events.
                  </td>
                </tr>
              ) : (
                events.slice(0, 8).map((event) => (
                  <tr key={event.id} className="border-b border-rule last:border-b-0">
                    <td className="num px-4 py-2.5 text-sm text-muted">{event.sequence}</td>
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2 text-sm text-ink">
                        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-positive" />
                        {EVENT_META[event.event_type].label}
                      </span>
                    </td>
                    <td className="num px-3 py-2.5 text-sm text-muted" title={event.chain_hash}>
                      {shortHash(event.chain_hash, 8, 5)}
                    </td>
                    <td className="num px-3 py-2.5 text-right text-sm text-muted">
                      {event.units_consumed > 0 ? formatInteger(event.units_consumed) : "-"}
                    </td>
                    <td className="num px-4 py-2.5 text-right text-sm text-muted">
                      {formatClock(Date.parse(event.created_at))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="row-rule flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm text-muted">
        <span className="flex items-center gap-1.5">
          <Link2 size={12} aria-hidden /> SHA-256 per payer stream
        </span>
        <span className="num">
          {chainHead ? "Sealed at " + shortHash(chainHead, 8, 6) : "No chain head yet"}
        </span>
      </div>
      {error ? (
        <p className="row-rule px-4 py-2.5 text-sm text-negative" title={error.message}>
          Ledger refresh failed. {error.code}
        </p>
      ) : null}
    </Panel>
  );
}

export type CommandCenterProps = {
  activeDisputeId: string | null;
  restoredFromQueue: boolean;
  flowDispute: DisputeSimulationResponse | null;
  fallbackEvents: TelemetryEventOut[] | null;
  caseQuery: PolledQuery<DisputeDetail>;
  timeline: PolledQuery<CustomerTimeline>;
  onCaseChanged: () => void;
};

/**
 * The merchant side of the demo: verdict first, then EV, custody, containment
 * and case facts, with the single PayPal action the recommendation calls for.
 */
export function CommandCenter({
  activeDisputeId,
  restoredFromQueue,
  flowDispute,
  fallbackEvents,
  caseQuery,
  timeline,
  onCaseChanged,
}: CommandCenterProps) {
  const now = useNow();
  const reduced = useReducedMotion() ?? false;
  const detail = caseQuery.data;
  const refreshCase = caseQuery.refresh;

  const [acting, setActing] = useState<DisputeAction | null>(null);
  const [actionResult, setActionResult] = useState<ActionResponse | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const [triageLoading, setTriageLoading] = useState(false);
  const [triageNote, setTriageNote] = useState<string | null>(null);
  const [triageError, setTriageError] = useState<ApiError | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    setActionResult(null);
    setActionError(null);
    setTriageNote(null);
    setTriageError(null);
  }, [activeDisputeId]);

  const runAction = useCallback(
    async (action: DisputeAction) => {
      if (!detail || acting) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setActing(action);
      setActionError(null);
      setActionResult(null);
      try {
        const result = await api.performAction(
          detail.dispute_id,
          action,
          { idempotency_key: detail.dispute_id + ":" + action + ":" + Date.now() },
          controller.signal,
        );
        setActionResult(result);
        refreshCase();
        onCaseChanged();
      } catch (caught) {
        setActionError(toApiError(caught));
      } finally {
        setActing(null);
      }
    },
    [acting, detail, onCaseChanged, refreshCase],
  );

  const runTriage = useCallback(async () => {
    if (!detail || triageLoading) return;
    setTriageLoading(true);
    setTriageError(null);
    setTriageNote(null);
    try {
      const result = await api.triageDispute(detail.dispute_id);
      setTriageNote(
        "EV recomputed. " +
          RECOMMENDATION_META[result.recommended_action].label +
          ", p(win) " +
          formatPercent(result.win_probability.score),
      );
      refreshCase();
      onCaseChanged();
    } catch (caught) {
      setTriageError(toApiError(caught));
    } finally {
      setTriageLoading(false);
    }
  }, [detail, onCaseChanged, refreshCase, triageLoading]);

  const containment =
    flowDispute && detail && flowDispute.dispute.dispute_id === detail.dispute_id
      ? parseContainment(flowDispute.containment)
      : null;
  const containmentHeadline = containment ? describeContainment(containment) : null;
  const suspendedFallback = detail?.subscription_suspended ?? false;

  const events = timeline.data?.events ?? fallbackEvents ?? [];
  const chainValid = timeline.data?.chain.valid ?? detail?.facts.chain_valid ?? false;
  const chainHead = timeline.data?.chain.head_hash ?? detail?.facts.chain_head ?? null;

  const recMeta = detail
    ? RECOMMENDATION_META[detail.recommended_action]
    : RECOMMENDATION_META.MONITOR;
  const primaryAction = detail ? recMeta.action : null;
  const allowedAction =
    detail && primaryAction
      ? detail.allowed_actions.find((candidate) => candidate.action === primaryAction)
      : undefined;
  const canAct = Boolean(detail && primaryAction && allowedAction?.allowed && !acting);
  const blockedReason = !primaryAction
    ? "No PayPal action is recommended at this stage. Monitor the case and re-run triage if new telemetry lands."
    : allowedAction && !allowedAction.allowed
      ? (allowedAction.reason ?? "PayPal is not exposing this action at the current stage.")
      : allowedAction
        ? null
        : "PayPal has not exposed this action for this case.";

  const bestKey: "fight" | "settle" | "offer" | null = detail
    ? bestEvPath(detail.breakdown)
    : null;
  const evValues = detail
    ? [
        detail.breakdown.ev_fight_usd,
        detail.breakdown.ev_settle_usd,
        detail.breakdown.ev_offer_usd,
      ]
    : [];
  const maxAbs =
    evValues.length > 0
      ? Math.max(...evValues.map((value) => Math.abs(value)), 1)
      : 1;

  const revealInitial = reduced ? false : "hidden";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="title-section">Merchant command centre</h2>
          {activeDisputeId ? (
            <Badge tone="neutral" title={activeDisputeId}>
              {shortHash(activeDisputeId, 12, 4)}
            </Badge>
          ) : null}
          {restoredFromQueue ? (
            <Badge
              tone="warning"
              title="Loaded from the latest open dispute in GET /disputes. Run the three steps to create a new case."
            >
              Latest case
            </Badge>
          ) : null}
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              detail ? "live-dot bg-positive" : "bg-control",
            )}
          />
          {detail ? "Live, refreshed every 2s" : "Waiting for a case"}
        </span>
      </div>

      {!activeDisputeId ? (
        <Panel>
          <EmptyState
            icon={<ShieldCheck size={18} aria-hidden />}
            title="No dispute on file"
            description="Run steps 1–3 on the left to open an inquiry through the PayPal webhook path. This panel reads live case state, nothing here is mocked."
            action={
              <span className="num text-xs text-muted">
                GET /api/v1/disputes, refreshed every 2 seconds
              </span>
            }
          />
        </Panel>
      ) : caseQuery.error && !detail ? (
        <div className="space-y-3">
          <ErrorBanner
            error={caseQuery.error}
            context={"Could not load case " + activeDisputeId + "."}
            onRetry={refreshCase}
          />
          <SkeletonLines lines={6} />
        </div>
      ) : !detail ? (
        <div className="space-y-4" aria-busy="true" aria-label="Loading case">
          <Skeleton className="h-[212px] w-full rounded-card" />
          <Skeleton className="h-10 w-2/3" />
          <div className="grid gap-2 sm:grid-cols-3">
            <Skeleton className="h-[104px] w-full" />
            <Skeleton className="h-[104px] w-full" />
            <Skeleton className="h-[104px] w-full" />
          </div>
          <SkeletonLines lines={5} />
        </div>
      ) : (
        <motion.div
          key={activeDisputeId ?? "none"}
          variants={stagger}
          initial={revealInitial}
          animate="show"
          className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
        >
          <motion.div variants={staggerItem} className="min-w-0 space-y-4">
            {caseQuery.error ? (
              <ErrorBanner
                error={caseQuery.error}
                context="Showing the last known case state while the API recovers."
                onRetry={refreshCase}
              />
            ) : null}

            <VerdictCard
              detail={detail}
              allowedAction={allowedAction}
              primaryAction={primaryAction}
              canAct={canAct}
              acting={acting !== null}
              blockedReason={blockedReason}
              actionResult={actionResult}
              actionError={actionError}
              onExecute={() => {
                if (primaryAction) void runAction(primaryAction);
              }}
            />

            <Panel>
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3.5">
                <h2 className="title-section">Expected value</h2>
                <span className="num text-sm text-muted">
                  USD, net of non-refundable fees, p(win) {formatPercent(detail.p_win)}
                </span>
              </div>
                            <EvComparison
                breakdown={detail.breakdown}
                stage={detail.stage}
                bestKey={bestKey}
                maxAbs={maxAbs}
              />
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem} className="min-w-0 space-y-4">
            <CaseSummary detail={detail} now={now} />

            {containmentHeadline ? (
              <Panel className="min-h-[76px]">
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <Zap size={14} aria-hidden className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="text-base text-ink">{containmentHeadline.text}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {containmentHeadline.detail ?? "Circuit breaker on webhook ingest"}
                    </p>
                  </div>
                  <Badge
                    tone={containmentHeadline.tone}
                    className="ml-auto shrink-0"
                  >
                    Containment
                  </Badge>
                </div>
              </Panel>
            ) : (
              <Panel className="min-h-[76px]">
                <div className="flex items-start gap-3 px-4 py-3.5">
                  <Zap size={14} aria-hidden className="mt-0.5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="text-base text-ink">
                      {suspendedFallback ? "Subscription suspended" : "Subscription active"}
                    </p>
                    <p className="mt-0.5 text-sm text-muted">
                      Containment state synced from the case record.
                    </p>
                  </div>
                  <Badge
                    tone={suspendedFallback ? "positive" : "neutral"}
                    className="ml-auto shrink-0"
                  >
                    Containment
                  </Badge>
                </div>
              </Panel>
            )}

            <CustodyChain
              chainHead={chainHead}
              disputeId={detail.dispute_id}
              actionLabel={primaryAction ? ACTION_META[primaryAction].label : "Monitor"}
              events={events}
            />

            <Panel className="min-h-[76px]">
              <div className="flex flex-wrap items-center gap-2 px-4 py-3.5">
                <Link
                  href={"/disputes/" + encodeURIComponent(detail.dispute_id)}
                  className="inline-flex h-control items-center gap-2 rounded-full border border-control bg-raised px-3.5 text-base text-ink transition-colors duration-120 hover:bg-[#29282c]"
                >
                  Full case room
                  <ArrowRight size={12} aria-hidden className="text-muted" />
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={triageLoading}
                  icon={<RefreshCw size={12} aria-hidden />}
                  onClick={() => {
                    void runTriage();
                  }}
                >
                  Re-run triage
                </Button>
              </div>
              {triageNote ? (
                <p className="row-rule px-4 py-2.5 text-sm text-muted">{triageNote}</p>
              ) : null}
              {triageError ? (
                <div className="row-rule px-4 py-3">
                  <ErrorBanner error={triageError} context="Triage recompute failed." />
                </div>
              ) : null}

              {detail.actions.length > 0 ? (
                <div className="row-rule px-4 py-3.5">
                  <h3 className="label">Action audit</h3>
                  <ul className="mt-2 space-y-2">
                    {detail.actions.slice(-3).map((record) => (
                      <li
                        key={record.action_id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
                      >
                        <span className="text-sm text-ink">
                          {ACTION_META[record.action].label}
                        </span>
                        <span className="text-muted">{humaniseAction(record.status)}</span>
                        <span className="num text-muted">{formatLatency(record.latency_ms)}</span>
                        <span className="num ml-auto text-muted" title={record.action_id}>
                          {shortHash(record.action_id, 8, 4)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {!detail.facts.chain_valid ? (
                <p className="row-rule flex items-start gap-2 px-4 py-3 text-sm text-negative">
                  <AlertTriangle size={12} aria-hidden className="mt-0.5 shrink-0" />
                  Chain verification failed. Evidence generation is unsupported until it is
                  repaired.
                </p>
              ) : null}
            </Panel>
          </motion.div>

          <motion.div variants={staggerItem} className="min-w-0 lg:col-span-2">
            <TelemetryLedger
              events={events}
              chainValid={chainValid}
              chainHead={chainHead}
              loading={timeline.loading}
              error={timeline.error}
            />
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
