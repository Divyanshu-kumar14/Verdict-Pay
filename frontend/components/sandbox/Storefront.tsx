"use client";

import { motion, useReducedMotion } from "motion/react";
import { CircleCheck, CreditCard, Lock, RotateCcw, X } from "lucide-react";

import { StepLog } from "@/components/sandbox/StepLog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { DEMO_BUYER_EMAIL, DEMO_MERCHANT_NAME, DEMO_PLAN } from "@/lib/constants";
import { formatPercent, formatUsd, shortHash } from "@/lib/format";
import type { SandboxFlowState, StepStatus } from "@/lib/hooks/useSandboxFlow";
import { SPRING } from "@/lib/motion";
import { CHANNEL_META, REASON_META, STAGE_META, type Tone } from "@/lib/vocab";

const STEP_BADGE: Record<StepStatus, { label: string; tone: Tone }> = {
  idle: { label: "Ready", tone: "neutral" },
  running: { label: "Running", tone: "warning" },
  success: { label: "Done", tone: "positive" },
  error: { label: "Failed", tone: "negative" },
};

/** A step beyond its raw status: what the rail draws and whether it can run. */
type RailState = "completed" | "active" | "failed" | "locked";

function railState(status: StepStatus, canRun: boolean): RailState {
  if (status === "success") return "completed";
  if (status === "error") return "failed";
  if (status === "running") return "active";
  return canRun ? "active" : "locked";
}

function StepIndicator({
  rail,
  index,
  running,
  reduced,
}: {
  rail: RailState;
  index: number;
  running: boolean;
  reduced: boolean;
}) {
  if (rail === "completed") {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-positive text-ground">
        <CircleCheck size={15} aria-hidden />
      </span>
    );
  }
  if (rail === "failed") {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-negative text-ground">
        <X size={14} aria-hidden />
      </span>
    );
  }
  if (running) {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-accent bg-pill-accent">
        <span
          aria-hidden
          className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent"
        />
      </span>
    );
  }
  const locked = rail === "locked";
  const node = (
    <span
      className={cn(
        "grid h-7 w-7 place-items-center rounded-full border text-xs font-medium num",
        locked ? "border-control text-muted" : "border-accent bg-pill-accent text-accent",
      )}
    >
      {index + 1}
    </span>
  );
  if (locked) return node;
  return (
    <motion.span
      initial={reduced ? false : { scale: 0.7, opacity: 0.5 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduced ? { duration: 0 } : SPRING}
      className="inline-flex"
    >
      {node}
    </motion.span>
  );
}

function Connector({ filled, reduced }: { filled: boolean; reduced: boolean }) {
  return (
    <div aria-hidden className="relative my-1 w-px flex-1 overflow-hidden">
      <span className="absolute inset-0 bg-rule" />
      <motion.span
        className="absolute inset-0 origin-top bg-accent"
        initial={false}
        animate={{ scaleY: filled ? 1 : 0 }}
        transition={reduced ? { duration: 0 } : SPRING}
      />
    </div>
  );
}

/** The storefront as a real merchant checkout: identity, plan, price, benefits, PayPal. */
function MerchantCheckout() {
  return (
    <section aria-label="Plan on sale" className="panel-raised min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3.5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-card bg-pill-accent font-semibold text-accent">
          A
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-ink">{DEMO_MERCHANT_NAME}</p>
          <p className="text-xs text-muted">Merchant</p>
        </div>
        <Badge tone="neutral" size="sm" className="ml-auto shrink-0">
          Secure checkout
        </Badge>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="title-card">{DEMO_PLAN.name} plan</h3>
            <p className="mt-0.5 text-sm text-muted">
              {DEMO_PLAN.product} · {DEMO_PLAN.cadence}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num text-xl font-semibold text-ink">{formatUsd(DEMO_PLAN.priceUsd)}</p>
            <p className="text-xs text-muted">{DEMO_PLAN.cadence}</p>
          </div>
        </div>

        <div className="mt-4 rounded-card border border-line bg-surface px-3 py-2.5">
          <p className="label">Included usage</p>
          <p className="mt-0.5 text-sm text-ink">{DEMO_PLAN.features[0]}</p>
        </div>

        <ul className="mt-4 space-y-2">
          {DEMO_PLAN.features.slice(1).map((feature) => (
            <li key={feature} className="flex items-start gap-2.5 text-sm text-ink">
              <CircleCheck size={14} className="mt-0.5 shrink-0 text-positive" aria-hidden />
              <span className="min-w-0">{feature}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4">
          <p className="label">Payment method</p>
          <div className="mt-1.5 flex items-center gap-3 rounded-card border border-line bg-surface px-3 py-2.5">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-raised text-ink">
              <CreditCard size={14} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base text-ink">PayPal</p>
              <p className="text-xs text-muted">Billed monthly · auto-renews</p>
            </div>
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Lock size={12} aria-hidden />
              Secured
            </span>
          </div>
        </div>

        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <div className="flex gap-1.5">
            <dt>Receipt</dt>
            <dd className="num text-ink">{DEMO_BUYER_EMAIL}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Billed in</dt>
            <dd className="text-ink">{DEMO_PLAN.currency} via PayPal</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

export type StorefrontProps = {
  state: SandboxFlowState;
  onCheckout: () => Promise<void>;
  onUsage: () => Promise<void>;
  onDispute: () => Promise<void>;
  onReset: () => void;
};

/**
 * The buyer side of the demo: a merchant checkout card beside a connected
 * three-step progress rail. The next runnable step carries the only primary
 * button; locked steps wait on their dependency.
 */
export function Storefront({ state, onCheckout, onUsage, onDispute, onReset }: StorefrontProps) {
  const reduced = useReducedMotion() ?? false;

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
      successDetail: state.checkout
        ? `order ${shortHash(state.checkout.order_id, 10, 4)} · payer ${shortHash(state.checkout.payer_id, 8, 4)} · ${formatUsd(state.checkout.amount_usd)}`
        : null,
      action: "Run checkout",
      status: state.checkoutStatus,
      canRun: canCheckout,
      run: onCheckout,
    },
    {
      key: "usage",
      index: 2,
      title: "Simulate usage",
      subtitle: "15 logins · 42k AI tokens · signed ZIP export",
      successDetail: state.usage
        ? `${state.usage.events.length} events chained · head ${shortHash(state.usage.chain.head_hash, 8, 4)} · chain ${state.usage.chain.valid ? "valid" : "broken"}`
        : null,
      action: "Run usage",
      status: state.usageStatus,
      canRun: canUsage,
      run: onUsage,
    },
    {
      key: "dispute",
      index: 3,
      title: "File friendly-fraud dispute",
      subtitle:
        REASON_META.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED.short +
        " · " +
        STAGE_META.INQUIRY.short +
        " · " +
        CHANNEL_META.INTERNAL.short +
        " · " +
        formatUsd(DEMO_PLAN.priceUsd) +
        " claim",
      successDetail: state.dispute
        ? `${STAGE_META.INQUIRY.short} ${shortHash(state.dispute.dispute.dispute_id, 10, 4)} · p(win) ${formatPercent(state.dispute.dispute.p_win)}`
        : null,
      action: "File dispute",
      status: state.disputeStatus,
      canRun: canDispute,
      run: onDispute,
    },
  ];

  const nextKey = steps.find((step) => step.status !== "success" && step.canRun)?.key ?? null;

  return (
    <Panel>
      <PanelHeader
        title="Buyer storefront"
        description="A real merchant checkout on the left, the sequential demo flow on the right."
        actions={
          <Badge tone="neutral" size="sm">
            Test buyer
          </Badge>
        }
      />
      <PanelBody className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <MerchantCheckout />

        <section aria-label="Demo flow" className="min-w-0">
          <h3 className="title-card">Demo flow</h3>
          <p className="mt-1 text-sm text-muted">
            Sequential — each step unlocks the next, each button hits the real API.
          </p>

          <ol role="list" className="mt-3">
            {steps.map((step, index) => {
              const rail = railState(step.status, step.canRun);
              const badge = STEP_BADGE[step.status];
              const isNext = step.key === nextKey;
              const isRunning = step.status === "running";
              const isLast = index === steps.length - 1;
              const detail =
                rail === "completed" && step.successDetail ? step.successDetail : step.subtitle;
              return (
                <li key={step.key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
                  <div className="flex flex-col items-center">
                    <StepIndicator rail={rail} index={index} running={isRunning} reduced={reduced} />
                    {!isLast ? <Connector filled={step.status === "success"} reduced={reduced} /> : null}
                  </div>
                  <div className="min-w-0 pb-4">
                    <div
                      className={cn(
                        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1",
                        isNext && "sig inline-flex",
                      )}
                    >
                      <p
                        className={cn(
                          "text-base font-medium",
                          rail === "locked" ? "text-muted" : "text-ink",
                        )}
                      >
                        {step.title}
                      </p>
                      <Badge
                        tone={rail === "locked" ? "neutral" : badge.tone}
                        size="sm"
                        title={rail === "locked" ? "Unlocks when the previous step completes" : undefined}
                      >
                        {rail === "locked" ? "Locked" : badge.label}
                      </Badge>
                    </div>

                    <p className={cn("mt-0.5 break-words text-sm", rail === "completed" ? "text-positive" : "text-muted")}>
                      {detail}
                    </p>

                    {isRunning ? (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-warning">
                        <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-warning" />
                        Executing — state settles when the API returns
                      </p>
                    ) : null}

                    <div className="mt-2.5">
                      <Button
                        size="sm"
                        variant={isNext ? "primary" : "secondary"}
                        loading={isRunning}
                        disabled={!step.canRun}
                        aria-label={`${step.action} (step ${step.index} of 3: ${step.title}, ${rail === "locked" ? "locked" : badge.label})`}
                        onClick={() => {
                          void step.run();
                        }}
                      >
                        {step.action}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>

          {state.error ? (
            <ErrorBanner
              className="mt-1"
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
        </section>
      </PanelBody>
      <PanelFooter className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
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
      </PanelFooter>
      <div className="row-rule">
        <StepLog logs={state.logs} />
      </div>
    </Panel>
  );
}
