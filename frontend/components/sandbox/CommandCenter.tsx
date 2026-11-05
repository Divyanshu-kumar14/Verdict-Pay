"use client";

import Link from "next/link";
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

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { describeContainment, parseContainment } from "@/lib/containment";
import {
  bestEvPath,
  fightEvNote,
  offerEvNote,
  settleEvNote,
} from "@/lib/ev";
import {
  formatClock,
  formatDueIn,
  formatInteger,
  formatPercent,
  formatUsd,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import type { PolledQuery } from "@/lib/hooks/usePolledQuery";
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
  TONE_TEXT,
  type Tone,
} from "@/lib/vocab";

const CONTAINMENT_PANEL: Record<Tone, string> = {
  emerald: "border-emerald/20 bg-emerald/[0.05]",
  amber: "border-amber/20 bg-amber/[0.05]",
  rose: "border-rose/25 bg-rose/[0.06]",
  sky: "border-sky/20 bg-sky/[0.05]",
  neutral: "border-hairline bg-white/[0.02]",
};

function EvCard({
  label,
  value,
  note,
  tone,
  best,
  maxAbs,
}: {
  label: string;
  value: number;
  note: string;
  tone: Tone;
  best: boolean;
  maxAbs: number;
}) {
  const fraction = maxAbs > 0 ? Math.abs(value) / maxAbs : 0;
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2.5",
        best ? "border-emerald/35 bg-emerald/[0.06]" : "border-hairline bg-white/[0.015]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-dim">
          {label}
        </span>
        {best ? (
          <span className="text-[8.5px] font-semibold uppercase tracking-[0.12em] text-emerald">
            Best EV
          </span>
        ) : null}
      </div>
      <div className="num mt-1 text-[16px] font-medium tracking-[-0.02em] text-ink">
        {formatUsd(value)}
      </div>
      <ProgressBar
        value={fraction}
        tone={tone}
        label={`${label} expected value relative to the largest loss`}
        className="mt-2 h-1"
      />
      <div className="mt-1.5 text-[9.5px] leading-snug text-muted">{note}</div>
    </div>
  );
}

function CaseSummary({ detail, now }: { detail: DisputeDetail; now: number | null }) {
  const reason = REASON_META[detail.reason_code];
  const stage = STAGE_META[detail.stage];
  const channel = CHANNEL_META[detail.channel];
  const status = STATUS_META[detail.status];

  return (
    <div className="rounded-lg border border-hairline bg-[#0b1117] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="kicker">Detected dispute</span>
            <Badge tone={status.tone} dot>
              {status.short}
            </Badge>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className="num text-[14px] text-ink" title={detail.dispute_id}>
              {shortHash(detail.dispute_id, 14, 4)}
            </span>
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
            <span title={detail.payer_id}>payer {shortHash(detail.payer_id, 8, 4)}</span>
            <span title={detail.order_id}>order {shortHash(detail.order_id, 8, 4)}</span>
            {detail.subscription_id ? (
              <span title={detail.subscription_id}>
                sub {shortHash(detail.subscription_id, 8, 4)}
              </span>
            ) : (
              <span className="text-dim">no subscription</span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="kicker">Claim amount</div>
          <div className="num mt-1 text-[22px] font-medium tracking-[-0.02em] text-ink">
            {formatUsd(detail.amount_usd)}
          </div>
          <div className="mt-0.5 text-[10.5px] text-muted">
            {now === null ? "deadline —" : formatDueIn(detail.seller_response_due_date, now)}
          </div>
        </div>
      </div>
    </div>
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
    <section aria-label="Telemetry ledger" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="kicker">Telemetry ledger</span>
        <span className="flex items-center gap-2">
          {chainHead ? (
            <span className="font-mono text-[9.5px] text-dim" title={chainHead}>
              head {shortHash(chainHead, 8, 6)}
            </span>
          ) : null}
          <Badge tone={chainValid ? "emerald" : "rose"} dot>
            {chainValid ? "Chain verified" : "Chain unverified"}
          </Badge>
        </span>
      </div>

      <div className="overflow-hidden rounded-md border border-hairline">
        <div className="max-h-[190px] overflow-y-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Hash-chained telemetry events for the disputed payer
            </caption>
            <thead className="sticky top-0 bg-[#0b1117]">
              <tr className="border-b border-hairline text-[9px] uppercase tracking-[0.12em] text-dim">
                <th scope="col" className="px-2.5 py-1.5 font-medium">
                  Seq
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Event
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium">
                  Chain hash
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  Units
                </th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-medium">
                  UTC
                </th>
              </tr>
            </thead>
            <tbody>
              {loading && events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2.5 py-2">
                    <Skeleton className="h-9 w-full" />
                  </td>
                </tr>
              ) : events.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2.5 py-2.5 text-[11px] text-muted">
                    No telemetry events on file yet. Run step 2 to append four signed events.
                  </td>
                </tr>
              ) : (
                events.slice(0, 8).map((event) => (
                  <tr
                    key={event.id}
                    className="border-b border-hairline/60 last:border-b-0"
                  >
                    <td className="num px-2.5 py-1.5 text-[10px] text-dim">{event.sequence}</td>
                    <td className="px-2 py-1.5">
                      <span className="flex items-center gap-1.5 text-[10.5px] text-ink">
                        <span
                          aria-hidden
                          className="h-1 w-1 rounded-full bg-emerald/70"
                        />
                        {EVENT_META[event.event_type].label}
                      </span>
                    </td>
                    <td
                      className="num px-2 py-1.5 text-[10px] text-muted"
                      title={event.chain_hash}
                    >
                      {shortHash(event.chain_hash, 8, 5)}
                    </td>
                    <td className="num px-2 py-1.5 text-right text-[10px] text-muted">
                      {event.units_consumed > 0 ? formatInteger(event.units_consumed) : "—"}
                    </td>
                    <td className="num px-2.5 py-1.5 text-right text-[10px] text-muted">
                      {formatClock(Date.parse(event.created_at))}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[9.5px] text-dim">
        <span>
          {events.length} events · append-only · sequence 1..{events.length}
          {events.length > 8 ? ` · showing newest 8` : ""}
        </span>
        <span className="flex items-center gap-1">
          <Link2 size={9} aria-hidden /> SHA-256 per payer stream
        </span>
      </div>
      {error ? (
        <p className="font-mono text-[10px] text-rose" title={error.message}>
          ledger refresh failed · {error.code}
        </p>
      ) : null}
    </section>
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
 * The merchant side of the demo: containment, EV pricing, recommendation and the
 * single PayPal action that recommendation calls for.
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
          { idempotency_key: `${detail.dispute_id}:${action}:${Date.now()}` },
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
        `EV recomputed · ${result.recommended_action} · p(win) ${formatPercent(result.win_probability.score)}`,
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
  const allowedAction = detail && primaryAction
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

  const evValues = detail
    ? [detail.breakdown.ev_fight_usd, detail.breakdown.ev_settle_usd, detail.breakdown.ev_offer_usd]
    : [];
  const maxAbs = evValues.length > 0 ? Math.max(...evValues.map((value) => Math.abs(value)), 1) : 1;
  const bestKey: "fight" | "settle" | "offer" | null = detail
    ? bestEvPath(detail.breakdown)
    : null;

  return (
    <Panel className="flex min-h-[660px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="kicker">Merchant command center</span>
          {activeDisputeId ? (
            <Badge tone="neutral" mono title={activeDisputeId}>
              {shortHash(activeDisputeId, 12, 4)}
            </Badge>
          ) : null}
          {restoredFromQueue ? (
            <Badge
              tone="amber"
              title="Loaded from the latest open dispute in GET /disputes. Run the three steps to create a new case."
            >
              LATEST CASE
            </Badge>
          ) : null}
        </div>
        <span className="flex items-center gap-1.5 font-mono text-[9.5px] text-dim">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              detail ? "bg-emerald live-dot" : "bg-white/25",
            )}
          />
          {detail ? "live · 2s poll" : "waiting"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {!activeDisputeId ? (
          <EmptyState
            className="h-full min-h-[420px] border-white/10"
            icon={<ShieldCheck size={18} aria-hidden />}
            title="No dispute on file"
            description="Run steps 1–3 on the left to open an INQUIRY through the PayPal webhook path. This panel reads live case state — nothing here is mocked."
            action={
              <span className="font-mono text-[10px] text-dim">
                GET /api/v1/disputes · polling every 2s while visible
              </span>
            }
          />
        ) : caseQuery.error && !detail ? (
          <div className="space-y-3">
            <ErrorBanner
              error={caseQuery.error}
              context={`Could not load case ${activeDisputeId}.`}
              onRetry={refreshCase}
            />
            <SkeletonLines lines={6} />
          </div>
        ) : !detail ? (
          <div className="space-y-4" aria-busy="true" aria-label="Loading case">
            <Skeleton className="h-[92px] w-full" />
            <Skeleton className="h-10 w-full" />
            <div className="grid gap-2 sm:grid-cols-3">
              <Skeleton className="h-[112px] w-full" />
              <Skeleton className="h-[112px] w-full" />
              <Skeleton className="h-[112px] w-full" />
            </div>
            <Skeleton className="h-[74px] w-full" />
            <SkeletonLines lines={5} />
          </div>
        ) : (
          <div className="space-y-4">
            {caseQuery.error ? (
              <ErrorBanner
                error={caseQuery.error}
                context="Showing the last known case state while the API recovers."
                onRetry={refreshCase}
              />
            ) : null}

            <CaseSummary detail={detail} now={now} />

            {containmentHeadline ? (
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-md border px-3 py-2.5",
                  CONTAINMENT_PANEL[containmentHeadline.tone],
                )}
              >
                <Zap
                  size={14}
                  aria-hidden
                  className={cn("mt-0.5 shrink-0", TONE_TEXT[containmentHeadline.tone])}
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">{containmentHeadline.text}</p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">
                    {containmentHeadline.detail ?? "circuit breaker · webhook ingest"}
                  </p>
                </div>
                <span className="ml-auto shrink-0 font-mono text-[8.5px] uppercase tracking-[0.14em] text-dim">
                  containment
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-md border px-3 py-2.5",
                  suspendedFallback ? CONTAINMENT_PANEL.emerald : CONTAINMENT_PANEL.neutral,
                )}
              >
                <Zap
                  size={14}
                  aria-hidden
                  className={cn(
                    "mt-0.5 shrink-0",
                    suspendedFallback ? "text-emerald" : "text-dim",
                  )}
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">
                    {suspendedFallback
                      ? "Subscription suspended"
                      : "Subscription active"}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">
                    containment state synced from the case record
                  </p>
                </div>
              </div>
            )}

            <section aria-label="Expected value" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="kicker">Expected value</span>
                <span className="font-mono text-[9.5px] text-dim">
                  USD · net of non-refundable fees · p(win) {formatPercent(detail.p_win)}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <EvCard
                  label="Fight"
                  value={detail.breakdown.ev_fight_usd}
                  note={fightEvNote(detail.breakdown)}
                  tone="rose"
                  best={bestKey === "fight"}
                  maxAbs={maxAbs}
                />
                <EvCard
                  label="Settle"
                  value={detail.breakdown.ev_settle_usd}
                  note={settleEvNote(detail.breakdown, detail.stage)}
                  tone="amber"
                  best={bestKey === "settle"}
                  maxAbs={maxAbs}
                />
                <EvCard
                  label="Offer"
                  value={detail.breakdown.ev_offer_usd}
                  note={offerEvNote(detail.breakdown)}
                  tone="sky"
                  best={bestKey === "offer"}
                  maxAbs={maxAbs}
                />
              </div>
            </section>

            <section
              aria-label="Recommendation"
              className="rounded-lg border border-amber/20 bg-amber/[0.04] p-3.5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="kicker">Recommendation</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge tone={recMeta.tone} size="sm">
                      {recMeta.label}
                    </Badge>
                    <span className="font-mono text-[10px] text-dim">
                      {detail.recommended_action}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="kicker">Completeness</div>
                  <div className="num mt-1 text-[13px] text-ink">
                    {formatPercent(detail.telemetry_completeness, 0)}
                  </div>
                </div>
              </div>

              {detail.rationale.length > 0 ? (
                <ul className="mt-2.5 space-y-1.5">
                  {detail.rationale.slice(0, 2).map((item) => (
                    <li key={item.key} className="text-[11.5px] leading-snug text-muted">
                      <span className="font-medium text-ink">{item.label}</span>
                      <span className="mx-1 text-dim">·</span>
                      <span className="line-clamp-2">{item.detail}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3">
                <Button
                  variant="primary"
                  size="lg"
                  block
                  loading={acting !== null}
                  disabled={!canAct}
                  onClick={() => {
                    if (primaryAction) void runAction(primaryAction);
                  }}
                  trailingIcon={<ArrowRight size={14} aria-hidden />}
                >
                  {primaryAction ? recMeta.verb : "Monitor case"}
                </Button>
                <p className="mt-2 text-[10.5px] leading-snug text-muted">
                  {primaryAction
                    ? `${ACTION_META[primaryAction].description} ${allowedAction ? `PayPal fee ${formatUsd(allowedAction.fee_usd)}.` : ""}`
                    : blockedReason}
                </p>
                {primaryAction && blockedReason ? (
                  <p className="mt-1 text-[10.5px] leading-snug text-amber">{blockedReason}</p>
                ) : null}
              </div>
            </section>

            {actionError ? (
              <ErrorBanner
                error={actionError}
                context="The PayPal action did not complete. The case was not changed optimistically."
              />
            ) : null}

            {actionResult ? (
              <div
                role="status"
                className={cn(
                  "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-[11px]",
                  actionResult.status === "EXECUTED"
                    ? "border-emerald/25 bg-emerald/[0.06] text-emerald"
                    : "border-amber/25 bg-amber/[0.06] text-amber",
                )}
              >
                <CircleCheck size={13} aria-hidden />
                <span className="font-medium">{actionResult.status}</span>
                <span className="text-muted">{ACTION_META[actionResult.action].label}</span>
                <span className="num text-dim">· {actionResult.latency_ms}ms</span>
                <span className="num text-dim" title={actionResult.action_id}>
                  · {shortHash(actionResult.action_id, 10, 4)}
                </span>
              </div>
            ) : null}

            <TelemetryLedger
              events={events}
              chainValid={chainValid}
              chainHead={chainHead}
              loading={timeline.loading}
              error={timeline.error}
            />

            <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-3">
              <Link
                href={`/disputes/${encodeURIComponent(detail.dispute_id)}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline px-2.5 py-1.5 text-[11px] text-muted transition-colors hover:border-white/15 hover:text-ink"
              >
                Full case room
                <ArrowRight size={12} aria-hidden />
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
              {triageNote ? (
                <span className="font-mono text-[9.5px] text-emerald">{triageNote}</span>
              ) : null}
            </div>
            {triageError ? (
              <ErrorBanner error={triageError} context="Triage recompute failed." />
            ) : null}

            {detail.actions.length > 0 ? (
              <div className="space-y-1.5">
                <span className="kicker">Action audit</span>
                <ul className="space-y-1">
                  {detail.actions.slice(-3).map((record) => (
                    <li
                      key={record.action_id}
                      className="flex flex-wrap items-center gap-2 rounded border border-hairline bg-white/[0.015] px-2.5 py-1.5 font-mono text-[9.5px] text-muted"
                    >
                      <span className="text-ink">{ACTION_META[record.action].label}</span>
                      <span className="text-dim">{record.status}</span>
                      <span>{record.latency_ms}ms</span>
                      <span className="ml-auto text-dim" title={record.action_id}>
                        {shortHash(record.action_id, 8, 4)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!detail.facts.chain_valid ? (
              <p className="flex items-center gap-1.5 text-[10.5px] text-rose">
                <AlertTriangle size={11} aria-hidden />
                Chain verification failed — evidence generation is unsupported until it is repaired.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </Panel>
  );
}