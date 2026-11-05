"use client";

import Link from "next/link";
import { useCallback, useRef, useState } from "react";
import { ChevronLeft, RefreshCw } from "lucide-react";
import { MotionConfig } from "motion/react";

import { ActionRail } from "@/components/disputes/ActionRail";
import { CaseFactsPanel } from "@/components/disputes/CaseFactsPanel";
import { DossierPanel } from "@/components/disputes/DossierPanel";
import { EvWaterfall } from "@/components/disputes/EvWaterfall";
import { WinProbabilityPanel } from "@/components/disputes/WinProbabilityPanel";
import { AnimatedBeam } from "@/components/premium/AnimatedBeam";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { LiquidGlass } from "@/components/premium/LiquidGlass";
import { Reveal } from "@/components/premium/Reveal";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
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
import type { ActionStatus, DisputeDetail, RecommendedAction } from "@/lib/types";
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

const VERDICT_ACCENT: Record<RecommendedAction, "emerald" | "ice" | "rose" | "amber" | "none"> = {
  PROVIDE_EVIDENCE: "emerald",
  MAKE_OFFER: "ice",
  ACCEPT_CLAIM: "rose",
  DEFLECT_INQUIRY: "amber",
  MONITOR: "none",
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
      <Skeleton className="h-[120px] w-full" />
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

function CustodyPath({ detail }: { detail: DisputeDetail }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const ledgerRef = useRef<HTMLDivElement | null>(null);
  const caseRef = useRef<HTMLDivElement | null>(null);
  const paypalRef = useRef<HTMLDivElement | null>(null);
  const nodes = [
    { ref: ledgerRef, caption: "LEDGER", value: shortHash(detail.facts.chain_head, 8, 4) },
    { ref: caseRef, caption: "CASE", value: shortHash(detail.dispute_id, 8, 4) },
    { ref: paypalRef, caption: "PAYPAL", value: "resolution centre" },
  ];
  return (
    <div ref={containerRef} className="relative" aria-label="Chain of custody">
      <AnimatedBeam containerRef={containerRef} fromRef={ledgerRef} toRef={caseRef} curvature={-18} />
      <AnimatedBeam containerRef={containerRef} fromRef={caseRef} toRef={paypalRef} curvature={-18} />
      <div className="relative grid grid-cols-3 gap-2">
        {nodes.map((node) => (
          <div key={node.caption} ref={node.ref} className="rounded-md border border-hairline bg-sunken/80 px-2 py-1.5 text-center">
            <div className="font-mono text-[8.5px] uppercase tracking-[0.14em] text-dim">{node.caption}</div>
            <div className="num mt-0.5 truncate font-mono text-[10px] text-ink" title={node.value}>
              {node.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VerdictHero({
  detail,
  now,
  triageLoading,
  onRecompute,
}: {
  detail: DisputeDetail;
  now: number | null;
  triageLoading: boolean;
  onRecompute: () => void;
}) {
  const meta = RECOMMENDATION_META[detail.recommended_action];
  const recommendedPaypalAction = meta.action;
  const fee = recommendedPaypalAction
    ? (detail.allowed_actions.find((candidate) => candidate.action === recommendedPaypalAction)?.fee_usd ?? 0)
    : 0;
  const paths = [
    { key: "fight", label: "Fight", value: detail.ev_fight_usd },
    { key: "settle", label: "Settle", value: detail.ev_settle_usd },
    { key: "offer", label: "Offer", value: detail.ev_offer_usd },
  ] as const;
  const cheapest = Math.max(detail.ev_fight_usd, detail.ev_settle_usd, detail.ev_offer_usd);
  return (
    <LiquidGlass depth={3} accent={VERDICT_ACCENT[detail.recommended_action]} grid>
      <div className="grain relative p-5 sm:p-7">
        <div className="instrument-grid pointer-events-none absolute inset-0 opacity-40" aria-hidden />
        <div className="relative">
          <FieldLabel rule tone="ice">
            Verdict · deterministic triage policy
          </FieldLabel>
          <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="ink-gradient text-[32px] font-medium leading-[1.05] tracking-[-0.03em] sm:text-[38px]">
                {meta.verb}
              </p>
              <p className="num mt-2 font-mono text-[11px] text-muted">
                cheapest path {formatUsd(cheapest)} · paypal fee {formatUsd(fee)} · claim {formatUsd(detail.amount_usd)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone={meta.tone} dot>
                {detail.recommended_action}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                loading={triageLoading}
                icon={<RefreshCw size={12} aria-hidden />}
                onClick={onRecompute}
              >
                Recompute EV
              </Button>
            </div>
          </div>

          <dl className="mt-5 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-hairline bg-hairline" aria-label="Expected value by path">
            {paths.map((path) => {
              const isBest = path.value === cheapest;
              return (
                <div key={path.key} className="bg-void/90 px-3 py-3 sm:px-4">
                  <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-dim">
                    EV {path.label}
                  </dt>
                  <dd className={cn("num mt-1 text-[17px] font-medium tracking-[-0.02em] sm:text-[21px]", isBest ? "text-emerald" : "text-ink")}>
                    {formatUsd(path.value)}
                  </dd>
                  <dd className="num mt-0.5 font-mono text-[9px] text-dim">
                    {isBest ? "CHEAPEST" : "+" + formatUsd(Math.abs(path.value - cheapest)) + " vs best"}
                  </dd>
                </div>
              );
            })}
          </dl>

          <div className="mt-4">
            <CustodyPath detail={detail} />
          </div>

          {detail.rationale.length > 0 ? (
            <ol className="mt-4 border-t border-hairline" aria-label="Verdict rationale">
              {detail.rationale.map((item, index) => (
                <li key={item.key} className="flex gap-3 border-b border-hairline/60 py-2 last:border-b-0">
                  <span className="num shrink-0 font-mono text-[10px] text-ice" aria-hidden>
                    {"0" + String(index + 1)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[11.5px] font-medium text-ink">{item.label}</p>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">{item.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-4 text-[11px] text-muted">No rationale was returned for this case.</p>
          )}

          <p className="num mt-3 font-mono text-[9.5px] text-dim">
            seller response due {now === null ? "--" : formatDueIn(detail.seller_response_due_date, now)}
            {" · "}p(win) {formatPercent(detail.p_win)}
          </p>
        </div>
      </div>
    </LiquidGlass>
  );
}

function ActionAuditPanel({ detail }: { detail: DisputeDetail }) {
  return (
    <SpotlightCard className="p-4 sm:p-5" aria-label="Actions on this case">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <FieldLabel rule tone="ice">
            Audit log · every PayPal call recorded
          </FieldLabel>
          <h2 className="mt-1.5 text-[14px] font-medium tracking-[-0.01em] text-ink">
            Actions on this case
          </h2>
        </div>
        <Badge tone="neutral" mono>
          {detail.actions.length} records
        </Badge>
      </div>
      <div className="mt-3">
        {detail.actions.length === 0 ? (
          <p className="text-[11.5px] text-muted">
            No action has been executed yet. The action rail is the only write path.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-left">
              <caption className="sr-only">Dispute action audit log</caption>
              <thead>
                <tr className="border-b border-hairline font-mono text-[9px] uppercase tracking-[0.12em] text-dim">
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
                    <td className="px-2 py-2 text-[11px] text-ink">
                      {ACTION_META[record.action].label}
                    </td>
                    <td className="px-2 py-2">
                      <Badge tone={ACTION_STATUS_TONE[record.status]}>{record.status}</Badge>
                    </td>
                    <td className="num px-2 py-2 text-[10.5px] text-muted">
                      {formatLatency(record.latency_ms)}
                    </td>
                    <td className="num px-2 py-2 text-[10.5px] text-muted" title={record.action_id}>
                      {shortHash(record.action_id, 10, 4)}
                    </td>
                    <td className="num px-2 py-2 text-right text-[10.5px] text-muted">
                      {formatAbsolute(record.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {detail.actions.some((record) => record.error) ? (
          <p className="mt-2 text-[10.5px] text-rose">
            {detail.actions.length} actions recorded · the most recent failure is in the audit
            payload.
          </p>
        ) : null}
      </div>
    </SpotlightCard>
  );
}

/** /disputes/[id] — the case room: EV waterfall, signals, facts, actions and dossier. */
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
      setTriageNote("Recomputed · " + response.recommended_action);
      refresh();
    } catch (caught) {
      setTriageError(toApiError(caught));
    } finally {
      setTriageLoading(false);
    }
  }, [detail, refresh, triageLoading]);

  return (
    <MotionConfig reducedMotion="user">
    <div className="space-y-4">
      <BackLink />

      {query.error && !detail ? (
        <div className="space-y-3">
          <ErrorBanner
            error={query.error}
            context={"Case " + caseId + " could not be loaded from the API."}
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
            <h1 className="num mt-2 break-all font-mono text-[17px] font-medium tracking-[-0.01em] text-ink sm:text-[19px]">
              {detail.dispute_id}
            </h1>
            <div className="num mt-1.5 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
              <span title={detail.payer_id}>payer {detail.payer_id}</span>
              <span title={detail.order_id}>order {detail.order_id}</span>
              {detail.subscription_id ? (
                <span title={detail.subscription_id}>sub {detail.subscription_id}</span>
              ) : (
                <span className="text-dim">no subscription</span>
              )}
            </div>
          </div>

          <Reveal>
            <VerdictHero
              detail={detail}
              now={now}
              triageLoading={triageLoading}
              onRecompute={() => {
                void runTriage();
              }}
            />
          </Reveal>

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
            <p className="num font-mono text-[10px] text-emerald">{triageNote}</p>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-4">
              <Reveal><EvWaterfall detail={detail} /></Reveal>
              <Reveal><WinProbabilityPanel probability={detail.win_probability} /></Reveal>
              <Reveal><CaseFactsPanel facts={detail.facts} /></Reveal>
              <Reveal><ActionAuditPanel detail={detail} /></Reveal>
            </div>
            <div className={cn("min-w-0 space-y-4")}>
              <Reveal><ActionRail detail={detail} onCompleted={refresh} /></Reveal>
              <Reveal><DossierPanel caseId={detail.dispute_id} available={detail.dossier_available} /></Reveal>
            </div>
          </div>
        </>
      )}
    </div>
    </MotionConfig>
  );
}
