"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { api, toApiError, type ApiError } from "@/lib/api";

/**
 * Dossier preview. The PDF endpoint is authenticated with X-API-Key, so it is
 * fetched as a blob and rendered from an object URL that is revoked on unmount.
 */
export function DossierPanel({ caseId, available }: { caseId: string; available: boolean }) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const urlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async (): Promise<void> => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const blob = await api.dossierPdf(caseId, controller.signal);
      const nextUrl = URL.createObjectURL(blob);
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = nextUrl;
      setPdfUrl(nextUrl);
    } catch (caught) {
      const apiError = toApiError(caught);
      if (apiError.code !== "aborted") setError(apiError);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    setPdfUrl(null);
    setError(null);
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, [caseId]);

  useEffect(() => {
    if (available && pdfUrl === null && !loading) {
      void load();
    }
  }, [available, load, loading, pdfUrl]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  const download = useCallback(() => {
    if (!pdfUrl) return;
    const anchor = document.createElement("a");
    anchor.href = pdfUrl;
    anchor.download = "VerdictPay_Dossier_" + caseId + ".pdf";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }, [caseId, pdfUrl]);

  const fileName = "VerdictPay_Dossier_" + caseId + ".pdf";

  return (
    <Panel>
      <PanelHeader
        title="Seller-protection PDF"
        description="Built on demand from the frozen fact pack and cached on the case."
        actions={
          <Badge tone={available ? "positive" : "neutral"} dot>
            {available ? "Sealed" : "On demand"}
          </Badge>
        }
      />
      <PanelBody className="space-y-3 pt-0">
        <p className="text-sm leading-relaxed text-muted">
          The file carries the telemetry timeline, the hash-chain proof, the terms snapshot, the
          deliveries, metered usage and the Visa CE 3.0 matches, in that order. The download keeps
          the filename {fileName}, and the bytes never leave this case.
        </p>

        {error ? (
          <ErrorBanner
            error={error}
            context="The dossier endpoint rejected the request."
            onRetry={() => {
              void load();
            }}
          />
        ) : null}

        {loading ? (
          <Skeleton className="h-[320px] w-full" />
        ) : pdfUrl ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="num truncate text-xs text-muted" title={fileName}>
                {fileName}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RefreshCw size={12} aria-hidden />}
                  onClick={() => {
                    void load();
                  }}
                >
                  Reload
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  icon={<Download size={12} aria-hidden />}
                  onClick={download}
                >
                  Download
                </Button>
              </div>
            </div>
            <iframe
              src={pdfUrl}
              title={"Evidence dossier for dispute " + caseId}
              className="h-[420px] w-full rounded-card border border-line bg-ground"
            />
          </div>
        ) : (
          <EmptyState
            icon={<FileText size={16} aria-hidden />}
            title="Dossier not loaded yet"
            description="Generate the preview from the fact pack: telemetry timeline, chain proof, terms snapshot, deliveries, usage and Visa CE 3.0 matches."
            action={
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                onClick={() => {
                  void load();
                }}
              >
                Load dossier PDF
              </Button>
            }
          />
        )}

        <p className="row-rule pt-2.5 text-xs leading-relaxed text-muted">
          Generated on demand from the frozen fact pack and downloaded as an authenticated blob, so
          the API key never appears in a URL.
        </p>
      </PanelBody>
    </Panel>
  );
}
