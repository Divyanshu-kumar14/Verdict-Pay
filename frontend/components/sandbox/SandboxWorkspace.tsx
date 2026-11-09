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
import type { CustomerTimeline, DemoRun, DisputeDetail } from "@/lib/types";

/**
 * /demo: the judge-facing front door. The full-width pipeline shows the seven
 * evidence-signal stages; below it the left rail runs the buyer flow that
 * opens the dispute while the live pipeline log and the command centre
 * verdict respond on the right. The command centre reads ONLY the case that
 * belongs to the current isolated run — never the global newest case — polls
 * it while visible, and executes the recommended HATEOAS action. The run id
 * survives refresh via `?run=` / localStorage (see useSandboxFlow), so a
 * reload re-attaches to the same run instead of surfacing a stale dispute.
 */
export function SandboxWorkspace() {
  const flow = useSandboxFlow();

  // The isolated run this demo is attached to (URL/localStorage -> checkout).
  const runId = flow.state.runId ?? flow.state.checkout?.run_id ?? null;
  const runQuery = usePolledQuery<DemoRun>(
    runId ? "sandbox:run:" + runId : "sandbox:run:none",
    (signal) => {
      if (!runId) {
        return Promise.reject(
          new ApiError({ code: "no_run", message: "No demo run selected yet." }),
        );
      }
      return api.getDemoRun(runId, signal);
    },
    { intervalMs: 5000, enabled: runId !== null },
  );

  const flowDispute = flow.state.dispute;
  // Run-scoped only: the flow's own dispute, else this run's recorded dispute.
  // The global newest case is NEVER used — that was the stale-attach bug.
  // Guard on runId so a disabled (stale) runQuery payload can't leak in.
  const activeId =
    flowDispute?.dispute.dispute_id ??
    (runId ? (runQuery.data?.dispute_id ?? null) : null);
  const restoredFromQueue = false;

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

  const payerId =
    (runId ? (runQuery.data?.payer_id ?? null) : null) ??
    flow.state.checkout?.payer_id ??
    caseQuery.data?.payer_id ??
    null;
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
    flow.state.dossierStatus === "error"
      ? flow.runDossier
      : flow.state.aiStatus === "error"
        ? flow.runAI
        : flow.state.evidenceStatus === "error"
          ? flow.runEvidence
          : flow.state.disputeStatus === "error"
            ? flow.runDispute
            : flow.state.usageStatus === "error"
              ? flow.runUsage
              : flow.state.checkoutStatus === "error"
                ? flow.runCheckout
                : null;
  const handleReset = () => {
    // flow.reset() clears stale local state AND mints a fresh isolated run
    // via POST /sandbox/runs/reset; the run poll below re-attaches when ready.
    flow.reset();
    runQuery.refresh();
  };

  const checkoutDone = flow.state.checkoutStatus === "success" || flow.state.checkout !== null;
  const usageDone = flow.state.usageStatus === "success" || flow.state.usage !== null;
  const disputeDone = flow.state.disputeStatus === "success" || flow.state.dispute !== null;
  const evidenceDone = flow.state.evidenceStatus === "success";
  const aiDone = flow.state.aiStatus === "success";
  const dossierDone = flow.state.dossierStatus === "success";
  const caseReady = caseQuery.data != null;

  const pipelineSteps: SignalStep[] = [
    {
      id: "checkout",
      label: "PayPal Checkout",
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
      label: "Dispute creation",
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
      state:
        flow.state.evidenceStatus === "error"
          ? "failed"
          : evidenceDone
            ? "verified"
            : flow.state.evidenceStatus === "running"
              ? "active"
              : !disputeDone
                ? "locked"
                : "pending",
    },
    {
      id: "ai",
      label: "AI analysis",
      state:
        flow.state.aiStatus === "error"
          ? "failed"
          : aiDone
            ? "verified"
            : flow.state.aiStatus === "running"
              ? "active"
              : !disputeDone
                ? "locked"
                : "pending",
    },
    {
      id: "verdict",
      label: "Deterministic verdict",
      state: !disputeDone ? "locked" : caseReady ? "verified" : "pending",
    },
    {
      id: "dossier",
      label: "Evidence dossier",
      state:
        flow.state.dossierStatus === "error"
          ? "failed"
          : dossierDone
            ? "verified"
            : flow.state.dossierStatus === "running"
              ? "active"
              : !disputeDone
                ? "locked"
                : "pending",
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Live demo"
        description="Aurora Analytics sells a $99.00 Pro plan through PayPal. Run the seven steps to open a friendly-fraud dispute, run AI analysis, verify the evidence chain, and download a cryptographically signed dossier."
      />

      <DemoPipeline steps={pipelineSteps} />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-4 lg:sticky lg:top-[72px] lg:self-start">
          <DemoStepper
            state={flow.state}
            onCheckout={flow.runCheckout}
            onUsage={flow.runUsage}
            onDispute={flow.runDispute}
            onEvidence={flow.runEvidence}
            onAI={flow.runAI}
            onDossier={flow.runDossier}
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
              runQuery.refresh();
            }}
            onRunStep1={() => { void flow.runCheckout(); }}
          />
        </div>
      </div>
    </div>
  );
}
