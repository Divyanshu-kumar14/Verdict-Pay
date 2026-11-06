"use client";

import { cn } from "@/lib/cn";
import { shortHash } from "@/lib/format";
import type { TelemetryEventOut, TelemetryEventType } from "@/lib/types";
import { EVENT_META } from "@/lib/vocab";

const SLOT_ORDER: TelemetryEventType[] = [
  "TOS_ACCEPTED",
  "SESSION_AUTH",
  "ASSET_DELIVERED",
  "USAGE_METERED",
];

export type CustodyChainProps = {
  chainHead: string | null;
  disputeId: string;
  actionLabel: string;
  events: TelemetryEventOut[];
};

/**
 * Evidence in transit: a hairline rail of the four events that have to be
 * sealed before the case can be filed. A dot marks each slot, the seal state is
 * a word, and a slot that has not landed yet reads "Awaiting seal".
 */
export function CustodyChain({ chainHead, disputeId, actionLabel, events }: CustodyChainProps) {
  return (
    <section aria-label="Custody chain" className="panel">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3.5">
        <h2 className="title-section">Custody chain</h2>
        <span className="num text-xs text-muted">{events.length} sealed events</span>
      </div>

      <p className="row-rule px-4 py-2.5 text-xs text-muted">
        Case{" "}
        <span className="num text-ink" title={disputeId}>
          {shortHash(disputeId, 12, 4)}
        </span>
        . Chain head{" "}
        <span className="num text-ink" title={chainHead ?? "genesis"}>
          {chainHead ? shortHash(chainHead, 8, 6) : "genesis"}
        </span>
        . Next filing: <span className="text-ink">{actionLabel}</span>.
      </p>

      <ol aria-label="Sealed telemetry events" className="relative px-4 py-2">
        <span
          aria-hidden
          className="absolute top-5 bottom-5 left-[19px] w-px bg-rule"
        />
        {SLOT_ORDER.map(function (eventType) {
          const sealed = events.find(function (candidate) {
            return candidate.event_type === eventType;
          });
          return (
            <li key={eventType} className="relative flex items-start gap-3 py-2">
              <span
                aria-hidden
                className={cn(
                  "relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full",
                  sealed ? "bg-positive" : "bg-control",
                )}
              />
              <div className="min-w-0 flex-1">
                <p className="text-base text-ink">{EVENT_META[eventType].label}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {sealed ? "Sealed" : "Awaiting seal"}
                </p>
              </div>
              <span
                className="num shrink-0 text-xs text-muted"
                title={sealed?.chain_hash}
              >
                {sealed ? shortHash(sealed.chain_hash, 8, 4) : "--"}
              </span>
            </li>
          );
        })}
      </ol>

      <p className="row-rule px-4 py-2.5 text-xs text-muted">
        Append-only ledger per payer stream, sealed in order.
      </p>
    </section>
  );
}
