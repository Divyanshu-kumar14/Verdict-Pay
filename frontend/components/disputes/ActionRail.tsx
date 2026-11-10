"use client";

import { useState } from "react";
import { CircleAlert, CircleCheck, ExternalLink } from "lucide-react";

import { Magnetic } from "@/components/motion/Magnetic";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { api, toApiError, type ApiError } from "@/lib/api";
import { formatLatency, formatPercent, formatUsd, shortHash } from "@/lib/format";
import {
  DISPUTE_ACTIONS,
  type ActionRecord,
  type ActionResponse,
  type ActionStatus,
  type AllowedAction,
  type DisputeAction,
  type DisputeDetail,
} from "@/lib/types";
import {
  ACTION_META,
  CHANNEL_META,
  RECOMMENDATION_META,
  STAGE_META,
  type Tone,
} from "@/lib/vocab";

export const ACTION_STATUS_META: Record<ActionStatus, { word: string; tone: Tone }> = {
  EXECUTED: { word: "Executed", tone: "positive" },
  FAILED: { word: "Failed", tone: "negative" },
  SKIPPED: { word: "Skipped", tone: "warning" },
};

function StatusChip({ status }: { status: ActionStatus | null }) {
  if (status === null) {
    return null;
  }
  const meta = ACTION_STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.word}</Badge>;
}

/** The most recent status for an action across the case's audit history. */
function statusFor(records: ActionRecord[], action: DisputeAction): ActionStatus | null {
  let latest: ActionRecord | null = null;
  for (const record of records) {
    if (record.action !== action) {
      continue;
    }
    if (latest === null || Date.parse(record.created_at) > Date.parse(latest.created_at)) {
      latest = record;
    }
  }
  return latest === null ? null : latest.status;
}

function routeOf(paypalLink: string): string {
  try {
    const url = new URL(paypalLink);
    return url.hostname + " · " + url.pathname.slice(0, 28);
  } catch {
    return "PayPal";
  }
}

export function ActionRail({
  detail,
  onCompleted,
}: {
  detail: DisputeDetail;
  onCompleted: () => void;
}) {
  const [pending, setPending] = useState<AllowedAction | null>(null);
  const [note, setNote] = useState("");
  const [running, setRunning] = useState<DisputeAction | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [result, setResult] = useState<ActionResponse | null>(null);

  const recommendedAction = RECOMMENDATION_META[detail.recommended_action].action;

  const consequenceFor = (action: DisputeAction, feeUsd: number): string => {
    switch (action) {
      case "ACCEPT_CLAIM":
        return "Lose the disputed " + formatUsd(detail.amount_usd) + " — settle at a loss.";
      case "MAKE_OFFER":
        return (
          "Settle at " +
          formatUsd(detail.breakdown.ev_offer_usd > 0 ? -detail.breakdown.ev_offer_usd : 0) +
          " — a " +
          formatPercent(detail.breakdown.offer_ratio ?? 0, 0) +
          " goodwill offer costing " +
          formatUsd(Math.abs(detail.breakdown.ev_offer_usd)) +
          "; PayPal charges a $0.00 offer fee."
        );
      case "PROVIDE_EVIDENCE":
        return (
          "Contest with evidence — keep " +
          formatUsd(detail.amount_usd) +
          (detail.breakdown.win_fee_usd > 0
            ? " less the non-refundable " + formatUsd(detail.breakdown.win_fee_usd) + " HVD fee"
            : "") +
          ", or lose it plus one " +
          formatUsd(detail.breakdown.fight_fee_usd + feeUsd) +
          " dispute fee."
        );
      case "SEND_MESSAGE":
        return "Post a response in the dispute thread — no fee.";
      case "ESCALATE":
        return (
          "Open a PayPal claim for review — a loss costs the disputed " +
          formatUsd(detail.amount_usd) +
          " plus the " +
          formatUsd(detail.breakdown.fight_fee_usd) +
          " claim fee."
        );
      case "APPEAL":
        return "Ask PayPal to review a lost claim again — no fee.";
      default:
        return "Post a response in the dispute thread — no fee.";
    }
  };

  const orderedActions: AllowedAction[] = DISPUTE_ACTIONS.map((action) => {
    const candidate = detail.allowed_actions.find((entry) => entry.action === action);
    return (
      candidate ?? {
        action,
        allowed: false,
        reason: "PayPal does not expose this action at this stage.",
        fee_usd: 0,
        paypal_link: null,
      }
    );
  });

  const openCount = detail.allowed_actions.filter((candidate) => candidate.allowed).length;

  const openConfirm = (candidate: AllowedAction): void => {
    setPending(candidate);
    setError(null);
    setNote("");
  };

  const runConfirmed = async (): Promise<void> => {
    if (pending === null) {
      return;
    }
    const action = pending.action;
    setRunning(action);
    setError(null);
    setResult(null);
    try {
      const response = await api.performAction(
        detail.dispute_id,
        action,
        {
          note: note.trim() === "" ? undefined : note.trim(),
          idempotency_key: detail.dispute_id + ":" + action + ":" + Date.now(),
        },
        new AbortController().signal,
      );
      setResult(response);
      setPending(null);
      onCompleted();
    } catch (runError) {
      setError(toApiError(runError));
    } finally {
      setRunning(null);
    }
  };

  const primary =
    recommendedAction === null
      ? null
      : orderedActions.find((candidate) => candidate.action === recommendedAction) ?? null;

  const secondary = primary === null ? orderedActions : orderedActions.filter((c) => c !== primary);

  const variantFor = (action: DisputeAction): "primary" | "danger" =>
    action === "ACCEPT_CLAIM" ? "danger" : "primary";

  return (
    <Panel className="overflow-hidden" aria-label="PayPal response actions">
      <PanelHeader
        title="PayPal response"
        description="Actions PayPal actually exposes for this stage, with the policy recommendation first."
        actions={<Badge tone="accent">{openCount} available</Badge>}
      />

      {result !== null ? (
        <div className="row-rule px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            {result.status === "EXECUTED" ? (
              <CircleCheck size={15} className="text-positive" />
            ) : (
              <CircleAlert size={15} className="text-warning" />
            )}
            <StatusChip status={result.status} />
            <span className="num text-sm text-muted">{formatLatency(result.latency_ms)}</span>
            <span className="num text-xs text-muted">{shortHash(result.action_id)}</span>
          </div>
        </div>
      ) : null}

      {primary !== null ? (
        <div className="sig-edge row-rule px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="accent" dot>
              Recommended
            </Badge>
            <StatusChip status={statusFor(detail.actions, primary.action)} />
          </div>
          <p className="mt-2 text-sm leading-snug text-muted">
            {primary.allowed
              ? ACTION_META[primary.action].description
              : primary.reason ?? "Not available at this stage."}
          </p>
          <p className="mt-1.5 text-sm leading-snug">
            <span className="text-muted">Consequence: </span>
            <span className="text-ink">{consequenceFor(primary.action, primary.fee_usd)}</span>
          </p>
          <Magnetic className="mt-3">
            <Button
              variant={variantFor(primary.action)}
              size="md"
              block
              disabled={!primary.allowed || running !== null}
              loading={running === primary.action}
              onClick={() => openConfirm(primary)}
            >
              {primary.allowed ? ACTION_META[primary.action].label : "Blocked"}
            </Button>
          </Magnetic>
        </div>
      ) : (
        <div className="row-rule px-4 py-3">
          <p className="text-sm text-muted">
            Monitor only — policy recommends no PayPal write for this case.
          </p>
        </div>
      )}

      {secondary.length > 0 ? (
        <ol aria-label="Other PayPal actions">
          {secondary.map((candidate) => {
            const meta = ACTION_META[candidate.action];
            const status = statusFor(detail.actions, candidate.action);
            return (
              <li key={candidate.action} className="row-rule px-4 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base text-ink">{meta.label}</span>
                      <StatusChip status={status} />
                    </div>
                    <p className="mt-0.5 text-sm leading-snug text-muted">
                      {candidate.allowed
                        ? meta.description
                        : candidate.reason ?? "Not available at this stage."}
                    </p>
                    {candidate.paypal_link !== null ? (
                      <a
                        href={candidate.paypal_link}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-flex items-center gap-1 text-sm text-accent hover:underline"
                      >
                        Resolve in PayPal <ExternalLink size={12} />
                      </a>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="num text-sm text-muted">{formatUsd(candidate.fee_usd)}</span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!candidate.allowed}
                      onClick={() => openConfirm(candidate)}
                    >
                      {candidate.allowed ? "Run" : "Blocked"}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <ConfirmDialog
        open={pending !== null}
        title={pending === null ? "Confirm action" : "Confirm " + ACTION_META[pending.action].label.toLowerCase()}
        description={
          pending !== null && pending.allowed
            ? "This is a real PayPal write, recorded against the case telemetry."
            : "Verify the parameters before writing to PayPal."
        }
        confirmLabel={pending === null ? "Confirm" : ACTION_META[pending.action].label}
        tone={pending?.action === "ACCEPT_CLAIM" ? "negative" : undefined}
        loading={running !== null}
        onConfirm={() => void runConfirmed()}
        onCancel={() => {
          setPending(null);
          setError(null);
        }}
      >
        {pending !== null ? (
          <div className="space-y-3">
            {error !== null ? (
              <ErrorBanner error={error} onRetry={() => void runConfirmed()} context="PayPal write failed" />
            ) : null}
            <label className="block">
              <span className="label">Note for the case log</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Optional — stored verbatim in the audit log"
                className="mt-1.5 w-full resize-y rounded-card border border-control bg-raised px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none"
              />
              <span className="num text-2xs text-muted">{note.length}/2000</span>
            </label>

            <dl className="space-y-2 text-sm" aria-label="Action parameters">
              <div className="flex justify-between gap-4">
                <dt className="label">Dispute</dt>
                <dd className="num text-xs text-muted">{shortHash(detail.dispute_id)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="label">Stage</dt>
                <dd className="text-xs text-muted">{STAGE_META[detail.stage].label}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="label">Channel</dt>
                <dd className="text-xs text-muted">{CHANNEL_META[detail.channel].label}</dd>
              </div>
              {pending.paypal_link !== null ? (
                <div className="flex justify-between gap-4">
                  <dt className="label">PayPal route</dt>
                  <dd className="truncate text-xs text-muted">{routeOf(pending.paypal_link)}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        ) : null}
      </ConfirmDialog>
    </Panel>
  );
}
