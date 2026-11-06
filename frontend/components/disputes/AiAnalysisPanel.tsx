"use client";

/**
 * On-demand AI reading of a dispute: classification, a drafted narrative and a
 * plain-language explanation. The panel never decides money — EV, win
 * probability and the verdict are computed deterministically elsewhere and are
 * only restated here. Collapsed (idle) by default so mounting the case room
 * never fires a network call.
 */

import { useCallback, useRef, useState } from "react";
import { RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

import { SealMark } from "@/components/evidence/SealMark";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { api, toApiError, type ApiError } from "@/lib/api";
import { formatAbsolute, formatPercent, shortHash } from "@/lib/format";
import type { AiClassificationCategory, AnalyzeResponse } from "@/lib/types";

const CATEGORY_LABEL: Record<AiClassificationCategory, string> = {
  not_as_described: "Not as described",
  unauthorized: "Unauthorized",
  not_received: "Not received",
  duplicate: "Duplicate",
  other: "Other",
};

/** Live Gemini output vs the deterministic template fallback. Prefix match only. */
function isLiveModel(model: string): boolean {
  return model.startsWith("gemini:");
}

function ModelBadge({ model }: { model: string }) {
  if (isLiveModel(model)) {
    return (
      <Badge tone="accent" dot title={"Model: " + model}>
        Live AI · Gemini
      </Badge>
    );
  }
  return (
    <Badge tone="neutral" title={"Model: " + model}>
      Deterministic fallback
    </Badge>
  );
}

function DegradedBanner({ reason }: { reason: string | null }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-card border border-warning/30 bg-pill-warning px-3 py-2.5"
    >
      <TriangleAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-warning" />
      <p className="text-sm text-ink">
        Degraded analysis{reason ? " — " + reason : ". Showing a partial result."}
      </p>
    </div>
  );
}

function ProvenanceLine({ result }: { result: AnalyzeResponse }) {
  const provenance = result.provenance;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {provenance.recorded ? <SealMark size={18} tone="positive" /> : null}
      <span className="text-sm text-muted">
        {provenance.recorded ? "Recorded" : "Not recorded"}
      </span>
      <span className="num text-xs text-muted" title={provenance.chain_head ?? undefined}>
        chain {provenance.chain_head ? shortHash(provenance.chain_head, 10, 4) : "—"}
      </span>
      <span className="num truncate text-xs text-muted" title={provenance.event_id ?? undefined}>
        event {provenance.event_id ?? "—"}
      </span>
      <span className="num text-xs text-muted">
        seq {provenance.sequence !== null ? String(provenance.sequence) : "—"}
      </span>
      <span className="text-xs text-muted">{provenance.note}</span>
    </div>
  );
}

/** Self-contained on-demand AI analysis for one dispute. Idle until run. */
export function AiAnalysisPanel({ disputeId }: { disputeId: string }) {
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (loading) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await api.analyzeDispute(disputeId, {}, controller.signal);
      setResult(response);
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [disputeId, loading]);

  const retry = useCallback(() => {
    void run();
  }, [run]);

  return (
    <Panel aria-label="AI analysis">
      <PanelHeader
        title="AI analysis"
        description="AI explains and drafts; rules decide. Money never moves on a model sentence."
        actions={result ? <ModelBadge model={result.narrative.model} /> : undefined}
      />
      <PanelBody className="space-y-4 pt-0">
        {loading ? (
          <div role="status" aria-live="polite" className="flex items-center gap-2.5 px-4 py-8">
            <span
              aria-hidden
              className="h-4 w-4 animate-spin rounded-full border-2 border-accent border-t-transparent"
            />
            <p className="text-sm text-muted">Requesting AI analysis…</p>
          </div>
        ) : error && !result ? (
          <ErrorBanner
            error={error}
            context={"AI analysis for case " + disputeId + " failed."}
            onRetry={retry}
          />
        ) : !result ? (
          <EmptyState
            icon={<Sparkles size={20} aria-hidden />}
            title="Explain this case with AI"
            description="Runs one on-demand analysis: a classification read, a drafted buyer-facing narrative and a plain-language explanation. The deterministic verdict stays untouched."
            action={
              <Button variant="primary" size="sm" onClick={() => void run()}>
                Run AI analysis
              </Button>
            }
          />
        ) : (
          <>
            {result.degraded ? <DegradedBanner reason={result.degraded_reason} /> : null}
            {error ? (
              <ErrorBanner
                error={error}
                context="Showing the last analysis while the refresh failed."
                onRetry={retry}
              />
            ) : null}

            <section aria-label="AI classification">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">{CATEGORY_LABEL[result.classification.category]}</Badge>
                <span className="num text-sm text-ink">
                  {formatPercent(result.classification.confidence)}
                </span>
                <span className="num text-xs text-muted">
                  rule {result.classification.reason_code} · ×
                  {result.classification.reason_multiplier.toFixed(2)}
                </span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {result.classification.rationale}
              </p>
            </section>

            <section aria-label="Drafted narrative" className="row-rule pt-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-ink">{result.narrative.title}</h3>
                {result.narrative.grounded ? <Badge tone="positive">Grounded</Badge> : null}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                {result.narrative.narrative}
              </p>
              {result.narrative.warnings.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {result.narrative.warnings.map((warning) => (
                    <li key={warning} className="flex items-start gap-1.5 text-sm text-warning">
                      <TriangleAlert size={13} aria-hidden className="mt-0.5 shrink-0" />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="num mt-2 text-xs text-muted" title={result.narrative.model}>
                drafted by {result.narrative.model}
              </p>
            </section>

            <section aria-label="Plain-language explanation" className="row-rule pt-3">
              <p className="text-sm leading-relaxed text-ink">{result.explanation.summary}</p>
              {result.explanation.bullets.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted">
                  {result.explanation.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            <section aria-label="Analysis provenance" className="row-rule pt-3">
              <ProvenanceLine result={result} />
              <p className="num mt-1.5 text-xs text-muted">
                prompt {result.prompt_version} · {formatAbsolute(result.generated_at)}
              </p>
            </section>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                variant="secondary"
                size="sm"
                icon={<RotateCcw size={13} aria-hidden />}
                onClick={() => void run()}
              >
                Re-run analysis
              </Button>
            </div>
          </>
        )}
      </PanelBody>
      <PanelFooter>
        <p className="text-sm text-muted">
          EV, win probability and the verdict are computed deterministically — never by the model.
        </p>
      </PanelFooter>
    </Panel>
  );
}
