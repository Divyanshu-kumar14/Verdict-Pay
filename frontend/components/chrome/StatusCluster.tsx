"use client";

import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputePage, HealthResponse } from "@/lib/types";
import { TONE_TEXT, type Tone } from "@/lib/vocab";

function connectionMeta(health: PolledQuery<HealthResponse>): {
  value: string;
  tone: Tone;
  live: boolean;
  title: string;
} {
  if (health.data?.status === "ok") {
    return {
      value: "Live",
      tone: "positive",
      live: true,
      title: health.data.version
        ? API_BASE_URL + " · v" + health.data.version + " · " + health.data.database
        : API_BASE_URL,
    };
  }
  if (health.error) {
    return {
      value: "Offline",
      tone: "negative",
      live: false,
      title: health.error.code + ": " + health.error.message,
    };
  }
  return { value: "Connecting", tone: "warning", live: false, title: "Waiting for " + API_BASE_URL };
}

function gatewayMeta(health: PolledQuery<HealthResponse>): { value: string; tone: Tone; title: string } {
  const status = health.data?.gateway_status;
  if (!status) {
    return { value: "Gateway", tone: "accent", title: "Waiting for /health" };
  }
  if (status.readiness !== "ready") {
    return {
      value: "Unconfigured",
      tone: "negative",
      title: status.blockers.join("; ") || "PayPal credentials are missing.",
    };
  }
  if (status.live) {
    return { value: "Live", tone: "negative", title: "PAYPAL_LIVE: real money moves." };
  }
  return {
    value: "Sandbox",
    tone: "accent",
    title: "PAYPAL_SANDBOX at " + status.api_base + ". Test funds only.",
  };
}

function formatUptime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  if (hours > 0) return hours + "h " + minutes + "m";
  return minutes + "m " + (clamped % 60) + "s";
}

function Readout({
  label,
  value,
  tone,
  live = false,
  title,
}: {
  label: string;
  value: string;
  tone?: Tone;
  live?: boolean;
  title?: string;
}) {
  return (
    <div className="min-w-[96px]" title={title}>
      <p className="label">{label}</p>
      <p className={cn("num mt-1.5 inline-flex items-center gap-1.5 text-lg font-semibold", tone ? TONE_TEXT[tone] : "text-ink")}>
        {live ? (
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full live-dot",
              tone === "positive" && "bg-positive",
              tone === "negative" && "bg-negative",
              tone === "warning" && "bg-warning",
            )}
          />
        ) : null}
        {value}
      </p>
    </div>
  );
}

/**
 * The four readings the shell already polls: connection, gateway, queue depth
 * and uptime. Nothing here needs a new endpoint.
 */
export function StatusCluster({
  health,
  cases,
  className,
}: {
  health: PolledQuery<HealthResponse>;
  cases: PolledQuery<DisputePage>;
  className?: string;
}) {
  const connection = connectionMeta(health);
  const gateway = gatewayMeta(health);
  const caseTotal = cases.data?.meta.total ?? null;
  const uptime =
    health.data && Number.isFinite(health.data.uptime_seconds)
      ? formatUptime(health.data.uptime_seconds)
      : null;

  return (
    <div className={cn("flex flex-wrap items-start gap-x-8 gap-y-4", className)}>
      <Readout
        label="API"
        value={connection.value}
        tone={connection.tone}
        live={connection.live}
        title={connection.title}
      />
      <Readout label="Gateway" value={gateway.value} tone={gateway.tone} title={gateway.title} />
      <Readout label="Cases" value={caseTotal === null ? "--" : String(caseTotal)} />
      <Readout label="Uptime" value={uptime ?? "--"} title="API process uptime" />
    </div>
  );
}
