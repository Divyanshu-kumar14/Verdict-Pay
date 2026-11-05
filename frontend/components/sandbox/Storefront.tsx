"use client";

import { motion } from "motion/react";
import { AlertTriangle, Check, RotateCcw, Store } from "lucide-react";
import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel } from "@/components/ui/Panel";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { StepLog } from "@/components/sandbox/StepLog";
import { cn } from "@/lib/cn";
import { DEMO_BUYER_EMAIL, DEMO_PLAN } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import type { SandboxFlowState, StepStatus } from "@/lib/hooks/useSandboxFlow";

const HINT: Record<StepStatus, string> = {
  idle: "Ready",
  running: "Running",
  success: "Done",
  error: "Retry",
};

const HINT_CLASS: Record<StepStatus, string> = {
  idle: "text-dim",
  running: "text-amber",
  success: "text-emerald",
  error: "text-rose",
};

const NUMBER_BOX: Record<StepStatus, string> = {
  idle: "border-hairline bg-white/[0.03] text-muted",
  running: "border-amber/30 bg-amber/10 text-amber",
  success: "border-emerald/30 bg-emerald/10 text-emerald",
  error: "border-rose/30 bg-rose/10 text-rose",
};

function StepButton({
  index,
  title,
  subtitle,
  status,
  disabled,
  onRun,
}: {
  index: number;
  title: string;
  subtitle: string;
  status: StepStatus;
  disabled: boolean;
  onRun: () => void;
}) {
  const sheenRef = useRef<HTMLSpanElement | null>(null);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const sheen = sheenRef.current;
    if (sheen === null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    sheen.style.background =
      `radial-gradient(240px circle at ${x}px ${y}px, rgba(255,255,255,0.08), transparent 65%)`;
    sheen.style.opacity = "1";
  }, []);

  const onPointerLeave = useCallback(() => {
    const sheen = sheenRef.current;
    if (sheen !== null) sheen.style.opacity = "0";
  }, []);

  return (
    <motion.button
      type="button"
      onClick={onRun}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      disabled={disabled || status === "running"}
      whileTap={disabled || status === "running" ? undefined : { scale: 0.985 }}
      transition={{ type: "spring", stiffness: 520, damping: 32 }}
      aria-label={`Step ${index}: ${title} — ${HINT[status]}`}
      className={cn(
        "relative flex w-full items-start gap-3 overflow-hidden rounded-lg border px-3 py-3 text-left transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        status === "success" && "border-emerald/25 bg-emerald/[0.05]",
        status === "error" && "border-rose/30 bg-rose/[0.06]",
        status === "running" && "border-amber/30 bg-amber/[0.06]",
        status === "idle" &&
          !disabled &&
          "border-hairline bg-white/[0.02] hover:border-emerald/25 hover:bg-emerald/[0.04]",
        status === "idle" && disabled && "border-hairline bg-white/[0.01] opacity-55",
        disabled || status === "running" ? "cursor-not-allowed" : "cursor-pointer",
      )}
    >
      <span
        ref={sheenRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
      />
      <span className="relative min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="text-[12.5px] font-medium tracking-[-0.01em] text-ink">{title}</span>
          <span
            className={cn(
              "shrink-0 text-[9px] font-semibold uppercase tracking-[0.12em]",
              HINT_CLASS[status],
            )}
          >
            {HINT[status]}
          </span>
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted">{subtitle}</span>
        {status === "running" ? (
          <span className="mt-2 block h-px overflow-hidden rounded bg-white/[0.07]">
            <span className="block h-full w-1/3 animate-pulse bg-amber/70" />
          </span>
        ) : null}
      </span>
    </motion.button>
  );
}

export type StorefrontProps = {
  state: SandboxFlowState;
  onCheckout: () => Promise<void>;
  onUsage: () => Promise<void>;
  onDispute: () => Promise<void>;
  onReset: () => void;
};

function StepRailMarker({ status }: { status: StepStatus }) {
  return (
    <span
      aria-hidden
      className={cn(
        "num grid h-6 w-6 shrink-0 place-items-center rounded border",
        NUMBER_BOX[status],
      )}
    >
      {status === "success" ? (
        <Check size={12} aria-hidden />
      ) : status === "error" ? (
        <AlertTriangle size={12} aria-hidden />
      ) : status === "running" ? (
        <span className="h-2.5 w-2.5 animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        <span className="text-[10.5px]">·</span>
      )}
    </span>
  );
}

/** The buyer side of the demo: a mock SaaS checkout plus three sequential steps. */
export function Storefront({ state, onCheckout, onUsage, onDispute, onReset }: StorefrontProps) {
  const busy =
    state.checkoutStatus === "running" ||
    state.usageStatus === "running" ||
    state.disputeStatus === "running";

  const canCheckout = !busy && state.checkoutStatus !== "success";
  const canUsage = !busy && state.checkoutStatus === "success" && state.usageStatus !== "success";
  const canDispute = !busy && state.usageStatus === "success" && state.disputeStatus !== "success";

  const retry =
    state.disputeStatus === "error"
      ? onDispute
      : state.usageStatus === "error"
        ? onUsage
        : state.checkoutStatus === "error"
          ? onCheckout
          : null;

  const steps = [
    {
      key: "checkout",
      index: 1,
      title: "Checkout $99 Pro plan",
      subtitle: "PayPal Orders v2 · Subscriptions v1 · ToS captured",
      status: state.checkoutStatus,
      canRun: canCheckout,
      run: onCheckout,
    },
    {
      key: "usage",
      index: 2,
      title: "Simulate usage",
      subtitle: "15 logins · 42k AI tokens · signed ZIP export",
      status: state.usageStatus,
      canRun: canUsage,
      run: onUsage,
    },
    {
      key: "dispute",
      index: 3,
      title: "File friendly-fraud dispute",
      subtitle: "SNAD · INQUIRY · internal channel · $99 claim",
      status: state.disputeStatus,
      canRun: canDispute,
      run: onDispute,
    },
  ];

  return (
    <Panel className="flex min-h-[660px] flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-hairline px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded border border-hairline bg-white/[0.03]">
            <Store size={13} className="text-muted" aria-hidden />
          </span>
          <span className="kicker">Buyer storefront</span>
        </div>
        <Badge tone="neutral" mono>
          TEST BUYER
        </Badge>
      </div>

      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-hairline bg-[#0b1117]">
          <div className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3">
            <div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-dim">
                {DEMO_PLAN.product}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
                  {DEMO_PLAN.name}
                </h2>
                <span className="num text-[21px] font-medium tracking-[-0.02em] text-ink">
                  {formatUsd(DEMO_PLAN.priceUsd)}
                </span>
                <span className="text-[11px] text-muted">/ month</span>
              </div>
            </div>
            <Badge tone="emerald" dot>
              RECURRING
            </Badge>
          </div>
          <ul className="space-y-1.5 px-4 py-3">
            {DEMO_PLAN.features.map((feature) => (
              <li key={feature} className="flex items-start gap-2 text-[11.5px] text-muted">
                <Check size={11} className="mt-0.5 shrink-0 text-emerald" aria-hidden />
                {feature}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-hairline px-4 py-2.5 font-mono text-[10px] text-dim">
            <span>{DEMO_BUYER_EMAIL}</span>
            <span>{DEMO_PLAN.currency} · via PayPal</span>
          </div>
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <FieldLabel>Judge flow</FieldLabel>
            <span className="text-[10px] text-dim">Sequential · each step unlocks the next</span>
          </div>
          <ol className="space-y-1.5">
            {steps.map((step, position) => (
              <li key={step.key} className="flex gap-3">
                <span aria-hidden className="flex w-6 flex-col items-center">
                  <StepRailMarker status={step.status} />
                  {position < steps.length - 1 ? (
                    <span
                      className={cn(
                        "mt-1 w-px flex-1",
                        step.status === "success" ? "bg-emerald/50" : "bg-white/[0.08]",
                      )}
                    />
                  ) : null}
                </span>
                <div className="min-w-0 flex-1 pb-0.5">
                  <StepButton
                    index={step.index}
                    title={step.title}
                    subtitle={step.subtitle}
                    status={step.status}
                    disabled={!step.canRun}
                    onRun={() => {
                      void step.run();
                    }}
                  />
                </div>
              </li>
            ))}
          </ol>
        </div>

        {state.error ? (
          <ErrorBanner
            error={state.error}
            context="The step stopped before it changed server state. Fix the connection and retry."
            onRetry={
              retry
                ? () => {
                    void retry();
                  }
                : undefined
            }
          />
        ) : null}
      </div>

      <div className="mt-auto">
        <div className="flex items-center justify-between gap-3 border-t border-hairline px-4 py-2.5">
          <p className="text-[10.5px] leading-snug text-muted">
            Reset clears the local flow and reloads merchant state from the API.
          </p>
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw size={12} aria-hidden />}
            onClick={onReset}
          >
            Reset
          </Button>
        </div>
        <StepLog logs={state.logs} />
      </div>
    </Panel>
  );
}
