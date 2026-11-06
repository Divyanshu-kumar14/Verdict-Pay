"use client";

import { useState } from "react";
import { CircleCheck, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatLatency, formatPercent, formatUsd } from "@/lib/format";
import type { ActionResponse, AllowedAction, DisputeAction, DisputeDetail } from "@/lib/types";
import { ACTION_META, CHANNEL_META, RECOMMENDATION_META, STAGE_META } from "@/lib/vocab";
import { DISPUTE_ACTIONS } from "@/lib/types";

/**
 * The HATEOAS action rail. Buttons are enabled only when the returned
 * links[] allow the action; every irreversible action passes a confirm dialog.
 */

/* The rail shows the PayPal route, not the full URL: the host is the same on every row and
   a 60-character query string tells a reader nothing. The complete link stays in the title. */
function routeOf(link: string): string {
  try {
    const url = new URL(link);
    return url.pathname + url.search;
  } catch {
    return link;
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
    if (action === "ACCEPT_CLAIM") {
      return "Accepting concedes " + formatUsd(detail.amount_usd) + " and incurs " + formatUsd(feeUsd) + " in PayPal fees. The case closes.";
    }
    if (action === "PROVIDE_EVIDENCE") {
      return "Filing costs " + formatUsd(feeUsd) + " and risks " + formatUsd(Math.abs(detail.breakdown.ev_settle_usd)) + " if the claim is lost.";
    }
    if (action === "MAKE_OFFER") {
      return "Offer outlay " + formatUsd(Math.abs(detail.breakdown.ev_offer_usd)) + " (" + formatPercent(detail.breakdown.offer_ratio, 0) + " of the claim); no dispute fee at the inquiry stage.";
    }
    return "No PayPal fee at the " + STAGE_META[detail.stage].label.toLowerCase() + " stage; the case stays open for the buyer response.";
  };

  const orderedActions: AllowedAction[] = DISPUTE_ACTIONS.map((action) => {
    const exposed = detail.allowed_actions.find((candidate) => candidate.action === action);
    if (exposed) return exposed;
    return {
      action,
      allowed: false,
      reason: "PayPal did not expose this action for the case.",
      fee_usd: 0,
      paypal_link: null,
    };
  });

  const openCount = detail.allowed_actions.filter((candidate) => candidate.allowed).length;

  const runConfirmed = async (): Promise<void> => {
    if (!pending || running) return;
    const action = pending.action;
    setRunning(action);
    setError(null);
    setResult(null);
    try {
      const response = await api.performAction(detail.dispute_id, action, {
        ...(note.trim().length > 0 ? { note: note.trim() } : {}),
        idempotency_key: detail.dispute_id + ":" + action + ":" + String(Date.now()),
      });
      setResult(response);
      setPending(null);
      setNote("");
      onCompleted();
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setRunning(null);
    }
  };

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="PayPal response"
        description={"Enabled only when the case's allowed_actions expose the action at this stage."}
        actions={
          <Badge tone="neutral">
            {openCount + " / " + String(DISPUTE_ACTIONS.length) + " open"}
          </Badge>
        }
      />

      {result ? (
        <div
          role="status"
          className="row-rule flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm"
        >
          <CircleCheck
            size={13}
            aria-hidden
            className={cn("shrink-0", result.status === "EXECUTED" ? "text-positive" : "text-warning")}
          />
          <span className={cn("font-medium", result.status === "EXECUTED" ? "text-positive" : "text-warning")}>
            {result.status}
          </span>
          <span className="text-muted">{ACTION_META[result.action].label}</span>
          <span className="num ml-auto text-2xs text-muted">{formatLatency(result.latency_ms)}</span>
        </div>
      ) : null}

      {error && !pending ? (
        <div className="row-rule px-4 py-3">
          <ErrorBanner error={error} context="Action failed." />
        </div>
      ) : null}

      <ol aria-label="Available PayPal actions">
        {orderedActions.map((candidate) => {
          const meta = ACTION_META[candidate.action];
          const isRecommended = candidate.action === recommendedAction;
          return (
            <li
              key={candidate.action}
              className={cn("relative row-rule px-4 py-3", isRecommended && "sig-edge")}
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-base font-medium text-ink">{meta.label}</span>
                    {isRecommended ? <span className="text-sm text-muted">Recommended</span> : null}
                  </div>
                  <p className="mt-0.5 text-sm leading-snug text-muted">
                    {candidate.allowed
                      ? meta.description
                      : (candidate.reason ?? "Not available at this stage")}
                  </p>
                  {candidate.paypal_link ? (
                    <p
                      className="mt-1 flex min-w-0 items-center gap-1 text-sm text-muted"
                      title={candidate.paypal_link}
                    >
                      <ExternalLink size={12} aria-hidden className="shrink-0" />
                      <span className="truncate">{routeOf(candidate.paypal_link)}</span>
                    </p>
                  ) : null}
                </div>
                <span className="num shrink-0 text-sm text-muted">{formatUsd(candidate.fee_usd)}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={!candidate.allowed}
                  onClick={() => {
                    setPending(candidate);
                    setError(null);
                    setNote("");
                  }}
                >
                  {candidate.allowed ? "Run" : "Blocked"}
                </Button>
              </div>
            </li>
          );
        })}
      </ol>

      {pending ? (
        <ConfirmDialog
          open
          title={ACTION_META[pending.action].label + " this case?"}
          description={"This writes to PayPal's dispute lifecycle. The case is never updated optimistically."}
          confirmLabel={ACTION_META[pending.action].label}
          tone={pending.action === "ACCEPT_CLAIM" ? "negative" : "positive"}
          loading={running !== null}
          onConfirm={() => {
            void runConfirmed();
          }}
          onCancel={() => {
            if (running) return;
            setPending(null);
            setError(null);
          }}
        >
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="label">Stage</dt>
                <dd className="mt-1">
                  <Badge tone={STAGE_META[detail.stage].tone}>{STAGE_META[detail.stage].short}</Badge>
                </dd>
              </div>
              <div>
                <dt className="label">Channel</dt>
                <dd className="mt-1">
                  <Badge tone={CHANNEL_META[detail.channel].tone}>{CHANNEL_META[detail.channel].short}</Badge>
                </dd>
              </div>
              <div>
                <dt className="label">PayPal fee</dt>
                <dd className="num mt-1 text-base text-ink">{formatUsd(pending.fee_usd)}</dd>
              </div>
              <div>
                <dt className="label">Dispute</dt>
                <dd className="num mt-1 break-all text-2xs text-muted">{detail.dispute_id}</dd>
              </div>
            </dl>

            <p className="row-rule pt-3 text-sm leading-snug text-muted">
              <span className="text-ink">Consequence: </span>
              {consequenceFor(pending.action, pending.fee_usd)}
            </p>

            <label className="block">
              <span className="label">Note to PayPal (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Shown in the PayPal resolution centre."
                className="mt-1.5 w-full resize-none rounded-card border border-control bg-raised px-3 py-2 text-sm text-ink placeholder:text-muted"
              />
              <span className="num mt-1 block text-right text-2xs text-muted">
                {note.length}/2000
              </span>
            </label>

            {error ? (
              <ErrorBanner
                error={error}
                context="The action did not complete; no case state was changed locally."
              />
            ) : null}
          </div>
        </ConfirmDialog>
      ) : null}
    </Panel>
  );
}
