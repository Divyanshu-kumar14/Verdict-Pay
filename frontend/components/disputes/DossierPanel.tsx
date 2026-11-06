"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";

import { SealMark } from "@/components/evidence/SealMark";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, toApiError, type ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

export function DossierPanel({
  caseId,
  available,
}: {
  caseId: string;
  available: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const staleRef = useRef(false);

  const fileName = "VerdictPay_Dossier_" + caseId + ".pdf";

  const load = useCallback(async () => {
    staleRef.current = false;
    setError(null);
    setLoading(true);
    try {
      const blob = await api.dossierPdf(caseId, new AbortController().signal);
      if (staleRef.current) {
        return;
      }
      const url = URL.createObjectURL(blob);
      pdfUrlRef.current = url;
      setPdfUrl(url);
    } catch (error) {
      if (staleRef.current) {
        return;
      }
      setError(toApiError(error));
    } finally {
      if (!staleRef.current) {
        setLoading(false);
      }
    }
  }, [caseId]);

  // Reset captured state when the case id changes.
  useEffect(() => {
    setOpen(false);
    setError(null);
    setPdfUrl(null);
    pdfUrlRef.current = null;
    setLoading(false);
  }, [caseId]);

  // Load on demand whenever the drawer opens and we do not have a PDF yet.
  useEffect(() => {
    if (open && pdfUrl === null && !loading && error === null) {
      void load();
    }
  }, [open, pdfUrl, loading, error, load]);

  // Revoke the object URL on unmount.
  useEffect(() => {
    return () => {
      const url = pdfUrlRef.current;
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  const download = () => {
    const url = pdfUrlRef.current;
    if (url === null) {
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <>
      <Panel aria-label="Seller-protection PDF">
        <PanelHeader
          title="Seller-protection PDF"
          description="The dossier is built on demand from the frozen fact pack and cached on the case."
          actions={
            available ? (
              <span className="inline-flex items-center gap-1.5">
                <SealMark size={16} tone="positive" />
                <span className="text-sm font-medium text-positive">Sealed</span>
              </span>
            ) : (
              <Badge tone="accent">On demand</Badge>
            )
          }
        />

        <div className="space-y-3 px-4 pb-4">
          <p className="text-sm leading-relaxed text-muted">
            A timestamped evidence pack you can hand to PayPal in dispute review. It re-reads saved
            telemetry, never live data.
          </p>
          <Button
            variant="secondary"
            size="sm"
            icon={<FileText size={15} />}
            disabled={loading && !open}
            onClick={() => setOpen(true)}
          >
            {loading && !open ? "Loading…" : "Preview dossier"}
          </Button>
          <p className="text-2xs text-muted">Generated request can be re-run; reprints keep the same seal.</p>
        </div>
      </Panel>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="Evidence dossier"
        description="Rendered from the dispute's frozen fact pack."
        width={680}
        footer={
          <div className="flex items-center justify-between gap-3">
            <span className="num truncate text-xs text-muted">{fileName}</span>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<RefreshCw size={15} />}
                disabled={loading}
                loading={loading}
                onClick={load}
              >
                Reload
              </Button>
              <Button
                variant="primary"
                size="sm"
                icon={<Download size={15} />}
                disabled={pdfUrl === null || loading}
                onClick={download}
              >
                Download
              </Button>
            </div>
          </div>
        }
      >
        <div className={cn("flex h-[62vh] min-h-[320px] flex-col")}>
          {error !== null ? (
            <ErrorBanner error={error} onRetry={() => void load()} context="Dossier preview" />
          ) : loading && pdfUrl === null ? (
            <Skeleton className="h-full rounded-card" />
          ) : pdfUrl !== null ? (
            <iframe
              src={pdfUrl}
              title="Evidence dossier"
              className="h-full w-full rounded-card border border-rule bg-surface"
            />
          ) : (
            <EmptyState
              icon={<FileText size={20} />}
              title="No dossier yet"
              description="Build the evidence pack on demand to preview it here."
              action={
                <Button variant="primary" size="sm" onClick={() => void load()} loading={loading}>
                  Load dossier PDF
                </Button>
              }
            />
          )}
        </div>
      </Drawer>
    </>
  );
}
