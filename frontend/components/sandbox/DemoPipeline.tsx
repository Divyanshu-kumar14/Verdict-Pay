"use client";

import { EvidenceSignal, type SignalStep } from "@/components/evidence/EvidenceSignal";

/**
 * The pipeline indicator: Checkout → Usage telemetry → Dispute → Evidence
 * verification → AI analysis → Verdict → Evidence dossier. A single read-only
 * progress bar rendered once above the demo grid; on desktop it is the full
 * evidence-signal chain, on mobile it collapses to "Step X of N" with a fill
 * bar. States are derived from real flow + case state, never invented.
 */
export function DemoPipeline({ steps }: { steps: SignalStep[] }) {
  const verifiedCount = steps.filter((step) => step.state === "verified").length;
  const currentIndex = steps.findIndex((step) => step.state !== "verified");
  const currentStep = currentIndex >= 0 ? steps[currentIndex] : steps[steps.length - 1];
  const currentLabel = currentStep?.label ?? "";
  const stepNum = currentIndex >= 0 ? currentIndex + 1 : steps.length;
  const complete = verifiedCount === steps.length;
  const pct = Math.round((verifiedCount / steps.length) * 100);

  return (
    <section aria-label="Pipeline progress" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule px-4 py-2.5 sm:px-5">
        <h2 className="title-card">Pipeline</h2>
        <span className="num text-xs text-muted">
          {verifiedCount} of {steps.length} stages
        </span>
      </div>

      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <div className="hidden sm:block">
          <EvidenceSignal steps={steps} orientation="horizontal" />
        </div>

        <div className="sm:hidden">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="shrink-0 text-ink">
              {complete ? "Complete" : "Step " + stepNum + " of " + steps.length}
            </span>
            <span className="num min-w-0 truncate font-mono text-xs text-muted" title={currentLabel}>
              {currentLabel}
            </span>
          </p>
          <div
            role="img"
            aria-label={"Pipeline progress " + verifiedCount + " of " + steps.length + " stages"}
            className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-rule"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300 ease-snap"
              style={{ width: pct + "%" }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
