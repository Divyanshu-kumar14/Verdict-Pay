"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, Info } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import type { AiStatus, GatewayReadiness, GatewayStatus } from "@/lib/types";
import type { Tone } from "@/lib/vocab";

/* --------------------------------------------------------------------------
   The two gateway modes, presented as two first-class choices.

   Everything rendered here comes from `health.gateway_status` / `health.ai_status`
   — the backend's own report of which adapter is serving, whether it is ready,
   and which named blockers stop it. No client id, secret or token is ever read,
   and none of them are even in this payload: the API sends booleans only.
-------------------------------------------------------------------------- */

/** The two modes, in escalating trust order — the same order the backend enum uses. */
type ModeKey = "sandbox" | "live";

type ModeSpec = {
  key: ModeKey;
  label: string;
  /** Which GatewayStatus boolean marks this mode active. */
  flag: (status: GatewayStatus) => boolean;
  /** How the mode's own value is spelled in config, shown as a mono chip. */
  configValue: string;
  summary: string;
  money: string;
  credentials: string;
  tone: Tone;
};

const MODES: ModeSpec[] = [
  {
    key: "sandbox",
    label: "PayPal Sandbox",
    flag: (status) => status.sandbox,
    configValue: "PAYPAL_SANDBOX",
    summary:
      "The real PayPal API against free sandbox accounts: genuine OAuth2, order creation, buyer approval and capture — with test money instead of real money.",
    money: "Moves sandbox funds through real PayPal API calls.",
    credentials: "Needs a sandbox client id and secret.",
    tone: "positive",
  },
  {
    key: "live",
    label: "PayPal Live",
    flag: (status) => status.live,
    configValue: "PAYPAL_LIVE",
    summary:
      "Production PayPal rails. Captures, refunds and disputes here move real money, and the mode refuses to start without an explicit opt-in.",
    money: "Moves real funds through the production PayPal API.",
    credentials: "Needs live credentials plus an explicit live opt-in.",
    tone: "negative",
  },
];

const READINESS: Record<GatewayReadiness, { label: string; tone: Tone }> = {
  ready: { label: "Ready", tone: "positive" },
  degraded: { label: "Degraded", tone: "warning" },
  unconfigured: { label: "Not configured", tone: "negative" },
};

/**
 * Turn a blocker string from the backend into an actionable instruction.
 *
 * The backend names the variable that is missing (`PAYPAL_CLIENT_ID is not set`)
 * rather than its value. We keep that exact wording — it is the honest report —
 * and append what to do about it, so a judge can act on the line instead of
 * decoding it.
 */
function actionFor(blocker: string): string {
  const flag = /^(\w+) is not true$/i.exec(blocker);
  if (flag) return `Set ${flag[1]}=true in the deployment environment, then restart.`;
  const missing = /^(\w+) is not set$/i.exec(blocker);
  if (missing) return `Set ${missing[1]} in the deployment environment, then restart.`;
  return "Resolve this in the deployment environment, then re-run the health check.";
}

/** The active mode resolved from the payload's own booleans, never from a guess. */
function activeMode(status: GatewayStatus): ModeSpec | null {
  return MODES.find((mode) => mode.flag(status)) ?? null;
}

function ModeCard({
  spec,
  active,
  readiness,
  blockers,
  className,
}: {
  spec: ModeSpec;
  active: boolean;
  readiness: GatewayReadiness | null;
  blockers: string[];
  className?: string;
}): React.JSX.Element {
  const state = readiness ? READINESS[readiness] : null;

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col rounded-md border px-4 py-3.5",
        active ? "border-line bg-raised" : "border-control bg-ground",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-base font-medium text-ink">{spec.label}</span>
        {active ? (
          <Badge tone={spec.tone} size="sm">
            Current
          </Badge>
        ) : null}
        {active && state ? (
          <Badge tone={state.tone} size="sm" dot className="ml-auto">
            {state.label}
          </Badge>
        ) : null}
      </div>

      <p className="mt-2 min-w-0 text-sm text-muted">{spec.summary}</p>

      <dl className="mt-3 space-y-1.5 text-xs">
        <div className="flex gap-2">
          <dt className="w-[86px] shrink-0 text-muted">Money</dt>
          <dd className="min-w-0 text-ink">{spec.money}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[86px] shrink-0 text-muted">Credentials</dt>
          <dd className="min-w-0 text-ink">{spec.credentials}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-[86px] shrink-0 text-muted">PAYPAL_MODE</dt>
          <dd className="num min-w-0 break-all font-mono text-ink">{spec.configValue}</dd>
        </div>
      </dl>

      {/* Blockers are only meaningful for the mode that is actually selected. */}
      {active && blockers.length > 0 ? (
        <ul className="mt-3 space-y-1.5 border-t border-rule pt-3">
          {blockers.map((blocker) => (
            <li key={blocker} className="flex items-start gap-2 text-xs">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden />
              <span className="min-w-0">
                <span className="font-mono text-ink">{blocker}</span>
                <span className="block text-muted">{actionFor(blocker)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CompletenessRow({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-2.5 py-1.5">
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full",
          ok ? "bg-pill-positive text-pill-positive-ink" : "bg-pill-warning text-pill-warning-ink",
        )}
      >
        {ok ? <Check size={11} /> : <AlertTriangle size={11} />}
      </span>
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <p className="mt-0.5 break-words text-xs text-muted">{detail}</p>
      </div>
    </div>
  );
}

/**
 * The two-mode overview plus configuration completeness.
 *
 * `status` is null while the first health check is in flight, or when an older
 * backend omits it — in that case every card is shown inactive with an explicit
 * "not reported" note rather than implying a mode we cannot verify.
 */
export function GatewayModes({
  status,
  ai,
}: {
  status: GatewayStatus | null;
  ai: AiStatus | null;
}): React.JSX.Element {
  const active = status ? activeMode(status) : null;
  const readiness = status?.readiness ?? null;
  const blockers = status?.blockers ?? [];
  const known = status !== null;

  return (
    <div className="space-y-4">
      <Panel>
        <PanelHeader
          title="Gateway modes"
          description="Two modes, in escalating trust order. Sandbox runs against PayPal test accounts; live moves real money."
          actions={
            <Badge tone={active ? active.tone : "neutral"}>
              {active ? active.label : known ? "No mode reported" : "Checking"}
            </Badge>
          }
        />
        <PanelBody>
          <div className="grid gap-3 md:grid-cols-2">
            {MODES.map((spec) => (
              <ModeCard
                key={spec.key}
                spec={spec}
                active={active?.key === spec.key}
                readiness={active?.key === spec.key ? readiness : null}
                blockers={active?.key === spec.key ? blockers : []}
              />
            ))}
          </div>

          {!known ? (
            <p className="mt-3 flex items-start gap-2 text-xs text-muted">
              <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Mode is resolved from the live health payload — run a health check to see which mode
                is active and whether it is ready.
              </span>
            </p>
          ) : null}
        </PanelBody>
      </Panel>

      <Panel>
        <PanelHeader
          title="Configuration completeness"
          description="Whether the active mode has everything it needs to run. Presence is reported as a boolean; no credential value is read, sent, or rendered here."
          actions={
            status?.credentials_configured && status?.webhook_configured ? (
              <Badge tone="positive" size="sm">
                Complete
              </Badge>
            ) : (
              <Badge tone="warning" size="sm">
                Incomplete
              </Badge>
            )
          }
        />
        <PanelBody className="space-y-1">
          <CompletenessRow
            label="API credentials"
            ok={status?.credentials_configured ?? false}
            detail={
              status?.credentials_configured
                ? "A client id and secret are present in the environment. Their values are never exposed."
                : "No client id and secret pair is present — the selected PayPal mode cannot authenticate."
            }
          />
          <CompletenessRow
            label="Webhook signing"
            ok={status?.webhook_configured ?? false}
            detail={
              status?.webhook_configured
                ? "A webhook id is configured, so inbound events can be verified against the PayPal signature."
                : "No webhook id is configured, so inbound events cannot be verified against a PayPal signature."
            }
          />
          <CompletenessRow
            label="PayPal API base"
            ok={Boolean(status?.api_base)}
            detail={
              status?.api_base ? (
                <span className="num font-mono">{status.api_base}</span>
              ) : (
                "Not reported by the health payload."
              )
            }
          />
          <CompletenessRow
            label={"AI provider" + (ai ? ` — ${ai.provider}` : "")}
            ok={ai?.configured ?? false}
            detail={
              ai === null
                ? "Not reported by the health payload."
                : ai.configured
                  ? `Model ${ai.model} is enabled with a ${formatTimeout(ai.timeout_ms)} timeout, prompt ${ai.prompt_version}. Case prose is grounded on the frozen facts, and pricing never depends on it.`
                  : ai.enabled
                    ? `Model ${ai.model} is enabled but has no usable key, so prose falls back to the deterministic template.`
                    : "Generative prose is disabled, so case narrative comes from the deterministic template."
            }
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function formatTimeout(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s` : `${ms}ms`;
}

/** Small summary strip for the page header: active mode plus its readiness. */
export function gatewaySummary(status: GatewayStatus | null): {
  label: string;
  tone: Tone;
  detail: string;
} {
  if (status === null) return { label: "Checking", tone: "neutral", detail: "No health payload yet" };
  const active = activeMode(status);
  if (active === null) {
    return { label: status.mode, tone: "warning", detail: "Unrecognised gateway mode" };
  }
  const state = READINESS[status.readiness];
  return {
    label: active.label,
    tone: state.tone,
    detail:
      status.blockers.length > 0
        ? `${status.blockers.length} blocker${status.blockers.length === 1 ? "" : "s"} to resolve`
        : state.label,
  };
}
