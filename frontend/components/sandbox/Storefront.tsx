"use client";

import { RotateCcw } from "lucide-react";

import { StepLog } from "@/components/sandbox/StepLog";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { DEMO_BUYER_EMAIL, DEMO_PLAN } from "@/lib/constants";
import { formatUsd } from "@/lib/format";
import type { SandboxFlowState, StepStatus } from "@/lib/hooks/useSandboxFlow";
import type { Tone } from "@/lib/vocab";

const STEP_BADGE: Record<StepStatus, { label: string; tone: Tone }> = {
  idle: { label: "Ready", tone: "neutral" },
  running: { label: "Running", tone: "warning" },
  success: { label: "Done", tone: "positive" },
  error: { label: "Failed", tone: "negative" },
};

export type StorefrontProps = {
  state: SandboxFlowState;
  onCheckout: () => Promise<void>;
  onUsage: () => Promise<void>;
  onDispute: () => Promise<void>;
  onReset: () => void;
};

/**
 * The buyer side of the demo: the plan on sale, then the three sequential
 * actions. The next runnable step carries the screen's only primary button.
 */
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
      action: "Run usage",
      status: state.usageStatus,
      canRun: canUsage,
      run: onUsage,
    },
    {
      key: "dispute",
      index: 3,
      title: "File friendly-fraud dispute",
      subtitle: "SNAD · INQUIRY · internal channel · $99 claim",
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
        actions={
          <Badge tone="neutral" size="sm">
            Test buyer
          </Badge>
        }
      />
      <PanelBody className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section aria-label="Plan on sale" className="min-w-0">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="title-card">{DEMO_PLAN.name} plan</h3>
              <p className="mt-0.5 text-sm text-muted">
                {DEMO_PLAN.product} · {DEMO_PLAN.cadence}
              </p>
            </div>
            <p className="num shrink-0 text-lg font-semibold text-ink">
              {formatUsd(DEMO_PLAN.priceUsd)}
            </p>
          </div>

          <dl className="mt-4">
            <div className="flex items-baseline justify-between gap-4 border-t border-rule py-2.5">
              <dt className="label">Metered usage</dt>
              <dd className="num text-sm text-ink">{DEMO_PLAN.features[0]}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4 border-t border-rule py-2.5">
              <dt className="label">Receipt</dt>
              <dd className="text-sm text-ink">
                {DEMO_BUYER_EMAIL} · {DEMO_PLAN.currency} via PayPal
              </dd>
            </div>
          </dl>

          <div className="mt-4">
            <p className="label">What the plan includes</p>
            <ul className="mt-2">
              {DEMO_PLAN.features.slice(1).map((feature, position) => (
                <li
                  key={feature}
                  className={cn("py-2 text-sm text-muted", position > 0 && "border-t border-rule")}
                >
                  {feature}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section aria-label="Judge flow" className="min-w-0">
          <h3 className="title-card">Judge flow</h3>
          <p className="mt-1 text-sm text-muted">Sequential: each step unlocks the next.</p>
          <ol className="mt-2">
            {steps.map((step, position) => {
              const badge = STEP_BADGE[step.status];
              const isNext = step.key === nextKey;
              return (
                <li
                  key={step.key}
                  className={cn(
                    "flex items-center gap-3 py-3",
                    position > 0 && "border-t border-rule",
                  )}
                >
                  <span aria-hidden className="num w-3 shrink-0 text-xs text-muted">
                    {step.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-base text-ink">{step.title}</p>
                    <p className="mt-0.5 text-sm text-muted">{step.subtitle}</p>
                  </div>
                  <Badge tone={badge.tone} size="sm">
                    {badge.label}
                  </Badge>
                  <Button
                    size="sm"
                    variant={isNext ? "primary" : "secondary"}
                    loading={step.status === "running"}
                    disabled={!step.canRun}
                    aria-label={`${step.action} (step ${step.index} of 3: ${step.title}, ${badge.label})`}
                    onClick={() => {
                      void step.run();
                    }}
                  >
                    {step.action}
                  </Button>
                </li>
              );
            })}
          </ol>

          {state.error ? (
            <ErrorBanner
              className="mt-3"
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
