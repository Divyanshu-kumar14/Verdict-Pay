"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import type { LogEntry, LogLevel } from "@/lib/hooks/useSandboxFlow";

const LEVEL_TEXT: Record<LogLevel, string> = {
  info: "Info",
  ok: "Done",
  warn: "Warning",
  error: "Failed",
};

const LEVEL_CLASS: Record<LogLevel, string> = {
  info: "text-muted",
  ok: "text-muted",
  warn: "text-warning",
  error: "text-negative",
};

/** "120ms" / "1.4s": elapsed since the first line, for the step readout. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return Math.round(ms) + "ms";
  return (ms / 1000).toFixed(1) + "s";
}

/**
 * The flow's step readout: one plain ordered list of what each call did, when
 * it landed and how long it took since the first line. State is a word, not a
 * tinted chip.
 */
export function StepLog({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs.length]);

  const firstAt = logs.length > 0 ? (logs[0]?.at ?? 0) : 0;

  return (
    <section aria-label="Step log" className="row-rule">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              logs.length > 0 ? "live-dot bg-positive" : "bg-control",
            )}
          />
          <h3 className="text-sm font-medium text-ink">Step log</h3>
        </span>
        <span className="num text-sm text-muted">{logs.length} entries</span>
      </div>
      <ol
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Sandbox step log"
        className="h-[168px] overflow-y-auto px-4 pb-3"
      >
        {logs.length === 0 ? (
          <li className="py-1 text-sm text-muted">
            Waiting for step 1. Each call logs its route, latency, identifiers and chain head
            here.
          </li>
        ) : (
          logs.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-3 py-1 text-sm">
              <span className="num shrink-0 text-muted">{formatClock(entry.at)}</span>
              <span className={cn("w-[52px] shrink-0", LEVEL_CLASS[entry.level])}>
                {LEVEL_TEXT[entry.level]}
              </span>
              <span className="min-w-0 flex-1 break-words text-ink">{entry.text}</span>
              <span className="num shrink-0 text-muted">
                {formatElapsed(entry.at - firstAt)}
              </span>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
