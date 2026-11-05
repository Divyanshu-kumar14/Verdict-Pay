"use client";

import { Fingerprint, KeyRound, Scale } from "lucide-react";
import type { ReactNode } from "react";

import { ShaderBackdrop } from "@/components/premium/ShaderBackdrop";
import { CommandCenter } from "@/components/sandbox/CommandCenter";
import { Storefront } from "@/components/sandbox/Storefront";
import { api, ApiError } from "@/lib/api";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { useSandboxFlow } from "@/lib/hooks/useSandboxFlow";
import type { CustomerTimeline, DisputeDetail } from "@/lib/types";

function ProofCell({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5 px-4 py-3.5">
      <span className="mt-0.5 shrink-0 text-emerald">{icon}</span>
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium text-ink">{title}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-muted">{children}</p>
      </div>
    </div>
  );
}

/**
 * / — the judge sandbox. The buyer flow drives the left pane; the right pane
 * reads the real case the API persisted, polls it while visible, and executes
 * the recommended HATEOAS action.
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
    <div className="space-y-4">
      <section
        aria-label="Sandbox introduction"
        className="grain relative overflow-hidden rounded-[14px] border border-white/[0.09]"
      >
        <ShaderBackdrop colorA="#05070a" colorB="#0d2033" colorC="#0e5f4a" intensity={1} />
        <div aria-hidden className="instrument-grid absolute inset-0" />
        <div className="relative flex flex-col gap-4 px-5 py-6 sm:px-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 max-w-2xl">
            <p className="kicker text-ice">Judge sandbox · Aurora Analytics · no credentials required</p>
            <h1 className="ink-gradient mt-2 text-hero font-semibold">
              Three clicks. One defended dispute.
            </h1>
            <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
              Aurora Analytics sells a $99/mo plan through PayPal. The buyer consumes the
              product, then files a friendly-fraud SNAD claim. VerdictPay intercepts the
              inquiry, contains recurring billing, prices every response path and takes
              the cheapest correct action.
            </p>
          </div>
          <dl className="flex shrink-0 flex-wrap gap-x-7 gap-y-2">
            <div>
              <dt className="kicker">Gateway</dt>
              <dd className="num mt-1 text-[12px] text-ink">simulator</dd>
            </div>
            <div>
              <dt className="kicker">Containment</dt>
              <dd className="num mt-1 text-[12px] text-ink">&lt; 500ms</dd>
            </div>
            <div>
              <dt className="kicker">Ledger</dt>
              <dd className="num mt-1 text-[12px] text-ink">SHA-256</dd>
            </div>
          </dl>
        </div>
        <div aria-hidden className="rule-instrument absolute inset-x-0 bottom-0 opacity-70" />
      </section>

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

      <section
        aria-label="Why this demo is real"
        className="grid rounded-[10px] border border-hairline bg-panel sm:grid-cols-3 sm:divide-x sm:divide-white/[0.06]"
      >
        <ProofCell icon={<Fingerprint size={14} aria-hidden />} title="System of record">
          Append-only SHA-256 chain per payer stream, verified before any evidence is filed.
        </ProofCell>
        <ProofCell icon={<Scale size={14} aria-hidden />} title="Deterministic EV">
          Fee-aware fight, settle and offer pricing with a documented recommendation order.
        </ProofCell>
        <ProofCell icon={<KeyRound size={14} aria-hidden />} title="Zero-setup demo">
          The simulator gateway is the tested path — every E2E run uses the same code.
        </ProofCell>
      </section>
    </div>
  );
}
