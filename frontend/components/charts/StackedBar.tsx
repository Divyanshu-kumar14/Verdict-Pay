"use client";

/**
 * Hand-built 100-percent stacked bar with a word-and-dot legend. Every share
 * is labelled in text, so hue is never the only encoding.
 */

import { cn } from "@/lib/cn";
import { TONE_DOT, type Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";
import { useReveal } from "./use-reveal";

export type StackSegment = {
  key: string;
  label: string;
  value: number;
  tone: Tone;
};

const TONE_FILL: Record<Tone, string> = {
  emerald: "var(--color-emerald)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose)",
  sky: "var(--color-sky)",
  neutral: "rgba(255,255,255,0.30)",
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
  const { ready, reduce } = useReveal();
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const rows: Array<[string, string]> = segments.map((item) => [
    item.label,
    formatValue(item.value) + (total > 0 ? " (" + Math.round((item.value / total) * 100) + "%)" : ""),
  ]);

  return (
    <figure className={className}>
      <div role="img" aria-label={summary}>
        <div className="flex h-[12px] w-full gap-px overflow-hidden rounded-[4px] bg-white/[0.04]">
          {segments.map((item, index) => {
            const pct = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <div
                key={item.key}
                title={item.label + ": " + formatValue(item.value)}
                style={{
                  width: ready ? pct + "%" : "0%",
                  minWidth: ready && item.value > 0 ? 2 : 0,
                  backgroundColor: TONE_FILL[item.tone],
                  opacity: item.value === 0 ? 0 : 0.85,
                  transition: reduce ? undefined : "width 700ms cubic-bezier(0.16, 1, 0.3, 1) " + index * 60 + "ms",
                }}
              />
            );
          })}
        </div>
        <ul className="mt-2.5 space-y-1.5">
          {segments.map((item) => {
            const share = total > 0 ? (item.value / total) * 100 : 0;
            return (
              <li key={item.key} className="flex items-baseline gap-2 text-[11px]">
                <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 self-center rounded-full", TONE_DOT[item.tone])} />
                <span className="text-muted">{item.label}</span>
                <span className="tnum ml-auto font-mono text-ink">{formatValue(item.value)}</span>
                <span className="tnum w-11 text-right font-mono text-dim">{Math.round(share)}%</span>
              </li>
            );
          })}
        </ul>
      </div>
      <ChartTable caption={summary} headers={["Group", "Value"]} rows={rows} />
    </figure>
  );
}