"use client";

import { CommandCenter } from "@/components/sandbox/CommandCenter";
import { DemoPipeline } from "@/components/sandbox/DemoPipeline";
import { DemoStepper, MerchantCheckout, RealVsSim } from "@/components/sandbox/Storefront";
import { StepLog } from "@/components/sandbox/StepLog";
import { PageHeader } from "@/components/PageHeader";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import type { SignalStep } from "@/components/evidence/EvidenceSignal";
import { api, ApiError } from "@/lib/api";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { useSandboxFlow } from "@/lib/hooks/useSandboxFlow";
import type { CustomerTimeline, DisputeDetail } from "@/lib/types";

/**
 * /demo: the judge-facing front door. The full-width pipeline shows the five
 * evidence-signal stages; below it the left rail runs the buyer flow that
 * opens the dispute while the live pipeline log and the command centre
 * verdict respond on the right. The command centre reads the real case the
 * API persisted, polls it while visible, and executes the recommended
 * HATEOAS action.
 */
export function SandboxWorkspace() {
  const flow = useSandboxFlow();

  const latest = usePolledQuery(
    "sandbox:latest-case",
    (signal) => api.listDisputes({ page: 1, perPage: 1 }, signal),
    { intervalMs: 5000 },
  );

  const flowDispute = flow.state.dispute;
  const activeId = flowDispute?.dispute.dispute_id ?? latest.data?.data[0]?.dispute_id ?? null;
  const restoredFromQueue = flowDispute === null && activeId !== null;

  const caseQuery = usePolledQuery<DisputeDetail>(
    activeId ? "sandbox:case:" + activeId : "sandbox:case:none",
    (signal) => {
      if (!activeId) {
        return Promise.reject(
          new ApiError({ code: "no_case", message: "No dispute selected yet." }),
        );
      }
      return api.getDispute(activeId, signal);
    },
    { intervalMs: 2000, enabled: activeId !== null },
  );

  const payerId = caseQuery.data?.payer_id ?? flow.state.checkout?.payer_id ?? null;
  const timeline = usePolledQuery<CustomerTimeline>(
    payerId ? "sandbox:timeline:" + payerId : "sandbox:timeline:none",
    (signal) => {
      if (!payerId) {
        return Promise.reject(
          new ApiError({ code: "no_payer", message: "No payer selected yet." }),
        );
      }
      return api.customerTimeline(payerId, signal);
    },
    { intervalMs: 5000, enabled: payerId !== null },
  );

  const retry =
    flow.state.disputeStatus === "error"
      ? flow.runDispute
      : flow.state.usageStatus === "error"
        ? flow.runUsage
        : flow.state.checkoutStatus === "error"
          ? flow.runCheckout
          : null;
  const handleReset = () => {
    flow.reset();
    latest.refresh();
  };

  const checkoutDone = flow.state.checkoutStatus === "success" || flow.state.checkout !== null;
  const usageDone = flow.state.usageStatus === "success" || flow.state.usage !== null;
  const disputeDone = flow.state.disputeStatus === "success" || flow.state.dispute !== null;
  const facts = caseQuery.data?.facts ?? null;
  const caseReady = caseQuery.data != null;

  const pipelineSteps: SignalStep[] = [
    {
      id: "checkout",
      label: "Checkout",
      state:
        flow.state.checkoutStatus === "error"
          ? "failed"
          : checkoutDone
            ? "verified"
            : flow.state.checkoutStatus === "running"
              ? "active"
              : "pending",
    },
    {
      id: "usage",
      label: "Usage telemetry",
      state:
        flow.state.usageStatus === "error"
          ? "failed"
          : usageDone
            ? "verified"
            : flow.state.usageStatus === "running"
              ? "active"
              : !checkoutDone
                ? "locked"
                : "pending",
    },
    {
      id: "dispute",
      label: "Dispute",
      state:
        flow.state.disputeStatus === "error"
          ? "failed"
          : disputeDone
            ? "verified"
            : flow.state.disputeStatus === "running"
              ? "active"
              : !usageDone
                ? "locked"
                : "pending",
    },
    {
      id: "evidence",
      label: "Evidence verification",
      state: !disputeDone
        ? "locked"
        : facts && facts.chain_valid
          ? "verified"
          : facts && !facts.chain_valid
            ? "failed"
            : "pending",
    },
    {
      id: "verdict",
      label: "Verdict",
      state: !disputeDone ? "locked" : caseReady ? "verified" : "pending",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live demo"
        description="Aurora Analytics sells a $99.00 Pro plan through PayPal. Run the three steps to open a friendly-fraud dispute; the live pipeline and verdict respond on the right."
      />

      <DemoPipeline steps={pipelineSteps} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-4 lg:sticky lg:top-[72px] lg:self-start">
          <DemoStepper
            state={flow.state}
            onCheckout={flow.runCheckout}
            onUsage={flow.runUsage}
            onDispute={flow.runDispute}
            onReset={handleReset}
          />
          <RealVsSim />
          <MerchantCheckout state={flow.state} />
          {flow.state.error ? (
            <ErrorBanner
              error={flow.state.error}
              context="The step stopped before it changed server state. Fix the connection and retry."
              onRetry={retry ? () => { void retry(); } : undefined}
            />
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          <StepLog logs={flow.state.logs} />
          <CommandCenter
            activeDisputeId={activeId}
            restoredFromQueue={restoredFromQueue}
            flowDispute={flowDispute}
            fallbackEvents={flow.state.usage?.events ?? null}
            caseQuery={caseQuery}
            timeline={timeline}
            onCaseChanged={() => {
              latest.refresh();
            }}
            onRunStep1={() => { void flow.runCheckout(); }}
          />
        </div>
      </div>
    </div>
  );
}
