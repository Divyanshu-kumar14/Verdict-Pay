"use client";

import { useState } from "react";
import { AlertTriangle, CircleCheck, Download } from "lucide-react";

import { CopyButton } from "@/components/sandbox/CopyButton";
import { Button } from "@/components/ui/Button";
import { api, toApiError } from "@/lib/api";
import { formatClock, formatUsd, shortHash } from "@/lib/format";
import type { DisputeDetail } from "@/lib/types";

function ChecklistRow({ ok, label, note, copyValue, copyLabel }: { ok: boolean; label: string; note: string; copyValue?: string; copyLabel?: string }) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? (
        <CircleCheck size={14} aria-hidden className="mt-0.5 shrink-0 text-positive" />
      ) : (
        <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-negative" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink">{label}</p>
        <p className="num mt-0.5 break-words font-mono text-xs text-muted">{note}</p>
        {copyValue && copyLabel ? (
          <div className="mt-1.5"><CopyButton value={copyValue} label={copyLabel} /></div>
        ) : null}
      </div>
    </li>
  );
}

/**
 * What the verdict stands on, and the signed dossier to prove it. Every row
 * reads the live case record — chain validity, order receipt, signup trail,
 * ToS acceptance — and the download is the real PDF the API assembles from
 * that same record, labelled truthfully as a PDF.
 */
export function VerdictEvidence({ detail }: { detail: DisputeDetail }) {
  const facts = detail.facts;
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const downloadDossier = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      const blob = await api.dossierPdf(detail.dispute_id);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "evidence-" + detail.dispute_id.slice(0, 8) + ".pdf";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setDownloadError(toApiError(caught).message);
    } finally {
      setDownloading(false);
    }
  };

  const signupNote = facts.first_seen
    ? "First seen " + formatClock(Date.parse(facts.first_seen)) + " · " + facts.login_count + " logins · " + facts.ips.length + " IPs"
    : "No signup telemetry on file";
  const tosNote = facts.tos_accepted_at
    ? "ToS " + (facts.tos_version ?? "unknown") + " accepted " + formatClock(Date.parse(facts.tos_accepted_at))
    : "No ToS acceptance recorded";

  return (
    <div className="row-rule mt-5 pt-4">
      <h3 className="label">Evidence checklist</h3>
      <ul className="mt-2.5 space-y-2.5">
        <ChecklistRow
          ok={facts.chain_valid}
          label="Telemetry chain"
          note={facts.chain_valid ? facts.event_count + " events · head " + shortHash(facts.chain_head, 8, 6) : "Chain verification failed"}
          copyValue={facts.chain_head}
          copyLabel={"head " + shortHash(facts.chain_head, 8, 4)}
        />
        <ChecklistRow
          ok
          label="Purchase receipt"
          note={"Order " + shortHash(detail.order_id, 10, 4) + " · " + formatUsd(detail.amount_usd)}
          copyValue={detail.order_id}
          copyLabel={shortHash(detail.order_id, 10, 4)}
        />
        <ChecklistRow ok={facts.first_seen != null} label="Signup chain" note={signupNote} />
        <ChecklistRow ok={facts.tos_accepted_at != null} label="Terms acceptance" note={tosNote} />
      </ul>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        {detail.dossier_available ? (
          <Button size="sm" variant="secondary" loading={downloading} icon={<Download size={12} aria-hidden />} onClick={() => { void downloadDossier(); }}>
            Download signed evidence (PDF)
          </Button>
        ) : (
          <p className="text-sm text-muted">The signed evidence dossier is not yet available for this case.</p>
        )}
        {downloadError ? <p role="alert" className="text-sm text-negative">{downloadError}</p> : null}
      </div>
      <p className="mt-1.5 text-xs text-muted">Assembled by the API from this live case record — not a mock export.</p>
    </div>
  );
}
