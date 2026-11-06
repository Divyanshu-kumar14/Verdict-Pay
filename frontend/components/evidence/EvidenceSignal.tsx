"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, Lock, X } from "lucide-react";
import { Fragment } from "react";

import { cn } from "@/lib/cn";
import { SPRING } from "@/lib/motion";

/**
 * The Evidence Signal — VerdictPay's signature provenance motif.
 *
 * A chain of decision/verification checkpoints joined by a line that fills as
 * evidence advances. Each node carries a state; the connector between two
 * nodes reads "satisfied" once the upstream node is verified, so progress is
 * always derived from real workflow state, never invented.
 *
 * Reused by the transaction pipeline (Command Centre), the custody chain, and
 * the signed-webhook verification flow (Connection).
 */
export type SignalNodeState = "locked" | "pending" | "active" | "verified" | "failed";

export type SignalStep = {
  id: string;
  label: string;
  meta?: string;
  state: SignalNodeState;
};

function NodeGlyph({ state, index }: { state: SignalNodeState; index: number }) {
  if (state === "verified") {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-positive/40 text-positive">
        <Check size={14} strokeWidth={2.4} aria-hidden />
      </span>
    );
  }
  if (state === "failed") {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-negative/40 text-negative">
        <X size={13} strokeWidth={2.4} aria-hidden />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="relative grid h-7 w-7 shrink-0 place-items-center rounded-full border border-accent text-accent">
        <motion.span
          aria-hidden
          className="absolute -inset-1 rounded-full border border-accent/40"
          animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
          transition={{ repeat: Infinity, duration: 2.2, ease: "easeOut" }}
        />
        <span className="h-2 w-2 rounded-full bg-accent" />
      </span>
    );
  }
  const locked = state === "locked";
  return (
    <span
      className={cn(
        "grid h-7 w-7 shrink-0 place-items-center rounded-full border text-xs font-medium num",
        locked ? "border-control text-muted" : "border-line text-muted",
      )}
    >
      {locked ? <Lock size={11} aria-hidden /> : index + 1}
    </span>
  );
}

/** The hairline between two nodes: a ground rule with an accent fill + moving pulse. */
export function SignalConnector({
  filled,
  active,
  className,
}: {
  filled: boolean;
  active?: boolean;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div aria-hidden className={cn("relative h-px flex-1 self-center overflow-hidden", className)}>
      <span className="absolute inset-0 bg-rule" />
      <motion.span
        className="absolute inset-0 origin-left bg-accent"
        initial={false}
        animate={{ scaleX: filled ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : SPRING}
      />
      {active && !reduced ? (
        <motion.span
          className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-accent"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
        />
      ) : null}
    </div>
  );
}

export type EvidenceSignalProps = {
  steps: SignalStep[];
  orientation?: "horizontal" | "vertical";
  className?: string;
};

/**
 * Renders the chain. Connectors read filled from the upstream node's verified
 * state; an active node also pulses its outgoing connector so direction reads.
 */
export function EvidenceSignal({
  steps,
  orientation = "horizontal",
  className,
}: EvidenceSignalProps) {
  const reduced = useReducedMotion() ?? false;
  const vertical = orientation === "vertical";

  return (
    <ol role="list" className={cn("flex", vertical ? "flex-col" : "items-start", className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const filled = step.state === "verified";
        return (
          <Fragment key={step.id}>
            <li className={cn("flex min-w-0", vertical ? "items-start gap-3" : "flex-col gap-2")}>
              {vertical ? (
                <div className="flex flex-col items-center self-stretch">
                  <NodeGlyph state={step.state} index={index} />
                  {!isLast ? (
                    <div className="my-0.5 w-px flex-1 self-center overflow-hidden">
                      <span className="block h-full w-full bg-rule" />
                      <motion.span
                        className="block w-full origin-top bg-accent"
                        initial={false}
                        animate={{ scaleY: filled ? 1 : 0 }}
                        transition={reduced ? { duration: 0 } : SPRING}
                      />
                    </div>
                  ) : null}
                </div>
              ) : (
                <motion.span
                  initial={reduced ? false : { scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={reduced ? { duration: 0 } : SPRING}
                >
                  <NodeGlyph state={step.state} index={index} />
                </motion.span>
              )}

              <div className={cn("min-w-0", !vertical && "pr-2")}>
                <p
                  className={cn(
                    "text-xs font-medium leading-tight",
                    step.state === "locked" ? "text-muted" : "text-ink",
                  )}
                >
                  {step.label}
                </p>
                {step.meta ? (
                  <p className="mt-0.5 truncate text-2xs text-muted" title={step.meta}>
                    {step.meta}
                  </p>
                ) : null}
              </div>
            </li>

            {!isLast && !vertical ? (
              <SignalConnector
                filled={filled}
                active={step.state === "active"}
                className="mt-3.5"
              />
            ) : null}
          </Fragment>
        );
      })}
    </ol>
  );
}
