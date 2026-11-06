"use client";

/**
 * A 100 percent stacked bar with a word-and-dot legend.
 *
 * Every share is written out in the legend, so the bar is a summary of the
 * list beside it rather than the only place the split exists. Segments grow
 * into place on first mount.
 */

import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/cn";
import { EASE_OUT } from "@/lib/motion";
import { TONE_DOT, type Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";

export type StackSegment = {
  key: string;
  label: string;
  value: number;
  tone: Tone;
};

const TONE_FILL: Record<Tone, string> = {
  positive: "var(--color-positive)",
  warning: "var(--color-warning)",
  negative: "var(--color-negative)",
  accent: "var(--color-accent)",
  neutral: "var(--color-chart-1)",
};

export function StackedBar({
  segments,
  formatValue = (value) => String(value),
  summary,
  className,
}: {
  segments: StackSegment[];
  formatValue?: (value: number) => string;
  /** Spoken summary, e.g. "Queue by stage: Inquiry 3, Chargeback 1". */
  summary: string;
  className?: string;
}): React.JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const rows: Array<[string, string]> = segments.map((item) => [
    item.label,
    formatValue(item.value) + (total > 0 ? " (" + Math.round((item.value / total) * 100) + "%)" : ""),
  ]);
  const t = { duration: reduced ? 0 : 0.55, ease: EASE_OUT } as const;

  return (
    <figure className={className}>
      <div role="img" aria-label={summary}>
        <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-[2px] bg-raised">
          {segments.map((item) => {
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <motion.div
                key={item.key}
                title={item.label + ": " + formatValue(item.value)}
                style={{
                  width: pct + "%",
                  minWidth: item.value > 0 ? 2 : 0,
                  backgroundColor: TONE_FILL[item.tone],
                  transformOrigin: "left",
                }}
                initial={reduced ? false : { width: "0%" }}
                animate={{ width: pct + "%" }}
                transition={t}
              />
            );
          })}
        </div>
        <ul className="mt-3 space-y-1.5">
          {segments.map((item) => {
            const share = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <li key={item.key} className="flex items-baseline gap-2 text-xs">
                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 self-center rounded-full", TONE_DOT[item.tone])} />
                <span className="text-muted">{item.label}</span>
                <span className="num ml-auto text-ink">{formatValue(item.value)}</span>
                <span className="num w-11 text-right text-muted">{Math.round(share)}%</span>
              </li>
            );
          })}
        </ul>
      </div>
      <ChartTable caption={summary} headers={["Group", "Value"]} rows={rows} />
    </figure>
  );
}
