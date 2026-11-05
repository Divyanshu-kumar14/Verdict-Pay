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

/** Terminal-style live log: every call, latency and chain head, timestamped. */
export function StepLog({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs.length]);

  return (
    <div className="border-t border-hairline bg-[#070b0f]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2">
        <span className="kicker">Step log</span>
        <span className="font-mono text-[10px] text-dim">stdout · {logs.length} lines</span>
      </div>
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
          logs.map((entry) => {
            const level = LEVEL[entry.level];
            return (
              <li key={entry.id} className="flex gap-2">
                <span className="shrink-0 text-dim">{formatClock(entry.at)}</span>
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
