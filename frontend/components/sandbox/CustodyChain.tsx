"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

import { AnimatedBeam } from "@/components/premium/AnimatedBeam";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { shortHash } from "@/lib/format";
import { EVENT_META } from "@/lib/vocab";
import type { TelemetryEventOut } from "@/lib/types";

export type CustodyChainProps = {
  chainHead: string | null;
  disputeId: string;
  actionLabel: string;
  events: TelemetryEventOut[];
};

function setNode(ref: RefObject<HTMLElement | null>) {
  return (node: HTMLDivElement | null): void => {
    ref.current = node;
  };
}

function Station({
  stationRef,
  label,
  value,
  sub,
  title,
}: {
  stationRef: (node: HTMLDivElement | null) => void;
  label: string;
  value: string;
  sub: string;
  title?: string;
}) {
  return (
    <div ref={stationRef} className="min-w-0 px-3 py-3" title={title}>
      <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-dim">{label}</div>
      <div className="num mt-1 truncate text-[12px] text-ink">{value}</div>
      <div className="mt-0.5 truncate font-mono text-[9.5px] text-dim">{sub}</div>
    </div>
  );
}

/**
 * Evidence in transit: ledger to case to PayPal, with the sealed telemetry
 * events as nodes beneath. Beams travel while the flow runs; under
 * prefers-reduced-motion the hairline frame stands on its own.
 */
export function CustodyChain({ chainHead, disputeId, actionLabel, events }: CustodyChainProps) {
  const containerRef = useRef<HTMLElement | null>(null);
  const ledgerRef = useRef<HTMLElement | null>(null);
  const caseRef = useRef<HTMLElement | null>(null);
  const paypalRef = useRef<HTMLElement | null>(null);

  // Beams are progressive enhancement: they need ResizeObserver (absent in
  // jsdom) and are meaningless under prefers-reduced-motion, where the
  // hairline frame stands on its own.
  const [beamReady, setBeamReady] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setBeamReady(typeof ResizeObserver !== "undefined" && !reduced);
  }, []);

  const sealed = events.slice(0, 4);
  const openSlots = Math.max(0, 4 - sealed.length);

  return (
    <section aria-label="Custody path" className="space-y-2.5">
      <FieldLabel rule tone="ice">
        Custody path
      </FieldLabel>
      <div
        ref={setNode(containerRef)}
        className="relative grid grid-cols-3 divide-x divide-white/[0.06] rounded-lg border border-hairline bg-sunken"
      >
        <Station
          stationRef={setNode(ledgerRef)}
          label="Ledger"
          value={chainHead ? shortHash(chainHead, 8, 6) : "genesis"}
          sub="SHA-256 chain"
          title={chainHead ?? "genesis"}
        />
        <Station
          stationRef={setNode(caseRef)}
          label="Case"
          value={shortHash(disputeId, 12, 4)}
          sub="dispute record"
          title={disputeId}
        />
        <Station
          stationRef={setNode(paypalRef)}
          label="PayPal"
          value={actionLabel}
          sub="resolution centre"
        />
        {beamReady ? (
          <>
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={ledgerRef}
              toRef={caseRef}
              curvature={16}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={caseRef}
              toRef={paypalRef}
              curvature={16}
            />
          </>
        ) : null}
      </div>
      <ol aria-label="Sealed telemetry events" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {sealed.map((event) => (
          <li
            key={event.id}
            className="rounded-md border border-emerald/20 bg-emerald/[0.04] px-2 py-1.5"
            title={event.chain_hash}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="num text-[9.5px] text-dim">
                {String(event.sequence).padStart(2, "0")}
              </span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-emerald" />
            </div>
            <div className="mt-0.5 truncate text-[10.5px] font-medium text-ink">
              {EVENT_META[event.event_type].label}
            </div>
            <div className="num truncate text-[9px] text-dim">
              {shortHash(event.chain_hash, 8, 4)}
            </div>
          </li>
        ))}
        {Array.from({ length: openSlots }, (_, position) => (
          <li
            key={`open-${position}`}
            aria-label={`Event slot ${sealed.length + position + 1} awaiting seal`}
            className="rounded-md border border-dashed border-white/10 px-2 py-1.5"
          >
            <div className="flex items-center justify-between gap-1">
              <span className="num text-[9.5px] text-dim">
                {String(sealed.length + position + 1).padStart(2, "0")}
              </span>
              <span aria-hidden className="h-1 w-1 rounded-full bg-white/20" />
            </div>
            <div className="mt-0.5 text-[10.5px] font-medium text-dim">Awaiting seal</div>
            <div className="num text-[9px] text-dim">run step 2</div>
          </li>
        ))}
      </ol>
      <p className="font-mono text-[9.5px] text-dim">
        {events.length} events · append-only · ledger to case to PayPal
      </p>
    </section>
  );
}
