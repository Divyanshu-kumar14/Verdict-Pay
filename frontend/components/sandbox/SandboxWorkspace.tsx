"use client";

import { Fingerprint, KeyRound, Scale } from "lucide-react";
import type { ReactNode } from "react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { CommandCenter } from "@/components/sandbox/CommandCenter";
import { Storefront } from "@/components/sandbox/Storefront";
import { api, ApiError } from "@/lib/api";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { useSandboxFlow } from "@/lib/hooks/useSandboxFlow";
import type { CustomerTimeline, DisputeDetail } from "@/lib/types";

function ProofPoint({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-hairline bg-white/[0.015] px-3 py-2.5">
      <span className="mt-0.5 text-emerald">{icon}</span>
      <div>
        <p className="text-[11.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-muted">{children}</p>
      </div>
    </div>
  );
}

/**
 * / — the judge sandbox. The left panel drives the buyer flow; the right panel
 * reads the real case the API persisted, polls it while visible, and executes the
 * recommended HATEOAS action.
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
    <div className="space-y-5">
      <PageHeader
        kicker="Judge sandbox · Aurora Analytics · no credentials required"
        title="Three clicks. One defended dispute."
        description="Aurora Analytics sells a $99/mo plan through PayPal. The buyer consumes the product, then files a friendly-fraud SNAD claim. VerdictPay intercepts the inquiry, contains recurring billing, prices every response path and takes the cheapest correct action."
        meta={
          <>
            <PageMeta label="Gateway" value="simulator" />
            <PageMeta label="Containment" value={"< 500ms"} />
            <PageMeta label="Ledger" value="SHA-256" />
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
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

      <div className="grid gap-2.5 sm:grid-cols-3">
        <ProofPoint icon={<Fingerprint size={14} aria-hidden />} title="System of record">
          Append-only SHA-256 chain per payer stream, verified before any evidence is filed.
        </ProofPoint>
        <ProofPoint icon={<Scale size={14} aria-hidden />} title="Deterministic EV">
          Fee-aware fight, settle and offer pricing with a documented recommendation order.
        </ProofPoint>
        <ProofPoint icon={<KeyRound size={14} aria-hidden />} title="Zero-setup demo">
          The simulator gateway is the tested path — every E2E run uses the same code.
        </ProofPoint>
      </div>
    </div>
  );
}