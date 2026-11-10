"use client";

import { useState } from "react";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { api, toApiError, type ApiError } from "@/lib/api";
import { shortHash } from "@/lib/format";
import type { SentinelVerdict, VetoLabResponse } from "@/lib/types";

type Json = Record<string, unknown>;

/** The recorded npm package trace Control #2 replays through the live Sentinel. */
const TOOLKIT_TRACE_LABEL =
  "Recorded @paypal/agent-toolkit@1.11.0 trace · live Sentinel evaluation";

function asJson(value: unknown): Json {
  return value && typeof value === "object" ? (value as Json) : {};
}

function str(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The provenance line every verdict carries: exit code, codes, audit chain hash. */
function Verdict({ verdict, label }: { verdict: SentinelVerdict; label: string }) {
  const veto = verdict.exit_code === 2;
  return (
    <div
      className={
        veto
          ? "rounded-card border border-negative/40 bg-pill-negative/30 p-3"
          : "rounded-card border border-positive/40 bg-pill-positive/30 p-3"
      }
      data-testid={veto ? "verdict-veto" : "verdict-allow"}
    >
      <p className="text-2xs uppercase tracking-wide text-muted">{label}</p>
      <p
        className={
          veto
            ? "mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold text-negative"
            : "mt-1 flex items-center gap-1.5 font-mono text-sm font-semibold text-positive"
        }
      >
        {veto ? <ShieldAlert size={14} aria-hidden /> : <ShieldCheck size={14} aria-hidden />}
        {veto ? "EXIT CODE 2 — VETO" : "EXIT CODE 0 — ALLOW (DRY RUN · TOKEN ISSUED)"}
      </p>
      <p className="mt-1 text-xs text-muted">
        {verdict.proposed_action} · {verdict.dispute_id || "no id"} · mode {verdict.candidate_mode}
      </p>
      {verdict.veto_codes.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-1">
          {verdict.veto_codes.map((code) => (
            <li key={code}>
              <Badge tone="negative">{code}</Badge>
            </li>
          ))}
        </ul>
      ) : null}
      {verdict.reasons.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs text-ink">
          {verdict.reasons.slice(0, 3).map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
      {verdict.hmac_approval_token ? (
        <p className="mt-2 font-mono text-2xs text-muted">
          ApprovalToken HMAC {shortHash(verdict.hmac_approval_token.sig_hmac_sha256, 10, 6)}
        </p>
      ) : null}
      <p className="mt-1 font-mono text-2xs text-muted">
        audit chain {verdict.chain_hash ? shortHash(verdict.chain_hash, 8, 4) : "—"} · manifest{" "}
        {shortHash(verdict.manifest_sha256, 8, 4)}
      </p>
    </div>
  );
}

function Unguarded({ title, lines }: { title: string; lines: Array<[string, string]> }) {
  return (
    <div className="rounded-card border border-warning/40 bg-pill-warning/20 p-3">
      <p className="text-2xs uppercase tracking-wide text-muted">{title}</p>
      <dl className="mt-1 space-y-1 text-xs">
        {lines.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[110px_1fr] gap-2">
            <dt className="text-muted">{key}</dt>
            <dd className="break-all font-mono text-ink">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-3">{children}</div>;
}

export function VetoLabWorkspace() {
  const [result, setResult] = useState<VetoLabResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.runVetoLab());
    } catch (caught) {
      setError(toApiError(caught));
    } finally {
      setBusy(false);
    }
  }

  const probe = asJson(result?.paypal_probe);
  const controls = new Map((result?.controls ?? []).map((control) => [control.id, control]));
  const naive = controls.get("naive_cliff");
  const toolkit = controls.get("toolkit_hazards");
  const llm = controls.get("llm_attack");

  return (
    <div className="space-y-4 p-4 md:p-6">
      <PageHeader
        className="pb-0"
        title="Veto Lab — crime vs exorcism"
        description="Three executable negative controls. Left: what an unguarded system does. Right: the isolated Sentinel (python -I -B, env={}, CPU/memory/file limits, no sockets) returns EXIT CODE 2 before any PayPal write; the hardened alternative returns EXIT CODE 0 with a signed ApprovalToken. Lab disputes are synthetic; no PayPal write is made."
        actions={
          <Button variant="primary" onClick={run} disabled={busy} data-testid="run-veto-lab">
            {busy ? "Running…" : result ? "Run again" : "Run all three"}
          </Button>
        }
      />
      <Panel>
        <PanelBody className="flex flex-wrap gap-2 text-xs">
          {result === null ? (
            <Badge tone="neutral">[PENDING LIVE PROBE]</Badge>
          ) : probe.ok ? (
            <Badge tone="accent">[LIVE PAYPAL SANDBOX]</Badge>
          ) : (
            <Badge tone="negative">[SANDBOX PROBE FAILED]</Badge>
          )}
          <span className="text-muted">
            {result === null
              ? "run the lab to record a live PayPal sandbox debug_id"
              : probe.ok
                ? `${str(probe.endpoint)} · HTTP ${str(probe.http_status)} · paypal-debug-id ${str(probe.paypal_debug_id)}`
                : `sandbox probe unavailable (${str(probe.error ?? probe.http_status)})`}
          </span>
          {result ? (
            <span className="font-mono text-muted">
              rules manifest {shortHash(result.rules_manifest_sha256, 10, 6)}
            </span>
          ) : null}
        </PanelBody>
      </Panel>

      {error ? <ErrorBanner error={error} onRetry={run} context="Veto Lab" /> : null}

      {naive ? (
        <Panel data-testid="control-naive">
          <PanelHeader title={`1 · ${naive.title}`} />
          <PanelBody className="space-y-4">
            {(naive.cases ?? []).map((item) => {
              const unguarded = asJson(item.unguarded);
              const proposal = asJson(unguarded.proposal);
              const simulated = item.source_plane === "SIMULATED_CARD_NETWORK_FEED";
              return (
                <div key={str(item.axis)} className="space-y-2">
                  <p className="flex flex-wrap items-center gap-2 text-sm text-ink">
                    {item.axis}
                    <Badge tone={simulated ? "warning" : "accent"}>
                      {simulated ? "[VISA-TC40 / ACQUIRER-FEED SIMULATION]" : "[LIVE PAYPAL SANDBOX] policy"}
                    </Badge>
                  </p>
                  <Row>
                    <Unguarded
                      title="Unguarded float triage"
                      lines={[
                        ["reasoning", str(unguarded.reasoning)],
                        ["proposes", str(proposal.proposed_action)],
                        ["amount", `${str(proposal.dispute_amount_minor)} minor units`],
                      ]}
                    />
                    <Verdict verdict={item.sentinel} label="Sentinel on that proposal" />
                    {item.hardened ? <Verdict verdict={item.hardened} label="Hardened: MAKE_OFFER" /> : null}
                  </Row>
                </div>
              );
            })}
          </PanelBody>
        </Panel>
      ) : null}

      {toolkit ? (
        <Panel data-testid="control-toolkit">
          <PanelHeader
            title={`2 · ${TOOLKIT_TRACE_LABEL}`}
            description={`Live Sentinel evaluation of the recorded run of tools/toolkit-probe against the real published package (${str(
              toolkit.recorded_at,
            )}; ${str(toolkit.network)}). Stale OAuth: token refreshed after expires_in = ${str(
              asJson(toolkit.stale_oauth).refreshed,
            )}.`}
          />
          <PanelBody className="space-y-3">
            {(toolkit.cases ?? []).map((item) => {
              const unguarded = asJson(item.unguarded);
              const request = asJson(unguarded.request);
              const shield = asJson(item.shield);
              return (
                <Row key={str(item.id)}>
                  <Unguarded
                    title={`Unguarded toolkit · ${str(item.title)}`}
                    lines={[
                      ["executed", str(unguarded.executed)],
                      ["request", `${str(request.method)} ${str(request.url)}`],
                    ]}
                  />
                  <Unguarded
                    title="CliffGuardToolkitShield"
                    lines={[
                      ["verdict", str(shield.verdict)],
                      ["codes", str(shield.veto_codes)],
                    ]}
                  />
                  <Verdict verdict={item.sentinel} label="Sentinel" />
                </Row>
              );
            })}
          </PanelBody>
        </Panel>
      ) : null}

      {llm ? (
        <Panel data-testid="control-llm">
          <PanelHeader
            title={`3 · ${llm.title}`}
            description={`Worker env keys: ${str(asJson(llm.worker).env_keys)} · credential leaks: ${str(
              asJson(llm.worker).credential_env_leaks,
            )} · source ${str(asJson(llm.worker).source)}${
              asJson(llm.worker).degraded ? " (degraded: no live model)" : ""
            }`}
          />
          <PanelBody className="space-y-3">
            <ol className="space-y-1 text-xs">
              {(llm.thread ?? []).map((message, index) => (
                <li key={index} className="rounded-card border border-rule px-2 py-1">
                  <span className="font-mono text-muted">[{str(asJson(message).posted_by)}]</span>{" "}
                  {str(asJson(message).content)}
                </li>
              ))}
            </ol>
            <Row>
              <Unguarded
                title="Unguarded LLM tool call"
                lines={Object.entries(asJson(asJson(llm.unguarded).proposal)).map(([key, value]) => [
                  key,
                  str(value),
                ])}
              />
              {llm.sentinel ? <Verdict verdict={llm.sentinel} label="Sentinel on the LLM output" /> : null}
              {llm.hardened ? <Verdict verdict={llm.hardened} label="Hardened: SEND_MESSAGE" /> : null}
            </Row>
          </PanelBody>
        </Panel>
      ) : null}
    </div>
  );
}
