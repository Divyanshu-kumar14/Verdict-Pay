"use client";

import { useState } from "react";
import { CircleCheck, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";
import { formatPercent, formatUsd } from "@/lib/format";
import type { ActionResponse, AllowedAction, DisputeAction, DisputeDetail } from "@/lib/types";
import { ACTION_META, CHANNEL_META, RECOMMENDATION_META, STAGE_META } from "@/lib/vocab";
import { DISPUTE_ACTIONS } from "@/lib/types";

/**
 * The HATEOAS action rail. Buttons are enabled only when the returned
 * links[] allow the action; every irreversible action passes a confirm dialog.
 */
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
      return "Offer outlay " + formatUsd(Math.abs(detail.breakdown.ev_offer_usd)) + " (" + formatPercent(detail.breakdown.offer_ratio, 0) + " of the claim); no dispute fee at INQUIRY.";
    }
    return "No PayPal fee at " + detail.stage + " stage; the inquiry stays open for the buyer response.";
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
    <SpotlightCard className="p-4 sm:p-5" >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <FieldLabel rule tone="ice">
            Action rail · PayPal response
          </FieldLabel>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-muted">
            Enabled only when the case&#39;s allowed_actions expose the action at this stage.
          </p>
        </div>
        <Badge tone="neutral" mono>
          {detail.allowed_actions.filter((candidate) => candidate.allowed).length} /{" "}
          {DISPUTE_ACTIONS.length} open
        </Badge>
      </div>

      <div className="mt-3 space-y-2.5">
        {result ? (
          <div
            role="status"
            className={cn(
              "flex flex-wrap items-center gap-2 rounded-md border px-2.5 py-2 text-[10.5px]",
              result.status === "EXECUTED"
                ? "border-emerald/25 bg-emerald/[0.06] text-emerald"
                : "border-amber/25 bg-amber/[0.06] text-amber",
            )}
          >
            <CircleCheck size={12} aria-hidden />
            <span className="font-medium">{result.status}</span>
            <span className="text-muted">{ACTION_META[result.action].label}</span>
            <span className="num ml-auto text-dim">{result.latency_ms}ms</span>
          </div>
        ) : null}

        {error && !pending ? <ErrorBanner error={error} context="Action failed." /> : null}

        <ol className="space-y-2" aria-label="Available PayPal actions">
          {orderedActions.map((candidate, index) => {
            const meta = ACTION_META[candidate.action];
            const isRecommended = candidate.action === recommendedAction;
            return (
              <li
                key={candidate.action}
                className={cn(
                  "rounded-lg border p-2.5",
                  isRecommended
                    ? "border-emerald/30 bg-emerald/[0.04]"
                    : "border-hairline bg-white/[0.012]",
                )}
              >
                <div className="flex items-start gap-2.5">
                  <span className="num mt-0.5 font-mono text-[10px] text-dim" aria-hidden>
                    {"0" + String(index + 1)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[12px] font-medium text-ink">{meta.label}</span>
                      {isRecommended ? (
                        <Badge tone="emerald" dot>
                          RECOMMENDED
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-muted">{meta.description}</p>
                  </div>
                  <span className="num shrink-0 text-[11px] text-muted">
                    {formatUsd(candidate.fee_usd)}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 pl-7">
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-[9.5px] leading-snug",
                      candidate.allowed ? "text-dim" : "text-rose",
                    )}
                    title={candidate.reason ?? undefined}
                  >
                    {candidate.allowed
                      ? "Exposed by allowed_actions"
                      : (candidate.reason ?? "Not available at this stage")}
                  </span>
                  <Button
                    size="sm"
                    variant={isRecommended ? "primary" : "secondary"}
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

                {candidate.paypal_link ? (
                  <p
                    className="mt-1.5 flex items-center gap-1 truncate pl-7 font-mono text-[8.5px] text-dim"
                    title={candidate.paypal_link}
                  >
                    <ExternalLink size={9} aria-hidden />
                    {candidate.paypal_link}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {pending ? (
        <ConfirmDialog
          open
          title={ACTION_META[pending.action].label + " this case?"}
          description="This writes to PayPal&#39;s dispute lifecycle. The case is never updated optimistically."
          confirmLabel={ACTION_META[pending.action].label}
          tone={pending.action === "ACCEPT_CLAIM" ? "rose" : "emerald"}
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
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="kicker">Stage</dt>
                <dd className="mt-0.5">
                  <Badge tone={STAGE_META[detail.stage].tone}>{STAGE_META[detail.stage].short}</Badge>
                </dd>
              </div>
              <div>
                <dt className="kicker">Channel</dt>
                <dd className="mt-0.5">
                  <Badge tone={CHANNEL_META[detail.channel].tone} mono>
                    {CHANNEL_META[detail.channel].short}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt className="kicker">PayPal fee</dt>
                <dd className="num mt-0.5 text-[13px] text-ink">{formatUsd(pending.fee_usd)}</dd>
              </div>
              <div>
                <dt className="kicker">Dispute</dt>
                <dd className="num mt-0.5 break-all text-[9.5px] text-muted">{detail.dispute_id}</dd>
              </div>
            </dl>

            <p className="rounded-md border border-hairline bg-white/[0.02] px-2.5 py-2 text-[10.5px] leading-snug text-muted">
              <span className="text-ink">Consequence · </span>
              {consequenceFor(pending.action, pending.fee_usd)}
            </p>

            <label className="block">
              <span className="kicker">Note to PayPal (optional)</span>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={2000}
                rows={3}
                placeholder="Shown in the PayPal resolution centre."
                className="mt-1 w-full resize-none rounded-md border border-border-strong bg-chrome px-2.5 py-2 text-[11.5px] text-ink placeholder:text-dim"
              />
              <span className="num mt-0.5 block text-right font-mono text-[9px] text-dim">
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
    </SpotlightCard>
  );
}
