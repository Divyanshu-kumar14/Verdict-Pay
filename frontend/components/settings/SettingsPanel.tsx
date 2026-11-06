"use client";

import { useState } from "react";
import { KeyRound, RefreshCw, Webhook } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter } from "@/components/ui/Panel";
import { API_BASE_URL, API_ENDPOINTS, DEMO_API_KEY, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION } from "@/lib/constants";
import { formatClock, formatLatency } from "@/lib/format";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import type { Tone } from "@/lib/vocab";

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m " + rest + "s";
  return rest + "s";
}

function maskKey(key: string): string {
  if (key.length <= 8) return "********";
  return key.slice(0, 8) + "*".repeat(Math.min(12, Math.max(6, key.length - 8)));
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-6 border-t border-rule py-8 first:border-t-0 first:pt-0 lg:grid-cols-[minmax(0,428px)_minmax(0,700px)]">
      <div className="min-w-0">
        <h2 className="text-md font-medium text-ink">{title}</h2>
        <p className="mt-2 max-w-[46ch] text-base text-muted">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
}) {
  const valueTone =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "warning"
          ? "text-warning"
          : tone === "accent"
            ? "text-accent"
            : "text-ink";
  return (
    <div className="min-w-0">
      <p className="text-md font-medium text-ink">{label}</p>
      <div className="mt-2 flex h-10 min-w-0 items-center overflow-hidden rounded-card border border-control bg-raised px-3">
        <span className={cn("num truncate text-base", valueTone)}>{value}</span>
      </div>
      {note ? <p className="mt-1.5 text-sm text-muted">{note}</p> : null}
    </div>
  );
}

function SwitchRow({
  title,
  status,
  description,
  on,
}: {
  title: string;
  status: { label: string; tone: Tone };
  description: string;
  on: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium text-ink">{title}</span>
          <Badge tone={status.tone} size="sm">
            {status.label}
          </Badge>
        </div>
        <p className="mt-1 text-base text-muted">{description}</p>
      </div>
      <span
        aria-hidden
        className="relative mt-0.5 h-4 w-7 shrink-0 rounded-full border border-control bg-raised"
      >
        <span
          className={cn(
            "absolute top-[3px] h-2.5 w-2.5 rounded-full",
            on ? "right-[3px] bg-positive" : "left-[3px] bg-muted",
          )}
        />
      </span>
    </div>
  );
}

/** /settings: a read-only report of how this deployment is configured. */
export function SettingsPanel() {
  const [lastCheckMs, setLastCheckMs] = useState<number | null>(null);
  const health = usePolledQuery(
    "settings:health",
    async (signal) => {
      const started = performance.now();
      try {
        return await api.health(signal);
      } finally {
        if (!signal.aborted) setLastCheckMs(performance.now() - started);
      }
    },
    { intervalMs: 15000 },
  );

  const mode = health.data?.gateway ?? health.data?.mode ?? "unknown";
  const isSimulator = mode === "simulator";
  const modeKnown = health.data !== null;
  const llm = health.data?.llm ?? "template";
  const database = health.data?.database ?? "sqlite+aiosqlite";
  const version = health.data?.version ?? APP_VERSION;
  const demoMode = health.data?.demo_mode ?? true;
  const healthy = health.data?.status === "ok";
  const isTemplate = llm === "template";

  const gatewayStatus: { label: string; tone: Tone } = !modeKnown
    ? { label: "Checking", tone: "neutral" }
    : isSimulator
      ? { label: "Simulator", tone: "accent" }
      : { label: "Live", tone: "positive" };

  const healthStatus: { label: string; tone: Tone } = health.error
    ? { label: "Unreachable", tone: "negative" }
    : !modeKnown
      ? { label: "Checking", tone: "neutral" }
      : healthy
        ? { label: "Healthy", tone: "positive" }
        : { label: "Degraded", tone: "warning" };

  return (
    <div className="mx-auto w-full max-w-[1152px] space-y-8">
      <PageHeader
        title="Connection"
        description="How this deployment reaches PayPal, what the demo key can do, and what changes when the gateway is switched to live."
        meta={
          <>
            <PageMeta
              label="Gateway"
              value={modeKnown ? (isSimulator ? "simulator" : "live") : "-"}
            />
            <PageMeta label="LLM" value={llm} />
            <PageMeta label="Database" value={database} />
          </>
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={health.refreshing}
            icon={<RefreshCw size={14} aria-hidden />}
            onClick={health.refresh}
          >
            Run health check
          </Button>
        }
      />

      <Section
        title="Gateway mode"
        description="Which PayPal adapter answers this deployment, and what a live switch would change."
      >
        <Panel>
          <PanelBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-md font-medium text-ink">
                {modeKnown ? (isSimulator ? "Simulator" : "Live") : "Checking"}
              </span>
              <Badge tone={gatewayStatus.tone} size="sm">
                {gatewayStatus.label}
              </Badge>
            </div>
            <p className="max-w-[60ch] text-base text-muted">
              The simulator implements the same gateway protocol as the live adapter, so triage,
              pricing and the action rail behave identically. Live mode needs one environment
              variable plus PayPal client credentials.
            </p>
            <div className="grid gap-4">
              <Field label="Gateway mode" value={mode} />
              <Field label="Narrative" value={llm} />
              <Field label="Database" value={database} />
              <Field label="Demo mode" value={demoMode ? "enabled" : "disabled"} />
            </div>
          </PanelBody>
          <PanelFooter>
            <p className="num truncate text-sm text-muted">
              PAYPAL_MODE={mode} · LLM_MODE={llm} · APP_VERSION={version} · BASE={API_BASE_URL}
            </p>
          </PanelFooter>
        </Panel>
      </Section>

      <Section
        title="Health check"
        description="The API answers a health probe every 15 seconds while this page is visible."
      >
        <Panel>
          <PanelBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-md font-medium text-ink">
                {health.data?.status ?? "No response yet"}
              </span>
              <Badge tone={healthStatus.tone} size="sm" dot>
                {healthStatus.label}
              </Badge>
            </div>
            <div className="grid gap-4">
              <Field
                label="Status"
                value={health.data?.status ?? "-"}
                tone={healthy ? "positive" : "neutral"}
              />
              <Field
                label="Uptime"
                value={
                  health.data ? formatUptime(health.data.uptime_seconds) : "-"
                }
              />
              <Field label="Version" value={version} />
              <Field
                label="Check latency"
                value={lastCheckMs === null ? "-" : formatLatency(lastCheckMs)}
                note="Measured on the client from the request to the response."
              />
            </div>
            {health.error ? (
              <ErrorBanner
                error={health.error}
                context={"The API at " + API_BASE_URL + " did not answer the health check."}
                onRetry={health.refresh}
              />
            ) : null}
          </PanelBody>
          <PanelFooter>
            <p className="num truncate text-xs text-muted">
              {API_BASE_URL}/api/v1/health · polling every 15s while visible · last checked{" "}
              {health.updatedAt ? formatClock(health.updatedAt) : "never"}
            </p>
          </PanelFooter>
        </Panel>
      </Section>

      <Section
        title="Local intellect"
        description="How case prose is produced. Pricing and recommendations stay deterministic either way."
      >
        <Panel>
          <PanelBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-md font-medium text-ink">
                {isTemplate ? "Template narrative" : "Generative narrative"}
              </span>
              <Badge tone={isTemplate ? "accent" : "warning"} size="sm">
                {isTemplate ? "Deterministic" : "Generative"}
              </Badge>
            </div>
            {isTemplate ? (
              <p className="max-w-[60ch] text-base text-muted">
                Copy is assembled from a template with no model call and no network traffic. No
                case payload leaves the deployment, and pricing plus recommendations are pure
                functions of the frozen contract.
              </p>
            ) : (
              <p className="max-w-[60ch] text-base text-muted">
                Prose is generated by the configured model, so case text leaves the deployment.
                Pricing and recommendations stay deterministic; see the backend LLM_MODE setting
                for the provider in use.
              </p>
            )}
            <div className="grid gap-4">
              <Field label="Provider" value={llm} />
              <Field
                label="Case data leaves box"
                value={isTemplate ? "never" : "see LLM_MODE"}
                tone={isTemplate ? "positive" : "warning"}
              />
            </div>
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="What changes between modes"
        description="The four moving parts a switch from simulator to live touches."
      >
        <Panel>
          <PanelBody className="space-y-4">
            <SwitchRow
              title="Money movement"
              status={{
                label: isSimulator ? "Simulated ledger" : "Real PayPal rails",
                tone: isSimulator ? "accent" : "warning",
              }}
              description={
                isSimulator
                  ? "Orders, captures and refunds are written to a local ledger. No funds move."
                  : "Orders, captures and refunds hit the PayPal API and move real funds."
              }
              on={!isSimulator}
            />
            <SwitchRow
              title="Credentials"
              status={{
                label: isSimulator ? "None required" : "Client id and secret",
                tone: isSimulator ? "positive" : "warning",
              }}
              description={
                isSimulator
                  ? "The simulator answers without PayPal credentials."
                  : "Live calls require PayPal client credentials in the deployment environment."
              }
              on={!isSimulator}
            />
            <SwitchRow
              title="Webhook verify"
              status={{
                label: isSimulator ? "Shared secret" : "PayPal signature",
                tone: isSimulator ? "accent" : "positive",
              }}
              description={
                isSimulator
                  ? "Inbound events are signed with the local webhook secret."
                  : "Inbound events are verified against the PayPal signature header."
              }
              on={!isSimulator}
            />
            <SwitchRow
              title="Determinism"
              status={{
                label: isSimulator ? "Seeded, replayable" : "Live network",
                tone: isSimulator ? "positive" : "warning",
              }}
              description={
                isSimulator
                  ? "Seeded inputs make every run replayable."
                  : "Timing and status depend on the live network."
              }
              on={!isSimulator}
            />
            <Field
              label="Switch"
              value="PAYPAL_MODE env"
              note="Simulator is the default. Live requires APP_ENV above local."
            />
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="API access"
        description="Client configuration injected at build time through NEXT_PUBLIC_* environment variables."
      >
        <Panel>
          <PanelBody className="grid gap-4">
            <Field label="API base URL" value={API_BASE_URL} />
            <Field
              label="X-API-Key"
              value={maskKey(DEMO_API_KEY)}
              note="Demo-only public key. Rotate it before holding real funds."
            />
            <Field label="Request id header" value="X-Request-Id" />
            <Field
              label="Polling"
              value="2s case and queue · 5s analytics · paused while hidden"
            />
            <Field
              label="Contract"
              value="zod-parsed frozen schemas · drift surfaces as invalid_response"
            />
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="Signed webhook intake"
        description="PayPal to VerdictPay event verification and replay protection."
      >
        <Panel>
          <PanelBody className="space-y-4">
            <div className="rounded-card border border-control bg-raised px-3 py-3">
              <p className="num whitespace-pre-wrap text-sm text-muted">
                {"POST /api/v1/webhooks/paypal\nX-VerdictPay-Signature: sha256=<hex>\nclock skew: +/-300s | replay-safe on event_id"}
              </p>
            </div>
            <div className="grid gap-4">
              <Field label="Algorithm" value="HMAC-SHA256" />
              <Field label="Tolerance" value="+/-300s" />
              <Field label="Replay cache" value="event_id unique" />
              <Field label="Unsigned traffic" value="rejected" tone="negative" />
            </div>
            <p className="flex max-w-[60ch] items-start gap-2 text-base text-muted">
              <Webhook size={14} className="mt-1 shrink-0 text-muted" aria-hidden />
              <span>
                In simulator mode the signature is computed with VERDICTPAY_WEBHOOK_SECRET. In live
                mode the PayPal verify-webhook-signature endpoint is called. Unsigned traffic is
                rejected unless ALLOW_UNSIGNED_WEBHOOKS is true and APP_ENV is local.
              </span>
            </p>
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="Endpoints used by this UI"
        description="Every request is typed and parsed. Health is the only route that does not require the API key."
      >
        <Panel>
          <PanelBody className="space-y-0">
            <ul>
              {API_ENDPOINTS.map((endpoint, index) => (
                <li
                  key={endpoint.method + endpoint.path}
                  className={cn(
                    "flex flex-wrap items-baseline gap-3 py-3",
                    index > 0 && "row-rule",
                  )}
                >
                  <Badge
                    tone={endpoint.method === "GET" ? "accent" : "warning"}
                    size="sm"
                    className="shrink-0"
                  >
                    {endpoint.method}
                  </Badge>
                  <span className="num text-base text-ink">{endpoint.path}</span>
                  <span className="ml-auto text-sm text-muted">{endpoint.purpose}</span>
                </li>
              ))}
            </ul>
          </PanelBody>
        </Panel>
      </Section>

      <Section
        title="Demo API key"
        description="What the shipped key is for, and when it stops being acceptable."
      >
        <Panel>
          <PanelBody className="flex items-start gap-3">
            <KeyRound size={16} className="mt-0.5 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0">
              <p className="text-md font-medium text-ink">The demo API key is public by design</p>
              <p className="mt-2 max-w-[60ch] text-base text-muted">
                The key ships in the client bundle as NEXT_PUBLIC_VERDICTPAY_API_KEY so the demo
                runs without a login. Treat anything reachable with it as public, and rotate the
                key before this deployment handles real money.
              </p>
            </div>
          </PanelBody>
        </Panel>
      </Section>
    </div>
  );
}

