"use client";

import { Fragment } from "react";
import { motion, useReducedMotion } from "motion/react";
import { CircleCheck, CreditCard, Lock, RefreshCw, RotateCcw, X } from "lucide-react";

import { CopyButton } from "@/components/sandbox/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/Panel";
import { Tooltip } from "@/components/ui/Tooltip";
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

type RailState = "completed" | "active" | "failed" | "locked";

function railState(status: StepStatus, canRun: boolean): RailState {
  if (status === "success") return "completed";
  if (status === "error") return "failed";
  if (status === "running") return "active";
  return canRun ? "active" : "locked";
}

function StepNode({ rail, index, reduced }: { rail: RailState; index: number; reduced: boolean }) {
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
  if (rail === "locked") {
    return (
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-control text-muted">
        <Lock size={12} aria-hidden />
      </span>
    );
  }
  return (
    <motion.span
      initial={reduced ? false : { scale: 0.7, opacity: 0.5 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={reduced ? { duration: 0 } : SPRING}
      className="num grid h-7 w-7 shrink-0 place-items-center rounded-full border border-accent bg-pill-accent text-sm font-medium text-accent"
    >
      {index + 1}
    </motion.span>
  );
}

function RailConnector({ filled, reduced }: { filled: boolean; reduced: boolean }) {
  return (
    <div aria-hidden className="mx-auto h-4 w-px shrink-0 overflow-hidden relative sm:mx-0 sm:h-px sm:w-full sm:min-w-6 sm:self-center">
      <span className="absolute inset-0 bg-rule" />
      <motion.span
        className="absolute inset-0 bg-accent"
        initial={false}
        animate={{ scale: filled ? 1 : 0, opacity: filled ? 1 : 0 }}
        style={{ transformOrigin: "left top" }}
        transition={reduced ? { duration: 0 } : SPRING}
      />
    </div>
  );
}

/** The storefront as a real merchant checkout: identity, plan, price, benefits, PayPal. */
export function MerchantCheckout({ state }: { state: SandboxFlowState }) {
  const order = state.checkout;
  return (
    <section aria-label="Plan on sale" className="panel-raised min-w-0 overflow-hidden">
      <div className="flex items-center gap-3 border-b border-rule px-4 py-3.5 sm:px-5">
        <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-pill-accent text-base font-semibold text-accent">
          A
        </span>
        <div className="min-w-0">
          <p className="truncate text-base font-medium text-ink">{DEMO_MERCHANT_NAME}</p>
          <p className="text-xs text-muted">Brand-neutral merchant · test mode</p>
        </div>
        <Badge tone="neutral" size="sm" className="ml-auto shrink-0">
          Secure checkout
        </Badge>
      </div>
      <div className="px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="title-card">{DEMO_PLAN.name} plan</h3>
            <p className="mt-0.5 text-sm text-muted">{DEMO_PLAN.product} · {DEMO_PLAN.cadence}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="num font-mono text-xl font-semibold text-ink">{formatUsd(DEMO_PLAN.priceUsd)}</p>
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
        {order ? (
          <div className="mt-4 rounded-card border border-positive/30 bg-pill-positive/40 px-3 py-2.5">
            <p className="flex items-center gap-1.5 text-xs font-medium text-positive">
              <CircleCheck size={12} aria-hidden /> Order captured
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CopyButton value={order.order_id} label={shortHash(order.order_id, 10, 4)} />
              <CopyButton value={order.payer_id} label={shortHash(order.payer_id, 8, 4)} />
              <span className="num ml-auto font-mono text-xs text-ink">{formatUsd(order.amount_usd)}</span>
            </div>
          </div>
        ) : null}
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
          <div className="flex gap-1.5">
            <dt>Receipt</dt>
            <dd className="num font-mono text-ink">{DEMO_BUYER_EMAIL}</dd>
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

type DemoStep = {
  key: string;
  index: number;
  title: string;
  subtitle: string;
  successDetail: string | null;
  action: string;
  status: StepStatus;
  canRun: boolean;
  run: () => Promise<void>;
};

function buildSteps(
  state: SandboxFlowState,
  onCheckout: () => Promise<void>,
  onUsage: () => Promise<void>,
  onDispute: () => Promise<void>,
  busy: boolean,
): DemoStep[] {
  const canCheckout = !busy && state.checkoutStatus !== "success";
  const canUsage = !busy && state.checkoutStatus === "success" && state.usageStatus !== "success";
  const canDispute = !busy && state.usageStatus === "success" && state.disputeStatus !== "success";
  const reasonShort = REASON_META.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED.short;
  return [
    {
      key: "checkout",
      index: 1,
      title: "Checkout",
      subtitle: "PayPal Orders v2 · ToS captured",
      successDetail: state.checkout
        ? "order " + shortHash(state.checkout.order_id, 10, 4) + " · payer " + shortHash(state.checkout.payer_id, 8, 4) + " · " + formatUsd(state.checkout.amount_usd)
        : null,
      action: "Run checkout",
      status: state.checkoutStatus,
      canRun: canCheckout || state.checkoutStatus === "error",
      run: onCheckout,
    },
    {
      key: "usage",
      index: 2,
      title: "Simulate usage",
      subtitle: "15 logins · 42k AI tokens · signed ZIP export",
      successDetail: state.usage
        ? state.usage.events.length + " events chained · head " + shortHash(state.usage.chain.head_hash, 8, 4) + " · chain " + (state.usage.chain.valid ? "valid" : "broken")
        : null,
      action: "Run usage",
      status: state.usageStatus,
      canRun: canUsage || state.usageStatus === "error",
      run: onUsage,
    },
    {
      key: "dispute",
      index: 3,
      title: "File dispute",
      subtitle: reasonShort + " · " + STAGE_META.INQUIRY.short + " · " + CHANNEL_META.INTERNAL.short + " · " + formatUsd(DEMO_PLAN.priceUsd) + " claim",
      successDetail: state.dispute
        ? STAGE_META.INQUIRY.short + " " + shortHash(state.dispute.dispute.dispute_id, 10, 4) + " · p(win) " + formatPercent(state.dispute.dispute.p_win)
        : null,
      action: "File dispute",
      status: state.disputeStatus,
      canRun: canDispute || state.disputeStatus === "error",
      run: onDispute,
    },
  ];
}

/**
 * The three demo steps as a horizontal progress rail: completed / active /
 * locked / failed states with animated connectors. Locked steps stay visible
 * with a tooltip explaining the dependency; failed steps retry inline.
 */
export function DemoStepper({ state, onCheckout, onUsage, onDispute }: Pick<StorefrontProps, "state" | "onCheckout" | "onUsage" | "onDispute">) {
  const reduced = useReducedMotion() ?? false;
  const busy = state.checkoutStatus === "running" || state.usageStatus === "running" || state.disputeStatus === "running";
  const steps = buildSteps(state, onCheckout, onUsage, onDispute, busy);
  const nextKey = steps.find((step) => step.status !== "success" && step.canRun)?.key ?? null;
  return (
    <ol aria-label="Demo steps" className="flex min-w-0 flex-col sm:flex-row sm:items-stretch">
      {steps.map((step, i) => {
        const rail = railState(step.status, step.canRun);
        const badge = STEP_BADGE[step.status];
        const isNext = step.key === nextKey;
        const isRunning = step.status === "running";
        const isFailed = step.status === "error";
        const isLocked = rail === "locked";
        const detail = rail === "completed" && step.successDetail ? step.successDetail : step.subtitle;
        const label = step.action + " (step " + step.index + " of 3: " + step.title + ", " + (isLocked ? "locked" : badge.label) + ")";
        const prevDone = i > 0 ? steps[i - 1]?.status === "success" : false;
        const button = (
          <Button size="sm" variant={isNext && !isFailed ? "primary" : "secondary"} loading={isRunning} disabled={!step.canRun} icon={isFailed ? <RefreshCw size={12} aria-hidden /> : undefined} aria-label={label} onClick={() => { void step.run(); }}>
            {isFailed ? "Retry" : step.action}
          </Button>
        );
        return (
          <Fragment key={step.key}>
            {i > 0 ? <RailConnector filled={prevDone} reduced={reduced} /> : null}
            <li aria-current={isNext ? "step" : undefined} className={cn("panel min-w-0 flex-1 px-4 py-3.5", isNext && "sig-edge", isLocked && "opacity-70")}>
              <div className="flex items-center gap-2.5">
                <StepNode rail={rail} index={i} reduced={reduced} />
                <p className={cn("min-w-0 flex-1 truncate text-base font-medium", isLocked ? "text-muted" : "text-ink")}>
                  <span className="num mr-1.5 font-mono text-xs text-muted">{step.index}</span>
                  {step.title}
                </p>
                <Badge tone={isLocked ? "neutral" : badge.tone} size="sm" title={isLocked ? "Complete the previous step first" : undefined}>
                  {isLocked ? "Locked" : badge.label}
                </Badge>
              </div>
              <p className={cn("mt-2 break-words font-mono text-xs", rail === "completed" ? "text-positive" : "text-muted")}>{detail}</p>
              {isRunning ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-warning">
                  <span aria-hidden className="live-dot h-1.5 w-1.5 rounded-full bg-warning" />
                  Executing — state settles when the API returns
                </p>
              ) : null}
              <div className="mt-3">{isLocked ? (<Tooltip label="Complete the previous step first"><span className="inline-flex">{button}</span></Tooltip>) : (button)}</div>
            </li>
          </Fragment>
        );
      })}
    </ol>
  );
}

/**
 * The buyer side of the demo: checkout card plus step rail.
 * Kept for compatibility — the workspace composes MerchantCheckout and
 * DemoStepper directly to split them into left/right columns.
 */
export function Storefront({ state, onCheckout, onUsage, onDispute, onReset }: StorefrontProps) {
  const retry = state.disputeStatus === "error" ? onDispute : state.usageStatus === "error" ? onUsage : state.checkoutStatus === "error" ? onCheckout : null;
  return (
    <Panel>
      <PanelBody className="grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <MerchantCheckout state={state} />
        <section aria-label="Demo flow" className="min-w-0">
          <DemoStepper state={state} onCheckout={onCheckout} onUsage={onUsage} onDispute={onDispute} />
          {state.error ? (
            <ErrorBanner className="mt-3" error={state.error} context="The step stopped before it changed server state. Fix the connection and retry." onRetry={retry ? () => { void retry(); } : undefined} />
          ) : null}
        </section>
      </PanelBody>
      <PanelFooter className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Reset clears the local flow and reloads merchant state from the API.</p>
        <Button variant="ghost" size="sm" icon={<RotateCcw size={12} aria-hidden />} onClick={onReset}>Reset</Button>
      </PanelFooter>
    </Panel>
  );
}
