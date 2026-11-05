"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import type { LogEntry, LogLevel } from "@/lib/hooks/useSandboxFlow";

const LEVEL: Record<LogLevel, { tag: string; className: string }> = {
  info: { tag: "···", className: "text-dim" },
  ok: { tag: "OK", className: "text-emerald" },
  warn: { tag: "WARN", className: "text-amber" },
  error: { tag: "ERR", className: "text-rose" },
};

/** Monospace instrument readout: every call, latency and chain head, timestamped. */
export function StepLog({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs.length]);

  return (
    <div className="border-t border-hairline bg-sunken">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              logs.length > 0 ? "live-dot bg-emerald" : "bg-white/25",
            )}
          />
          <span className="kicker">Step log</span>
        </span>
        <span className="font-mono text-[10px] text-dim">stdout · {logs.length} lines</span>
      </div>
      <div aria-hidden className="instrument-ticks h-[3px] opacity-50" />
      <ol
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Sandbox step log"
        className="h-[168px] space-y-1 overflow-y-auto px-4 py-3 font-mono text-[10.5px] leading-relaxed"
      >
        {logs.length === 0 ? (
          <li className="text-dim">
            Waiting for step 1. Each call logs its route, latency, ids and chain head here.
          </li>
        ) : (
          logs.map((entry, position) => {
            const level = LEVEL[entry.level];
            return (
              <li
                key={entry.id}
                className={cn(
                  "flex gap-2 rounded px-1 py-px",
                  position % 2 === 1 && "bg-white/[0.018]",
                )}
              >
                <span className="num shrink-0 text-dim">{formatClock(entry.at)}</span>
                <span className={cn("shrink-0 font-medium", level.className)}>
                  [{level.tag}]
                </span>
                <span className="min-w-0 break-words text-muted">{entry.text}</span>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
