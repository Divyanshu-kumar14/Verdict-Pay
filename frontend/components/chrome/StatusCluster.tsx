"use client";

import type { ReactNode } from "react";

import { FieldLabel } from "@/components/premium/FieldLabel";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/cn";
import type { PolledQuery } from "@/lib/hooks/usePolledQuery";
import type { DisputePage, HealthResponse } from "@/lib/types";
import { TONE_DOT, TONE_TEXT, type Tone } from "@/lib/vocab";

function connectionMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  live: boolean;
  title: string;
} {
  if (health.data?.status === "ok") {
    return {
      label: "API live",
      tone: "emerald",
      live: true,
      title: health.data.version
        ? API_BASE_URL + " - v" + health.data.version + " - " + health.data.database
        : API_BASE_URL,
    };
  }
  if (health.error) {
    return {
      label: "API offline",
      tone: "rose",
      live: false,
      title: health.error.code + ": " + health.error.message,
    };
  }
  return {
    label: "Linking",
    tone: "amber",
    live: false,
    title: "Waiting for the API at " + API_BASE_URL,
  };
}

function gatewayMeta(health: PolledQuery<HealthResponse>): {
  label: string;
  tone: Tone;
  title: string;
} {
  const gateway = health.data?.gateway ?? health.data?.mode;
  if (gateway === "live") {
    return {
      label: "Live",
      tone: "rose",
      title: "Live gateway selected. Real PayPal credentials are in use.",
    };
  }
  return {
    label: "Simulator",
    tone: "amber",
    title: "Simulator gateway. No PayPal credentials required.",
  };
}

function formatUptime(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  if (hours > 0) return hours + "H " + minutes + "M";
  return minutes + "M " + (clamped % 60) + "S";
}

function Row({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2" title={title}>
      <span className="text-[9.5px] font-medium uppercase tracking-[0.14em] text-dim">
        {label}
      </span>
      <span className="tnum inline-flex min-w-0 items-center justify-end gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.06em]">
        {children}
      </span>
    </div>
  );
}

/**
 * Live instrument status: connection, gateway mode and queue depth.
 * Every value is read from the shell polls. No new endpoints.
 */
export function StatusCluster({
  health,
  cases,
}: {
  health: PolledQuery<HealthResponse>;
  cases: PolledQuery<DisputePage>;
}) {
  const connection = connectionMeta(health);
  const gateway = gatewayMeta(health);
  const caseTotal = cases.data?.meta.total ?? null;
  const uptime =
    health.data && Number.isFinite(health.data.uptime_seconds)
      ? formatUptime(health.data.uptime_seconds)
      : null;

  return (
    <section aria-label="Live instrument status" className="space-y-2.5">
      <FieldLabel rule>Live status</FieldLabel>
      <div className="space-y-1.5">
        <Row label="API" title={connection.title}>
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              TONE_DOT[connection.tone],
              connection.live && "live-dot",
            )}
          />
          <span className={TONE_TEXT[connection.tone]}>{connection.label}</span>
        </Row>
        <Row label="Gateway" title={gateway.title}>
          <span
            aria-hidden
            className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_DOT[gateway.tone])}
          />
          <span className={TONE_TEXT[gateway.tone]}>{gateway.label}</span>
        </Row>
        <Row label="Cases" title="Disputes in the triage queue">
          <span className="text-ink">{caseTotal ?? "--"}</span>
        </Row>
        <Row label="Uptime" title="API process uptime">
          <span className="text-muted">{uptime ?? "--"}</span>
        </Row>
      </div>
    </section>
  );
}
