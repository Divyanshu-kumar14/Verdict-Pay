"use client";

/**
 * /settings - instrument panel. Connection as measured rows, gateway mode
 * with an unambiguous SIMULATOR / LIVE affordance, health plus measured
 * latency, webhook signing, the local narrative engine and the endpoint map.
 * No decorative toggles: every control on this screen performs a real read.
 */

import type { ReactNode } from "react";
import { useState } from "react";
import { Database, KeyRound, RefreshCw, Webhook } from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { FieldLabel, LiquidGlass, Reveal, SpotlightCard } from "@/components/premium";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
import { Skeleton } from "@/components/ui/Skeleton";
import { API_BASE_URL, API_ENDPOINTS, DEMO_API_KEY, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION, DEMO_MERCHANT_NAME } from "@/lib/constants";
import { formatClock, formatLatency } from "@/lib/format";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { TONE_TEXT, type Tone } from "@/lib/vocab";

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m " + (total % 60) + "s";
  return total + "s";
}

function maskKey(key: string): string {
  if (key.length <= 8) return "********";
  const hidden = "*".repeat(Math.min(12, Math.max(6, key.length - 8)));
  return key.slice(0, 8) + hidden;
}

function Kv({ label, value, tone, note }: { label: string; value: ReactNode; tone?: Tone; note?: string }): React.JSX.Element {
  return (
    <div className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2">
      <div className="kicker">{label}</div>
      <div className={cn("num mt-0.5 break-words text-[11.5px] text-ink", tone && TONE_TEXT[tone])}>{value}</div>
      {note ? <div className="mt-0.5 text-[9px] text-dim">{note}</div> : null}
    </div>
  );
}

function ConfigRow({ label, value, note }: { label: string; value: ReactNode; note?: string }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline/60 py-2 last:border-b-0">
      <span className="text-[10px] text-dim">{label}</span>
      <span className="num min-w-0 break-all text-right text-[10.5px] text-ink">{value}</span>
      {note ? <span className="w-full text-right text-[9.5px] text-dim">{note}</span> : null}
    </div>
  );
}

/** /settings - connection, gateway mode, webhook signing and the endpoint map. */
export function SettingsPanel(): React.JSX.Element {
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

  return (
    <div className="space-y-5">
      <PageHeader
        kicker={"System | " + DEMO_MERCHANT_NAME}
        title="Connection"
        description="What this deployment is talking to, how webhook traffic is verified, and every endpoint the command center calls."
        meta={<>
          <PageMeta label="Gateway" value={modeKnown ? (isSimulator ? "simulator" : "live") : "-"} />
          <PageMeta label="LLM" value={llm} />
          <PageMeta label="Database" value={database} />
        </>}
        actions={<Button variant="secondary" size="sm" loading={health.refreshing} icon={<RefreshCw size={12} aria-hidden />} onClick={health.refresh}>Run health check</Button>}
      />

      <Reveal>
        <LiquidGlass depth={2} grid accent={!modeKnown ? "ice" : isSimulator ? "amber" : "rose"}>
          <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <div className="border-b border-white/10 p-6 lg:border-b-0 lg:border-r">
              <FieldLabel rule tone={!modeKnown ? "ice" : isSimulator ? "amber" : "rose"}>PayPal gateway</FieldLabel>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <span className={cn("text-[34px] font-semibold leading-none tracking-[-0.02em]", !modeKnown ? "text-dim" : isSimulator ? "text-amber" : "text-rose")}>
                  {!modeKnown ? "CHECKING" : isSimulator ? "SIMULATOR" : "LIVE"}
                </span>
                <Badge tone={!modeKnown ? "neutral" : isSimulator ? "amber" : "rose"} dot>
                  {!modeKnown ? "READING HEALTH" : isSimulator ? "NO CREDENTIALS REQUIRED" : "REAL CREDENTIALS IN USE"}
                </Badge>
              </div>
              <p className="mt-3 max-w-2xl text-[12px] leading-relaxed text-muted">
                {!modeKnown
                  ? "Reading gateway, narrative provider and database from GET /api/v1/health. Nothing on this screen is assumed in the client."
                  : isSimulator
                    ? "The SimulatorGateway implements the same PayPalGateway protocol as LiveGateway: the judge demo and the end-to-end path run through this exact implementation. It is deterministic and needs no PayPal account. Going live is one environment variable plus client credentials."
                    : "LiveGateway is selected. Every action is a real PayPal API call; credential handling, idempotency keys and webhook signature verification are active."}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <Kv label="Gateway mode" value={mode} />
                <Kv label="Narrative" value={llm} />
                <Kv label="Database" value={database} />
                <Kv label="Demo mode" value={demoMode ? "enabled" : "disabled"} />
              </dl>
            </div>
            <div className="p-6">
              <FieldLabel rule>What changes between modes</FieldLabel>
              <div className="mt-2">
                <ConfigRow label="Money movement" value={isSimulator ? "simulated ledger" : "real PayPal rails"} />
                <ConfigRow label="Credentials" value={isSimulator ? "none required" : "client id + secret"} />
                <ConfigRow label="Webhook verify" value={isSimulator ? "shared secret" : "PayPal signature"} />
                <ConfigRow label="Determinism" value={isSimulator ? "seeded, replayable" : "live network"} />
                <ConfigRow label="Switch" value="PAYPAL_MODE env" note="Simulator is the default; live requires APP_ENV above local" />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 bg-chrome/60 px-6 py-3 font-mono text-[9.5px] text-dim">
            <span>PAYPAL_MODE={mode}</span>
            <span>LLM_MODE={llm}</span>
            <span>APP_VERSION={version}</span>
            <span>BASE={API_BASE_URL}</span>
          </div>
        </LiquidGlass>
      </Reveal>

      <div className="grid gap-4 xl:grid-cols-2">
        <Reveal className="min-w-0">
          <SpotlightCard className="h-full">
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <FieldLabel rule>Health check</FieldLabel>
                  <h2 className="mt-2 text-[15px] font-medium tracking-[-0.01em] text-ink">Live connection</h2>
                  <p className="mt-1 text-[12px] text-muted">Reads GET /api/v1/health. The endpoint never touches PayPal or the network.</p>
                </div>
                <Badge tone={healthy ? "emerald" : health.error ? "rose" : "amber"} dot>{healthy ? "HEALTHY" : health.error ? "UNREACHABLE" : "CHECKING"}</Badge>
              </div>
              {health.loading ? (
                <div className="mt-4 grid gap-2 sm:grid-cols-2" aria-busy="true">
                  {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-[54px] w-full" />)}
                </div>
              ) : health.error ? (
                <div className="mt-4"><ErrorBanner error={health.error} context={"The API at " + API_BASE_URL + " did not answer the health check."} onRetry={health.refresh} /></div>
              ) : (
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  <Kv label="Status" value={health.data?.status ?? "-"} tone="emerald" />
                  <Kv label="Uptime" value={health.data ? formatUptime(health.data.uptime_seconds) : "-"} />
                  <Kv label="Version" value={version} />
                  <Kv label="Check latency" value={lastCheckMs === null ? "-" : formatLatency(lastCheckMs)} note="client-measured" />
                </div>
              )}
              <p className="mt-3 font-mono text-[9.5px] text-dim">
                {API_BASE_URL}/api/v1/health | polling every 15s while visible | last checked {health.updatedAt ? formatClock(health.updatedAt) : "never"}
              </p>
            </div>
          </SpotlightCard>
        </Reveal>

        <Reveal className="min-w-0" delay={0.06}>
          <SpotlightCard className="h-full">
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <FieldLabel rule tone="ice">Local intellect</FieldLabel>
                  <h2 className="mt-2 text-[15px] font-medium tracking-[-0.01em] text-ink">Where words come from</h2>
                  <p className="mt-1 text-[12px] text-muted">Narrative provider, as reported by /health: {llm}.</p>
                </div>
                <Badge tone={isTemplate ? "sky" : "amber"} dot>{isTemplate ? "DETERMINISTIC" : "GENERATIVE"}</Badge>
              </div>
              <div className="mt-3 space-y-2 text-[12px] leading-relaxed text-muted">
                {isTemplate ? (
                  <>
                    <p>Template mode renders every verdict narrative from deterministic copy. There is no model call, no network traffic and no case payload that can leave this deployment.</p>
                    <p>Pricing, thresholds and recommendations are pure functions of the frozen API contract, so two runs over the same case always read identically.</p>
                  </>
                ) : (
                  <>
                    <p>Generative mode drafts narratives through the configured provider above. Pricing and recommendations stay deterministic; only the prose is generated.</p>
                    <p>See the backend LLM_MODE setting for where that provider runs before holding real merchant funds.</p>
                  </>
                )}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Kv label="Provider" value={llm} />
                <Kv label="Case data leaves box" value={isTemplate ? "never" : "see LLM_MODE"} tone={isTemplate ? "emerald" : "amber"} />
              </div>
            </div>
          </SpotlightCard>
        </Reveal>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Reveal className="min-w-0">
          <Panel className="h-full">
            <PanelHeader kicker="Client configuration" title="API access" description="Injected at build time through NEXT_PUBLIC_* environment variables." actions={<Database size={14} className="text-dim" aria-hidden />} />
            <PanelBody className="space-y-0">
              <ConfigRow label="API base URL" value={API_BASE_URL} />
              <ConfigRow label="X-API-Key" value={maskKey(DEMO_API_KEY)} note="Demo-only public key | rotate before holding real funds" />
              <ConfigRow label="Request id header" value="X-Request-Id" />
              <ConfigRow label="Polling" value="2s case + queue | 5s analytics | paused while hidden" />
              <ConfigRow label="Contract" value="zod-parsed frozen schemas | drift surfaces as invalid_response" />
            </PanelBody>
          </Panel>
        </Reveal>

        <Reveal className="min-w-0" delay={0.06}>
          <Panel className="h-full">
            <PanelHeader kicker="Webhook security" title="Signed webhook intake" description="PayPal -> VerdictPay event verification and replay protection." actions={<Badge tone="sky" dot>HMAC-SHA256</Badge>} />
            <PanelBody className="space-y-3">
              <code className="block overflow-x-auto rounded border border-hairline bg-sunken px-3 py-2.5 font-mono text-[9.5px] leading-relaxed text-muted">
                {"POST /api/v1/webhooks/paypal\nX-VerdictPay-Signature: sha256=<hex>\nclock skew: +/-300s | replay-safe on event_id"}
              </code>
              <div className="grid grid-cols-2 gap-2">
                <Kv label="Algorithm" value="HMAC-SHA256" />
                <Kv label="Tolerance" value="+/-300s" />
                <Kv label="Replay cache" value="event_id unique" />
                <Kv label="Unsigned traffic" value="rejected" tone="rose" />
              </div>
              <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                <Webhook size={11} aria-hidden className="mt-0.5 shrink-0 text-dim" />
                In simulator mode the signature is computed with VERDICTPAY_WEBHOOK_SECRET. In live mode the API calls the PayPal verify-webhook-signature endpoint. Unsigned traffic is rejected unless ALLOW_UNSIGNED_WEBHOOKS=true and APP_ENV=local.
              </p>
            </PanelBody>
          </Panel>
        </Reveal>
      </div>

      <Reveal>
        <Panel>
          <PanelHeader kicker="API map" title="Endpoints used by this UI" description="Every request is typed and parsed; health is the only route that does not require the API key." />
          <ul className="divide-y divide-white/[0.045]">
            {API_ENDPOINTS.map((endpoint) => (
              <li key={endpoint.method + "-" + endpoint.path} className="flex flex-wrap items-center gap-2 px-4 py-2">
                <Badge tone={endpoint.method === "GET" ? "sky" : "amber"} mono>{endpoint.method}</Badge>
                <code className="num text-[10.5px] text-ink">{endpoint.path}</code>
                <span className="ml-auto text-[10px] text-dim">{endpoint.purpose}</span>
              </li>
            ))}
          </ul>
        </Panel>
      </Reveal>

      <Panel className="border-amber/20 bg-amber/[0.03]">
        <div className="flex items-start gap-2.5 p-4">
          <KeyRound size={15} aria-hidden className="mt-0.5 shrink-0 text-amber" />
          <div>
            <p className="text-[12px] font-medium text-ink">The demo API key is public by design</p>
            <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-muted">NEXT_PUBLIC_VERDICTPAY_API_KEY ships inside the browser bundle so a judge can run the demo with one command. It authorises a single demo merchant against a local simulator. For any deployment that holds real funds, rotate the key server-side and never expose it to the client.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}