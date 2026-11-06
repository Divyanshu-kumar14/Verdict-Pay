"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import { SealMark } from "@/components/evidence/SealMark";
import { Magnetic } from "@/components/motion/Magnetic";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton, SkeletonLines } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import {
  formatAbsolute,
  formatDueIn,
  formatPercent,
  formatUsd,
  isoToMs,
  shortHash,
} from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputeDetail } from "@/lib/types";
import {
  ACTION_META,
  CHANNEL_META,
  REASON_META,
  RECOMMENDATION_META,
  STAGE_META,
  STATUS_META,
  TONE_TEXT,
  type Tone,
} from "@/lib/vocab";

const SOON_WINDOW_MS = 3 * 86_400_000;

/** Deadline polarity: overdue, due soon, or neither. */
function dueTone(due: string | null, now: number): Tone {
  const ms = isoToMs(due);
  if (ms === null) return "neutral";
  if (ms < now) return "negative";
  if (ms - now <= SOON_WINDOW_MS) return "warning";
  return "neutral";
}

function Fact({
  label,
  value,
  title,
  tone,
}: {
  label: string;
  value: ReactNode;
  title?: string;
  tone?: Tone;
}) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd
        className={cn("num mt-1 truncate font-mono text-sm text-ink", tone ? TONE_TEXT[tone] : undefined)}
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

/** The drawer body: a live case read from GET /disputes/{id}, never fabricated. */
function CaseOverview({ detail, now }: { detail: DisputeDetail; now: number }) {
  const recommendation = RECOMMENDATION_META[detail.recommended_action];
  const action = recommendation.action;
  const deadlineTone = dueTone(detail.seller_response_due_date, now);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={STATUS_META[detail.status].tone} dot>
          {STATUS_META[detail.status].short}
        </Badge>
        <Badge tone={STAGE_META[detail.stage].tone}>{STAGE_META[detail.stage].label}</Badge>
        <Badge tone={CHANNEL_META[detail.channel].tone}>{CHANNEL_META[detail.channel].label}</Badge>
        <Badge tone={REASON_META[detail.reason_code].tone}>
          {REASON_META[detail.reason_code].label}
        </Badge>
        {detail.facts.chain_valid ? (
          <Badge tone="positive">
            <SealMark size={13} tone="positive" />
            Chain verified
          </Badge>
        ) : null}
      </div>

      <div className="row-rule pt-4">
        <p className="label">Amount in dispute</p>
        <p className="value mt-1 font-mono text-xl text-ink">{formatUsd(detail.amount_usd)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Fact label="Payer" value={shortHash(detail.payer_id, 12, 4)} title={detail.payer_id} />
        <Fact label="p(win)" value={formatPercent(detail.p_win)} />
        <Fact label="Expected loss" value={formatUsd(detail.ev_settle_usd)} />
        <Fact label="EV to fight" value={formatUsd(detail.ev_fight_usd)} />
        <Fact label="EV to offer" value={formatUsd(detail.ev_offer_usd)} />
        <div className="min-w-0">
          <dt className="label">Deadline</dt>
          <dd className={cn("num mt-1 truncate font-mono text-sm", TONE_TEXT[deadlineTone])}>
            {formatDueIn(detail.seller_response_due_date, now)}
          </dd>
          <dd className="num mt-0.5 truncate font-mono text-xs text-muted">
            {formatAbsolute(detail.seller_response_due_date)}
          </dd>
        </div>
      </dl>

      <div className="panel-raised px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <p className="label">Recommendation</p>
          <Badge tone={recommendation.tone} dot>
            {recommendation.label}
          </Badge>
        </div>
        <p className="mt-1.5 text-sm text-muted">
          {action
            ? ACTION_META[action].description
            : "No action is required — monitor this case for stage changes."}
        </p>
      </div>
    </div>
  );
}

/** A right-hand overview that opens from a queue row and links to the full case room. */
export function DisputeDrawer({
  disputeId,
  open,
  onClose,
}: {
  disputeId: string;
  open: boolean;
  onClose: () => void;
}) {
  const now = useNow(30000);
  const query = usePolledQuery(
    "dispute-drawer:" + disputeId,
    (signal) => api.getDispute(disputeId, signal),
    { intervalMs: 0, enabled: open },
  );
  const detail = query.data;
  const referenceNow = now ?? Date.now();

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={<span className="font-mono">{shortHash(disputeId || "case", 12, 6)}</span>}
      description="Live case read from the triage queue."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
          <Magnetic>
            <Link
              href={"/disputes/" + encodeURIComponent(disputeId)}
              className="inline-flex h-control items-center justify-center gap-2 rounded-full bg-accent px-3.5 text-base font-medium text-ground transition-colors duration-120 hover:bg-accent/85"
            >
              Open case room
              <ArrowUpRight size={14} aria-hidden />
            </Link>
          </Magnetic>
        </div>
      }
    >
      {query.error && !detail ? (
        <ErrorBanner
          error={query.error}
          context="The case overview could not be loaded."
          onRetry={query.refresh}
        />
      ) : !detail ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading case overview">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <SkeletonLines lines={4} />
        </div>
      ) : (
        <CaseOverview detail={detail} now={referenceNow} />
      )}
    </Drawer>
  );
}
