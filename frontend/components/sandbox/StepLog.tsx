"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import { Terminal } from "lucide-react";

import { CopyButton } from "@/components/sandbox/CopyButton";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/cn";
import { formatClock, shortHash } from "@/lib/format";
import type { LogEntry, LogLevel } from "@/lib/hooks/useSandboxFlow";
import { SPRING } from "@/lib/motion";
import type { Tone } from "@/lib/vocab";

const LEVEL_META: Record<LogLevel, { label: string; dot: string; tone: Tone }> = {
  info: { label: "Info", dot: "bg-accent", tone: "accent" },
  ok: { label: "Done", dot: "bg-positive", tone: "positive" },
  warn: { label: "Warning", dot: "bg-warning", tone: "warning" },
  error: { label: "Failed", dot: "bg-negative", tone: "negative" },
};

/** Trailing "· 312ms" — the latency each call reports, pulled out of the body. */
const LATENCY_TAIL = /·\s*(\d+(?:\.\d+)?)\s*ms\s*$/;

/** "POST /api/v1/sandbox/checkout" — the route each call hit. */
const ROUTE_RE = /\b(POST|GET|PUT|PATCH|DELETE)\s+(\/\S+)/;

/** Identifiers worth copying: order_…, payer_…, sub_…, disp_…, wh_…, evt_…, req …. */
const ID_RE =
  /\b((?:order|payer|subscription|sub|dispute|disp|webhook|wh|events?|evt|evid|req)[_:][A-Za-z0-9._-]+)/gi;

/** "head abc123…" — the chain head each usage call seals. */
const HEAD_RE = /\bhead\s+([A-Za-z0-9._-]{6,})\b/i;

function splitLatency(text: string): { body: string; latency: string | null } {
  const match = LATENCY_TAIL.exec(text);
  const captured = match?.[1];
  if (match === null || captured === undefined) return { body: text, latency: null };
  return { body: text.slice(0, match.index).trim(), latency: captured + "ms" };
}

function parseRoute(text: string): { method: string; route: string } | null {
  const match = ROUTE_RE.exec(text);
  if (!match?.[1] || !match?.[2]) return null;
  return { method: match[1], route: match[2].replace(/[,;]$/, "") };
}

function parseIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(ID_RE)) {
    const id = match[1];
    if (id) seen.add(id.replace(/[,;]$/, ""));
  }
  return [...seen].slice(0, 4);
}

function parseHead(text: string): string | null {
  const match = HEAD_RE.exec(text);
  return match?.[1] ? match[1].replace(/[,;]$/, "") : null;
}

/**
 * The flow's live event timeline, styled as a terminal: one node per call,
 * mono route and timestamp, latency and status chips, copyable identifiers
 * and the truncated chain-head hash. New events slide-and-fade in; nothing
 * here is invented — every line is a real call the flow logged.
 */
export function StepLog({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs.length]);

  return (
    <section aria-label="Live pipeline" className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-rule bg-ground px-4 py-2.5">
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden className="flex shrink-0 items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-negative/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
            <span className="h-2.5 w-2.5 rounded-full bg-positive/70" />
          </span>
          <Terminal size={13} aria-hidden className="shrink-0 text-muted" />
          <h3 className="truncate font-mono text-xs font-medium text-muted">
            live pipeline — step log
          </h3>
        </span>
        <span className="num shrink-0 font-mono text-xs text-muted">
          {logs.length} events
        </span>
      </div>

      <ol
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Sandbox step log"
        className="max-h-[360px] space-y-1 overflow-y-auto bg-ground px-4 py-3"
      >
        {logs.length === 0 ? (
          <li className="font-mono text-xs leading-relaxed text-muted">
            <span aria-hidden className="mr-2 text-accent">
              $
            </span>
            Waiting for step 1. Each call logs its route, latency, identifiers
            and chain head here.
          </li>
        ) : (
          <AnimatePresence initial={false}>
            {logs.map((entry) => {
              const meta = LEVEL_META[entry.level];
              const { body, latency } = splitLatency(entry.text);
              const route = parseRoute(body);
              const ids = parseIds(body);
              const head = parseHead(body);
              return (
                <motion.li
                  key={entry.id}
                  initial={reduced ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? { duration: 0 } : SPRING}
                  className="rounded-md border border-rule bg-surface px-3 py-2"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      aria-hidden
                      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)}
                    />
                    <Badge tone={meta.tone} size="sm">
                      {meta.label}
                    </Badge>
                    {route ? (
                      <span className="min-w-0 truncate font-mono text-xs text-ink">
                        <span className="text-accent-soft">{route.method}</span>{" "}
                        {route.route}
                      </span>
                    ) : (
                      <span className="min-w-0 truncate font-mono text-xs text-ink">
                        sandbox
                      </span>
                    )}
                    <span className="num ml-auto flex shrink-0 items-center gap-2 font-mono text-xs text-muted">
                      {formatClock(entry.at)}
                      {latency ? (
                        <span className="rounded-full bg-pill-neutral px-2 py-0.5 text-2xs text-pill-neutral-ink">
                          {latency}
                        </span>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono text-xs leading-relaxed text-muted">
                    {body}
                  </p>
                  {ids.length > 0 || head ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {ids.map((id) => (
                        <CopyButton key={id} value={id} label={shortHash(id, 12, 4)} />
                      ))}
                      {head && !ids.includes(head) ? (
                        <CopyButton
                          value={head}
                          label={"head " + shortHash(head, 8, 4)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </motion.li>
              );
            })}
          </AnimatePresence>
        )}
      </ol>
    </section>
  );
}
