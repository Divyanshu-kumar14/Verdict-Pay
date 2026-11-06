"use client";

import { RotateCcw } from "lucide-react";

import { CommandCenter } from "@/components/sandbox/CommandCenter";
import { DemoStepper, MerchantCheckout } from "@/components/sandbox/Storefront";
import { StepLog } from "@/components/sandbox/StepLog";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { api, ApiError } from "@/lib/api";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { useSandboxFlow } from "@/lib/hooks/useSandboxFlow";
import type { CustomerTimeline, DisputeDetail } from "@/lib/types";

/**
 * /demo: the judge-facing front door. The horizontal stepper runs the buyer
 * flow that opens the dispute; on desktop the polished checkout sits left
 * while the live pipeline and the command centre verdict sit right. The
 * command centre reads the real case the API persisted, polls it while
 * visible, and executes the recommended HATEOAS action.
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live demo"
        description="Aurora Analytics sells a $99.00 Pro plan through PayPal. Run the three steps to open a friendly-fraud dispute; the live pipeline and verdict respond on the right."
      />

      <DemoStepper
        state={flow.state}
        onCheckout={flow.runCheckout}
        onUsage={flow.runUsage}
        onDispute={flow.runDispute}
      />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-4">
          <MerchantCheckout state={flow.state} />
          {flow.state.error ? (
            <ErrorBanner
              error={flow.state.error}
              context="The step stopped before it changed server state. Fix the connection and retry."
              onRetry={retry ? () => { void retry(); } : undefined}
            />
          ) : null}
          <div className="panel flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm text-muted">Reset clears the local flow and reloads merchant state from the API.</p>
            <Button variant="ghost" size="sm" icon={<RotateCcw size={12} aria-hidden />} onClick={handleReset}>
              Reset
            </Button>
          </div>
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
          />
        </div>
      </div>
    </div>
  );
}
