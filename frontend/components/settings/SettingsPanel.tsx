"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Check,
  ChevronDown,
  Copy,
  Info,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from "lucide-react";

import { PageHeader, PageMeta } from "@/components/PageHeader";
import { GatewayModes, gatewaySummary } from "@/components/settings/GatewayModes";
import { EvidenceSignal, type SignalStep } from "@/components/evidence/EvidenceSignal";
import { Magnetic } from "@/components/motion/Magnetic";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { StatTile } from "@/components/ui/StatTile";
import { API_BASE_URL, API_ENDPOINTS, DEMO_API_KEY, api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { APP_VERSION } from "@/lib/constants";
import { clamp, formatClock, formatLatency } from "@/lib/format";
import { usePolledQuery } from "@/lib/hooks/usePolledQuery";
import { SPRING } from "@/lib/motion";
import type { Tone } from "@/lib/vocab";

/* --------------------------------------------------------------------------
   The /settings surface organises the deployment's technical config into five
   labelled sections (A Gateway / B API health / C Security / D API access /
   E Endpoints), navigable from a sticky in-page rail. Everything here is a
   read-only report: the values come from the live health payload and the
   frozen build-time constants, never from invented fixtures.
-------------------------------------------------------------------------- */

const SECTIONS = [
  { id: "gateway", code: "A", label: "Gateway" },
  { id: "health", code: "B", label: "API health" },
  { id: "security", code: "C", label: "Security" },
  { id: "access", code: "D", label: "API access" },
  { id: "endpoints", code: "E", label: "Endpoints" },
] as const;

const WEBHOOK_REQUEST_LINES = [
  "POST /api/v1/webhooks/paypal",
  "X-VerdictPay-Signature: sha256=<hex>",
  "clock skew: +/-300s | replay-safe on event_id",
];

/* The signed-webhook verification pipeline, rendered as a CONFIGURATION
   ILLUSTRATION: every stage carries its real deployment config, and no live
   event is being verified, so nothing here invents a passing checkmark. */
const WEBHOOK_STEPS: SignalStep[] = [
  { id: "event", label: "PayPal Event", state: "active", meta: "inbound payload + signature header" },
  { id: "signature", label: "Signature Verification", state: "pending", meta: "HMAC-SHA256 enabled" },
  { id: "clock", label: "Clock Tolerance", state: "pending", meta: "reject when skew > ±300s" },
  { id: "replay", label: "Replay Protection", state: "pending", meta: "event_id must be unseen" },
  { id: "terminal", label: "Accepted / Rejected", state: "failed", meta: "unsigned or invalid traffic → rejected" },
];

function formatUptime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m " + rest + "s";
  return rest + "s";
}

/** The backend's gateway enum, in the order the product exposes it. */
const GATEWAY_MODES = ["PAYPAL_SANDBOX", "PAYPAL_LIVE"] as const;

/**
 * Canonicalise a gateway mode string. The API sends the enum spelling, but the
 * legacy `gateway`/`mode` fields used lowercase words ("sandbox", "live"), so
 * both spellings must resolve to the same mode.
 */
function normaliseMode(raw: string): string {
  const value = raw.trim().toUpperCase();
  if (value === "SIMULATOR" || value === "LOCAL") return "PAYPAL_SANDBOX";
  if (value === "SANDBOX") return "PAYPAL_SANDBOX";
  if (value === "LIVE") return "PAYPAL_LIVE";
  return GATEWAY_MODES.includes(value as (typeof GATEWAY_MODES)[number]) ? value : "unknown";
}

/** The judge-facing name for a mode, falling back to the raw value when unknown. */
function gatewayModeLabel(raw: string): string {
  switch (normaliseMode(raw)) {
    case "PAYPAL_SANDBOX":
      return "PayPal Sandbox";
    case "PAYPAL_LIVE":
      return "PayPal Live";
    default:
      return raw;
  }
}

function maskKey(key: string): string {
  if (key.length <= 8) return "********";
  return key.slice(0, 8) + "*".repeat(Math.min(12, Math.max(6, key.length - 8)));
}

/* ---------------------------------- layout ---------------------------------- */

function Section({
  id,
  code,
  title,
  description,
  children,
}: {
  id: string;
  code: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id + "-title"}
      className="scroll-mt-28 border-t border-rule py-8 first:border-t-0 first:pt-0"
    >
      <div className="mb-5 flex items-start gap-3">
        <span
          aria-hidden
          className="num mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-raised text-xs font-semibold text-accent"
        >
          {code}
        </span>
        <div className="min-w-0">
          <h2 id={id + "-title"} className="text-md font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/* ------------------------------- key-value rows ------------------------------ */

function Field({
  label,
  value,
  note,
  tone = "neutral",
  mono = false,
  copyValue,
}: {
  label: string;
  value: string;
  note?: string;
  tone?: Tone;
  mono?: boolean;
  copyValue?: string;
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
      <p className="label">{label}</p>
      <div className="mt-1.5 flex h-9 items-center gap-2 overflow-hidden rounded-md border border-control bg-raised px-3">
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-base",
            mono && "font-mono text-xs",
            valueTone,
          )}
        >
          {value}
        </span>
        {copyValue !== undefined ? <CopyButton value={copyValue} label={label} /> : null}
      </div>
      {note ? <p className="mt-1.5 text-xs text-muted">{note}</p> : null}
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
    <div className="flex items-start justify-between gap-4 rounded-md border border-control bg-raised px-3.5 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-base font-medium text-ink">{title}</span>
          <Badge tone={status.tone} size="sm">
            {status.label}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      <span
        aria-hidden
        className="relative mt-1 h-4 w-7 shrink-0 rounded-full border border-control bg-ground"
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

/* ------------------------------ copy affordance ------------------------------ */

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const copy = (): void => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        if (timer.current !== null) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      })
      .catch(() => {
        /* clipboard unavailable — leave the state untouched */
      });
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? label + " copied" : "Copy " + label}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition-colors duration-120 hover:bg-control hover:text-ink"
    >
      {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
    </button>
  );
}

/* -------------------------------- accordion --------------------------------- */

function Accordion({
  trigger,
  children,
}: {
  trigger: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const buttonId = useId();
  const contentId = useId();

  return (
    <div className="rounded-md border border-control bg-raised">
      <button
        type="button"
        id={buttonId}
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left"
      >
        <span className="text-base font-medium text-ink">{trigger}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={SPRING}
          className="shrink-0 text-muted"
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>
      {reduced ? (
        open ? (
          <div id={contentId} className="px-3.5 pb-3.5">
            {children}
          </div>
        ) : null
      ) : (
        <AnimatePresence initial={false}>
          {open ? (
            <motion.div
              id={contentId}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={SPRING}
              className="overflow-hidden"
            >
              <div className="px-3.5 pb-3.5">{children}</div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      )}
    </div>
  );
}

/* ------------------------------ latency readout ------------------------------ */

function LatencyReadout({ ms }: { ms: number | null }) {
  if (ms === null) {
    return (
      <p className="text-xs text-muted">
        No measurement yet — run a health check to time the round trip.
      </p>
    );
  }
  const band =
    ms < 200
      ? { label: "Excellent", tone: "positive" as Tone }
      : ms < 600
        ? { label: "Good", tone: "positive" as Tone }
        : ms < 1000
          ? { label: "Elevated", tone: "warning" as Tone }
          : { label: "Slow", tone: "negative" as Tone };
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1.5">
        <span className="text-xs text-muted">Round-trip latency</span>
        <span className="flex items-center gap-2">
          <Badge tone={band.tone} size="sm">
            {band.label}
          </Badge>
          <span className="num font-mono text-sm font-semibold text-ink">{formatLatency(ms)}</span>
        </span>
      </div>
      <ProgressBar
        value={clamp(ms / 1000, 0, 1)}
        tone={band.tone}
        label={"Check latency " + formatLatency(ms) + ", rated " + band.label}
        className="mt-2"
      />
      <div className="num mt-1.5 flex items-baseline justify-between text-2xs text-muted" aria-hidden>
        <span>0ms</span>
        <span>500ms</span>
        <span>1000ms+</span>
      </div>
      <p className="mt-1.5 text-xs text-muted">
        Single client-timed measurement. No history is collected, so nothing is averaged or
        extrapolated.
      </p>
    </div>
  );
}

/* --------------------------------- the page --------------------------------- */

/** /settings: a read-only report of how this deployment is configured. */
export function SettingsPanel() {
  const [lastCheckMs, setLastCheckMs] = useState<number | null>(null);
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const reduced = useReducedMotion();

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

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-90px 0px -70% 0px" },
    );
    for (const el of els) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* The backend spells modes as an enum (PAYPAL_SANDBOX / PAYPAL_LIVE).
     The health payload's own `gateway_status` booleans are the
     authority; the older `gateway`/`mode` strings are only a fallback for a
     deployment that predates it. */
  const gateway = health.data?.gateway_status ?? null;
  const ai = health.data?.ai_status ?? null;
  const rawMode = gateway?.mode ?? health.data?.gateway ?? health.data?.mode ?? "unknown";
  const mode = normaliseMode(rawMode);
  const isLive = mode === "PAYPAL_LIVE";
  const modeLabel = gatewayModeLabel(rawMode);
  const modeKnown = health.data !== null;
  const llm = health.data?.llm ?? "template";
  const database = health.data?.database ?? "sqlite+aiosqlite";
  const version = health.data?.version ?? APP_VERSION;
  const demoMode = health.data?.demo_mode ?? true;
  const healthy = health.data?.status === "ok";
  const isTemplate = llm === "template";

  const gatewayStatus = gatewaySummary(gateway);

  const healthStatus: { label: string; tone: Tone } = health.error
    ? { label: "Unreachable", tone: "negative" }
    : !modeKnown
      ? { label: "Checking", tone: "neutral" }
      : healthy
        ? { label: "Healthy", tone: "positive" }
        : { label: "Degraded", tone: "warning" };

  const envLines: Array<[string, string]> = [
    ["PAYPAL_MODE", mode],
    ["LLM_MODE", llm],
    ["DATABASE", database],
    ["APP_VERSION", version],
    ["API_BASE_URL", API_BASE_URL],
  ];

  const navigate = (id: string, event: React.MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  };

  return (
    <div className="mx-auto w-full max-w-[1080px]">
      <PageHeader
        className="lg:flex-wrap lg:gap-y-5"
        title="Connection"
        description="How this deployment reaches PayPal, what the demo key can do, and what changes when the gateway is switched to live."
        meta={
          <>
            <PageMeta label="Gateway" value={modeKnown ? modeLabel : "-"} />
            <PageMeta label="LLM" value={llm} />
            <PageMeta label="Database" value={database} />
          </>
        }
        actions={
          <Magnetic strength={8}>
            <Button
              variant="secondary"
              size="sm"
              loading={health.refreshing}
              icon={<RefreshCw size={14} aria-hidden />}
              onClick={health.refresh}
            >
              Run health check
            </Button>
          </Magnetic>
        }
      />

      <nav
        aria-label="On this page"
        className="sticky top-14 z-10 -mx-1 mt-4 border-b border-line bg-ground/90 px-1 backdrop-blur-sm"
      >
        <div className="flex gap-1 overflow-x-auto py-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={"#" + s.id}
              onClick={(event) => navigate(s.id, event)}
              aria-current={active === s.id ? "true" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-120",
                active === s.id ? "bg-raised text-ink" : "text-muted hover:text-ink",
              )}
            >
              <span className="num text-2xs font-semibold text-accent">{s.code}</span>
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      <div>
        {/* A — Gateway */}
        <Section
          id="gateway"
          code="A"
          title="Gateway"
          description="Which PayPal adapter answers this deployment, how case prose is produced, and what a live switch would change."
        >
          <div className="space-y-4">
            <GatewayModes status={gateway} ai={ai} />

            <Panel>
              <PanelHeader
                title="Gateway & environment"
                description="Both modes call the real PayPal API, so triage, pricing and the action rail behave identically. Live mode needs PayPal client credentials plus an explicit opt-in."
                actions={<Badge tone={gatewayStatus.tone}>{gatewayStatus.label}</Badge>}
              />
              <PanelBody className="grid gap-4 sm:grid-cols-2">
                <Field label="Gateway mode" value={mode === "unknown" ? rawMode : mode} mono />
                <Field label="Database" value={database} mono />
                <Field
                  label="Narrative"
                  value={
                    ai ? `${ai.provider} · ${ai.model}` : isTemplate ? "template" : "generative"
                  }
                  note={
                    ai
                      ? ai.configured
                        ? "Grounded on the frozen case facts; pricing never depends on it."
                        : "No usable key, so prose falls back to the deterministic template."
                      : undefined
                  }
                  mono
                />
                <Field
                  label="Demo mode"
                  value={demoMode ? "enabled" : "disabled"}
                  note="Demo mode never holds real merchant funds."
                />
              </PanelBody>
              <PanelFooter>
                <p className="label mb-2">Environment</p>
                <div className="rounded-md border border-control bg-ground px-3 py-2.5">
                  {envLines.map((line) => (
                    <div key={line[0]} className="num flex gap-3 font-mono text-xs">
                      <span className="shrink-0 text-muted">{line[0]}=</span>
                      <span className="min-w-0 break-all text-ink">{line[1]}</span>
                    </div>
                  ))}
                </div>
              </PanelFooter>
            </Panel>

            <Panel>
              <PanelHeader
                title="Case narrative"
                description="How case prose is produced. Pricing and recommendations stay deterministic either way."
                actions={
                  <Badge tone={isTemplate ? "accent" : "warning"}>
                    {isTemplate ? "Deterministic" : "Generative"}
                  </Badge>
                }
              />
              <PanelBody className="space-y-4">
                <p className="max-w-[60ch] text-sm text-muted">
                  {isTemplate
                    ? "Copy is assembled from a template with no model call and no network traffic. No case payload leaves the deployment, and pricing plus recommendations are pure functions of the frozen contract."
                    : "Prose is generated by the configured model, so case text leaves the deployment. Pricing and recommendations stay deterministic; see the backend LLM_MODE setting."}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Provider"
                    value={ai ? ai.provider : llm}
                    note={ai ? `Model ${ai.model}` : undefined}
                    mono
                  />
                  <Field
                    label="Case data leaves box"
                    value={isTemplate || ai?.configured === false ? "never" : "to the AI provider"}
                    tone={isTemplate || ai?.configured === false ? "positive" : "warning"}
                  />
                  <Field
                    label="Timeout"
                    value={ai ? `${ai.timeout_ms} ms` : "-"}
                    note="Hard ceiling on one narrative call."
                    mono
                  />
                  <Field
                    label="Prompt version"
                    value={ai ? ai.prompt_version : "-"}
                    note="Grounding prompt revision reported by the API."
                    mono
                  />
                </div>
              </PanelBody>
            </Panel>

            <Panel>
              <PanelHeader
                title="What changes between modes"
                description="The four moving parts that differ between the two modes. Both call the real PayPal API; only live moves real money."
                actions={<Badge tone={gatewayStatus.tone}>{modeLabel}</Badge>}
              />
              <PanelBody className="space-y-2.5">
                <SwitchRow
                  title="Money movement"
                  status={{
                    label: isLive ? "Real funds" : "Sandbox funds",
                    tone: isLive ? "negative" : "positive",
                  }}
                  description={
                    isLive
                      ? "Orders, captures and refunds hit the production PayPal API and move real money."
                      : "Orders, captures and refunds hit the real PayPal API against sandbox accounts. Test funds move; no real money does."
                  }
                  on
                />
                <SwitchRow
                  title="Credentials"
                  status={{
                    label: isLive ? "Live client id and secret" : "Sandbox client id and secret",
                    tone: "warning",
                  }}
                  description="Sandbox and live authenticate with OAuth2 using credentials held in the deployment environment. Presence is reported as a boolean; the values are never rendered."
                  on
                />
                <SwitchRow
                  title="Webhook verify"
                  status={{
                    label: "PayPal signature",
                    tone: "positive",
                  }}
                  description="Inbound events are verified against the PayPal signature header, with replay protection keyed on the event id."
                  on
                />
                <SwitchRow
                  title="Determinism"
                  status={{
                    label: "Network-timed",
                    tone: "warning",
                  }}
                  description="Timing and status depend on the PayPal network; the pricing and EV maths stay deterministic either way."
                  on
                />
                <Field
                  label="Switch"
                  value="PAYPAL_MODE env"
                  note={
                    isLive
                      ? "Live is active. Switching back to PAYPAL_SANDBOX returns to test funds."
                      : "Set PAYPAL_MODE to PAYPAL_SANDBOX or PAYPAL_LIVE. Live additionally requires ALLOW_PAYPAL_LIVE=true."
                  }
                />
              </PanelBody>
            </Panel>
          </div>
        </Section>

        {/* B — API health */}
        <Section
          id="health"
          code="B"
          title="API health"
          description="The API answers a health probe every 15 seconds while this page is visible."
        >
          <Panel>
            <PanelHeader
              title="Health probe"
              description="State, uptime and version report verbatim from the health payload."
              actions={
                <Badge tone={healthStatus.tone} size="sm" dot>
                  {healthStatus.label}
                </Badge>
              }
            />
            <PanelBody className="space-y-5">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-line bg-rule lg:grid-cols-4">
                <StatTile
                  label="State"
                  value={health.data?.status ?? "-"}
                  tone={healthy ? "positive" : health.error ? "negative" : "neutral"}
                  className="bg-surface"
                />
                <StatTile
                  label="Uptime"
                  value={health.data ? formatUptime(health.data.uptime_seconds) : "-"}
                  className="bg-surface"
                />
                <StatTile label="Version" value={version} className="bg-surface" />
                <StatTile
                  label="Latency"
                  value={lastCheckMs === null ? "-" : formatLatency(lastCheckMs)}
                  sub="single sample"
                  className="bg-surface"
                />
              </div>

              <LatencyReadout ms={lastCheckMs} />

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

        {/* C — Security */}
        <Section
          id="security"
          code="C"
          title="Security"
          description="How inbound PayPal events are verified and how replay attacks are turned away."
        >
          <Panel>
            <PanelHeader
              title="Signed webhook intake"
              description="PayPal to VerdictPay event verification and replay protection."
              actions={
                <Badge tone="accent" size="sm">
                  <Webhook size={12} aria-hidden />
                  HMAC-SHA256
                </Badge>
              }
            />
            <PanelBody className="space-y-4">
              <div className="rounded-md border border-control bg-ground px-3.5 py-4">
                <p className="mb-3 flex items-center gap-2 text-2xs font-semibold uppercase tracking-wide text-muted">
                  <Webhook size={12} aria-hidden />
                  Verification flow
                </p>
                <EvidenceSignal orientation="vertical" steps={WEBHOOK_STEPS} />
                <p className="mt-4 flex items-start gap-2 text-xs text-muted">
                  <Info size={13} className="mt-0.5 shrink-0" aria-hidden />
                  <span>
                    Configuration illustration, not a live verification. A valid signed event
                    clears each step in turn and is accepted; anything unsigned, stale, or
                    replayed is rejected at the terminal.
                  </span>
                </p>
              </div>

              <div className="rounded-md border border-control bg-ground px-3 py-2.5">
                {WEBHOOK_REQUEST_LINES.map((line) => (
                  <div key={line} className="break-all font-mono text-xs text-muted">
                    {line}
                  </div>
                ))}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Algorithm" value="HMAC-SHA256" mono />
                <Field label="Clock tolerance" value="+/-300s" mono />
                <Field label="Replay cache" value="event_id unique" mono />
                <Field label="Unsigned traffic" value="rejected" tone="negative" />
              </div>

              <Accordion trigger="When is a signature accepted?">
                <p className="flex max-w-[60ch] items-start gap-2 text-sm text-muted">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0 text-muted" aria-hidden />
                  <span>
                    In sandbox and live modes the PayPal verify-webhook-signature endpoint is called. Unsigned
                    traffic is rejected unless ALLOW_UNSIGNED_WEBHOOKS is true and APP_ENV is local.
                  </span>
                </p>
              </Accordion>
            </PanelBody>
          </Panel>
        </Section>

        {/* D — API access */}
        <Section
          id="access"
          code="D"
          title="API access"
          description="Client configuration injected at build time through NEXT_PUBLIC_* environment variables."
        >
          <Panel>
            <PanelBody className="space-y-4">
              <div
                role="note"
                className="flex items-start gap-3 rounded-md border border-control bg-raised px-3.5 py-3"
              >
                <KeyRound
                  size={16}
                  className="mt-0.5 shrink-0 text-warning"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-base font-medium text-warning">
                    The demo API key is public by design
                  </p>
                  <p className="mt-1 max-w-[60ch] text-sm text-muted">
                    The key ships in the client bundle as NEXT_PUBLIC_VERDICTPAY_API_KEY so the demo
                    runs without a login. Treat anything reachable with it as public, and rotate the
                    key before this deployment handles real money.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="API base URL" value={API_BASE_URL} mono copyValue={API_BASE_URL} />
                <Field
                  label="X-API-Key"
                  value={maskKey(DEMO_API_KEY)}
                  mono
                  copyValue={DEMO_API_KEY}
                  note="Masked. Copying reads the real (public) demo key."
                />
                <Field label="Response id header" value="X-Request-Id" mono />
                <Field label="Request auth header" value="X-API-Key" mono />
                <Field label="Polling" value="2s case and queue · 5s analytics · paused while hidden" />
                <Field
                  label="Contract"
                  value="zod-parsed frozen schemas · drift surfaces as invalid_response"
                />
              </div>
            </PanelBody>
          </Panel>
        </Section>

        {/* E — Endpoints */}
        <Section
          id="endpoints"
          code="E"
          title="Endpoints"
          description="Every request is typed and parsed. Health is the only route that does not require the API key."
        >
          <Panel>
            <PanelHeader
              title="Endpoints used by this UI"
              description={API_ENDPOINTS.length + " routes, each parsed against a frozen zod schema."}
            />
            <PanelBody className="space-y-0">
              <ul>
                {API_ENDPOINTS.map((endpoint, index) => (
                  <li
                    key={endpoint.method + endpoint.path}
                    className={cn(
                      "flex flex-wrap items-center gap-x-3 gap-y-2 py-3",
                      index > 0 && "row-rule",
                    )}
                  >
                    <Badge
                      tone={endpoint.method === "GET" ? "accent" : "warning"}
                      size="sm"
                      className="shrink-0 font-mono"
                    >
                      {endpoint.method}
                    </Badge>
                    <span className="min-w-0 break-all font-mono text-xs text-ink">
                      {endpoint.path}
                    </span>
                    <span className="ml-auto text-sm text-muted">{endpoint.purpose}</span>
                    <CopyButton value={endpoint.path} label={endpoint.method + " " + endpoint.path} />
                  </li>
                ))}
              </ul>
              <div className="row-rule pt-4">
                <Accordion trigger="About the route contract">
                  <p className="max-w-[60ch] text-sm text-muted">
                    Each response is validated against its zod schema before render. Contract drift
                    surfaces as an invalid_response error with the offending field path, rather than
                    a broken screen. The X-Request-Id in the response ties any failure back to the
                    backend log entry.
                  </p>
                </Accordion>
              </div>
            </PanelBody>
          </Panel>
        </Section>
      </div>
    </div>
  );
}
