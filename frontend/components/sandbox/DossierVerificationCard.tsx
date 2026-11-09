"use client";

import { AlertCircle, Check, X, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { CopyButton } from "@/components/sandbox/CopyButton";
import type { DossierVerification } from "@/lib/types";

interface DossierVerificationCardProps {
  verification: DossierVerification | null;
  onReverify?: () => void;
  disabled?: boolean;
}

const CHECK_LABELS: Record<string, string> = {
  chain_valid: "Chain valid",
  snapshot_present: "Snapshot present",
  hash_matches: "Hash matches",
  size_matches: "Size matches",
};

export function DossierVerificationCard({
  verification,
  onReverify,
  disabled = false,
}: DossierVerificationCardProps) {

  if (!verification) {
    return (
      <section className="panel" aria-label="Dossier verification">
        <div className="px-4 py-6 text-center text-muted">
          <p>Run the dossier step to generate verification results.</p>
        </div>
      </section>
    );
  }

  const isVerified = verification.verified;
  const expectedHash = verification.expected_sha256 ?? "—";
  const actualHash = verification.actual_sha256 ?? "—";

  return (
    <section className="panel" aria-label="Dossier verification">
      <header className="px-4 py-3 border-b border-rule flex items-center justify-between gap-3">
        <h2 className="title-card">Dossier verification</h2>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium num",
            isVerified
              ? "bg-positive/10 text-positive border border-positive/20"
              : "bg-negative/10 text-negative border border-negative/20",
          )}
        >
          {isVerified ? (
            <>
              <Check size={14} aria-hidden />
              Verified
            </>
          ) : (
            <>
              <X size={14} aria-hidden />
              Failed
            </>
          )}
        </span>
      </header>

      <div className="p-4 space-y-4">
        {/* Hash comparison */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label className="text-xs text-muted uppercase tracking-wide">Expected SHA-256</label>
            <CopyButton value={expectedHash} label="Expected" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted uppercase tracking-wide">Actual SHA-256</label>
            <CopyButton value={actualHash} label="Actual" />
          </div>
        </div>

        {/* Check badges */}
        <div className="flex flex-wrap gap-2" role="list" aria-label="Verification checks">
          {Object.entries(verification.checks).map(([check, passed]) => (
            <span
              key={check}
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium num",
                passed
                  ? "bg-positive/10 text-positive border border-positive/20"
                  : "bg-negative/10 text-negative border border-negative/20",
              )}
              role="listitem"
            >
              {passed ? (
                <Check size={12} strokeWidth={2.5} aria-hidden />
              ) : (
                <X size={11} strokeWidth={2.5} aria-hidden />
              )}
              <span>{CHECK_LABELS[check] ?? check}</span>
            </span>
          ))}
          {Object.keys(verification.checks).length === 0 && (
            <span className="px-2.5 py-1.5 rounded-lg text-xs text-muted border border-line">
              <AlertCircle size={12} aria-hidden className="inline-block align-middle mr-1" />
              No checks available
            </span>
          )}
        </div>

        {/* Detail message */}
        {verification.detail && (
          <div
            className={cn(
              "px-3 py-2 rounded-md text-sm",
              isVerified ? "bg-positive/5 text-positive" : "bg-negative/5 text-negative",
            )}
          >
            {verification.detail}
          </div>
        )}

        {/* Re-verify button */}
        {onReverify && (
          <button
            type="button"
            onClick={() => void onReverify()}
            disabled={disabled}
            className={cn(
              "w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium",
              "border border-line bg-ground text-ink",
              "hover:border-control hover:bg-muted",
              "focus-visible:outline-2 focus-visible:outline-accent",
              "transition-colors duration-150",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          >
            <RefreshCw size={14} aria-hidden />
            Re-verify
          </button>
        )}
      </div>
    </section>
  );
}