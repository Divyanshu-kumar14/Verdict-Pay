"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, FileText, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Skeleton } from "@/components/ui/Skeleton";
import { FieldLabel } from "@/components/premium/FieldLabel";
import { LiquidGlass } from "@/components/premium/LiquidGlass";
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

  return (
    <LiquidGlass depth={2} accent="ice" grid>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <FieldLabel rule tone="ice">
              Evidence dossier · sealed pack
            </FieldLabel>
            <h2 className="mt-1.5 text-[14px] font-medium tracking-[-0.01em] text-ink">
              Seller-protection PDF
            </h2>
            <p className="mt-0.5 text-[11.5px] text-muted">
              Built on demand from the frozen fact pack, then cached on the case.
            </p>
          </div>
          <Badge tone={available ? "emerald" : "neutral"} dot>
            {available ? "READY" : "ON DEMAND"}
          </Badge>
        </div>

        <div className="mt-3 space-y-2.5">
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
            <Skeleton className="h-[420px] w-full" />
          ) : pdfUrl ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="num truncate text-[9.5px] text-muted" title={"VerdictPay_Dossier_" + caseId + ".pdf"}>
                  VerdictPay_Dossier_{caseId}.pdf
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<RefreshCw size={11} aria-hidden />}
                    onClick={() => {
                      void load();
                    }}
                  >
                    Reload
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    icon={<Download size={11} aria-hidden />}
                    onClick={download}
                  >
                    Download
                  </Button>
                </div>
              </div>
              <iframe
                src={pdfUrl}
                title={"Evidence dossier for dispute " + caseId}
                className="h-[420px] w-full rounded-lg border border-hairline bg-sunken"
              />
            </div>
          ) : (
            <EmptyState
              className="border-white/10 py-8"
              icon={<FileText size={16} aria-hidden />}
              title="Dossier not loaded yet"
              description="Generate the preview from the fact pack: telemetry timeline, chain proof, ToS snapshot, deliveries, usage and Visa CE 3.0 matches."
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

          <p className="num border-t border-hairline pt-2 font-mono text-[9px] leading-relaxed text-dim">
            GET /api/v1/disputes/{caseId}/dossier.pdf · fetched with X-API-Key as an authenticated
            blob. The key never appears in a URL.
          </p>
        </div>
      </div>
    </LiquidGlass>
  );
}
