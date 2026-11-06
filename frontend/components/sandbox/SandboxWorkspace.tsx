"use client";

import { CommandCenter } from "@/components/sandbox/CommandCenter";
import { Storefront } from "@/components/sandbox/Storefront";
import { PageHeader } from "@/components/PageHeader";
import { api, ApiError } from "@/lib/api";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { useSandboxFlow } from "@/lib/hooks/useSandboxFlow";
import type { CustomerTimeline, DisputeDetail } from "@/lib/types";

/**
 * / : the judge-facing front door. The buyer flow opens the dispute; the command
 * center below it reads the real case the API persisted, polls it while visible,
 * and executes the recommended HATEOAS action.
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
    activeId ? `sandbox:case:${activeId}` : "sandbox:case:none",
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
    payerId ? `sandbox:timeline:${payerId}` : "sandbox:timeline:none",
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command centre"
        description="Aurora Analytics sells a $99.00 Pro plan through PayPal. Run the three steps to open a friendly-fraud dispute; the live verdict appears below."
      />

      <Storefront
        state={flow.state}
        onCheckout={flow.runCheckout}
        onUsage={flow.runUsage}
        onDispute={flow.runDispute}
        onReset={() => {
          flow.reset();
          latest.refresh();
        }}
      />

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
  );
}
