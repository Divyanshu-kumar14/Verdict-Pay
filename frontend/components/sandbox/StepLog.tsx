"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";

import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/format";
import type { LogEntry, LogLevel } from "@/lib/hooks/useSandboxFlow";
import { SPRING } from "@/lib/motion";

const LEVEL_META: Record<LogLevel, { label: string; dot: string; text: string }> = {
  info: { label: "Info", dot: "bg-accent", text: "text-accent" },
  ok: { label: "Done", dot: "bg-positive", text: "text-positive" },
  warn: { label: "Warning", dot: "bg-warning", text: "text-warning" },
  error: { label: "Failed", dot: "bg-negative", text: "text-negative" },
};

/** Trailing "· 312ms" — the latency each call reports, pulled out of the body. */
const LATENCY_TAIL = /·\s*(\d+(?:\.\d+)?)\s*ms\s*$/;

function splitLatency(text: string): { body: string; latency: string | null } {
  const match = LATENCY_TAIL.exec(text);
  const captured = match?.[1];
  if (match === null || captured === undefined) return { body: text, latency: null };
  return { body: text.slice(0, match.index).trim(), latency: captured + "ms" };
}

/**
 * The flow's live event timeline: one node per call, read top-to-bottom.
 * A status word, the wall-clock timestamp, and the message (which already
 * carries route, identifiers, chain head and outcome) plus the extracted
 * latency. New events slide-and-fade in; nothing here is invented.
 */
export function StepLog({ logs }: { logs: LogEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [logs.length]);

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
          <span className="text-xs text-muted">live</span>
        </span>
        <span className="num text-sm text-muted">{logs.length} events</span>
      </div>

      <ol
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-label="Sandbox step log"
        className="relative h-[168px] overflow-y-auto px-4 pb-3"
      >
        <span aria-hidden className="absolute left-[19px] top-2 bottom-2 w-px bg-rule" />
        {logs.length === 0 ? (
          <li className="py-1 pl-6 text-sm text-muted">
            Waiting for step 1. Each call logs its route, latency, identifiers and chain head
            here.
          </li>
        ) : (
          <AnimatePresence initial={false}>
            {logs.map((entry) => {
              const meta = LEVEL_META[entry.level];
              const { body, latency } = splitLatency(entry.text);
              return (
                <motion.li
                  key={entry.id}
                  initial={reduced ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={reduced ? { duration: 0 } : SPRING}
                  className="relative flex items-start gap-3 py-1.5"
                >
                  <span
                    aria-hidden
                    className={cn("relative z-10 mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", meta.dot)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className={cn("text-xs font-medium", meta.text)}>{meta.label}</span>
                      <span className="num text-xs text-muted">{formatClock(entry.at)}</span>
                      {latency ? (
                        <span className="num ml-auto shrink-0 text-xs text-muted">
                          {latency}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-0.5 break-words text-sm leading-snug text-ink">{body}</p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        )}
      </ol>
    </section>
  );
}
