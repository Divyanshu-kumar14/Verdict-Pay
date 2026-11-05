"use client";

/**
 * Hand-built bar chart, horizontal or vertical. Flat fills, tabular numerals,
 * no 3D, no gradient fills on data, no rainbow palette: each bar takes the
 * tone its subject already carries elsewhere in the product.
 */

import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";
import { useReveal } from "./use-reveal";

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  hint?: string;
};

const TONE_FILL: Record<Tone, string> = {
  emerald: "var(--color-emerald)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose)",
  sky: "var(--color-sky)",
  neutral: "rgba(255,255,255,0.38)",
};

const EASE = "cubic-bezier(0.16, 1, 0.3, 1)";

export function BarChart({
  data,
  orientation = "horizontal",
  formatValue = (value) => String(value),
  summary,
  maxValue,
  className,
}: {
  data: BarDatum[];
  orientation?: "horizontal" | "vertical";
  formatValue?: (value: number) => string;
  /** Spoken and exposed summary, e.g. "Cases by recommendation: Deflect 4, ...". */
  summary: string;
  maxValue?: number;
  className?: string;
}): React.JSX.Element {
  const { ready, reduce } = useReveal();
  const max = Math.max(1, maxValue ?? data.reduce((peak, item) => Math.max(peak, item.value), 0));
  const rows: Array<[string, string]> = data.map((item) => [item.label, formatValue(item.value)]);

  if (orientation === "horizontal") {
    return (
      <figure className={className}>
        <div role="img" aria-label={summary} className="space-y-2.5">
          {data.map((item, index) => {
            const pct = Math.min(100, (item.value / max) * 100);
            return (
              <div key={item.key} className="grid grid-cols-[96px_minmax(0,1fr)_64px] items-center gap-3">
                <span className="truncate text-[10px] font-medium uppercase tracking-[0.14em] text-dim" title={item.hint ?? item.label}>
                  {item.label}
                </span>
                <span className="block h-[10px] overflow-hidden rounded-[3px] bg-white/[0.05]">
                  <span
                    className="block h-full rounded-[3px]"
                    style={{
                      width: ready ? pct + "%" : "0%",
                      minWidth: ready && item.value > 0 ? 3 : 0,
                      backgroundColor: TONE_FILL[item.tone],
                      opacity: item.value === 0 ? 0.3 : 0.9,
                      transition: reduce ? undefined : "width 700ms " + EASE + " " + index * 70 + "ms",
                    }}
                  />
                </span>
                <span className="tnum text-right font-mono text-[11.5px] text-ink">
                  {formatValue(item.value)}
                </span>
              </div>
            );
          })}
        </div>
        <ChartTable caption={summary} headers={["Group", "Value"]} rows={rows} />
      </figure>
    );
  }

  const width = 600;
  const height = 248;
  const pad = { top: 22, right: 12, bottom: 44, left: 34 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.min(56, slot * 0.52);
  const ticks = [0, 0.5, 1];

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={"0 0 " + width + " " + height} className="h-auto w-full" role="img" aria-label={summary}>
        {ticks.map((tick) => {
          const y = pad.top + plotH - tick * plotH;
          return (
            <g key={tick}>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
              <text x={pad.left - 8} y={y + 3} textAnchor="end" fontSize={9} fill="#74869B" fontFamily="var(--font-geist-mono), ui-monospace, monospace">
                {formatValue(Math.round(tick * max))}
              </text>
            </g>
          );
        })}
        {data.map((item, index) => {
          const fullH = Math.max(0, (item.value / max) * plotH);
          const x = pad.left + slot * index + (slot - barW) / 2;
          const h = Math.max(fullH, item.value > 0 ? 2 : 1);
          return (
            <g
              key={item.key}
              style={{
                transformBox: "fill-box",
                transformOrigin: "50% 100%",
                transform: ready ? "scaleY(1)" : "scaleY(0)",
                transition: reduce ? undefined : "transform 650ms " + EASE + " " + index * 70 + "ms",
              }}
            >
              <rect x={x} y={pad.top + plotH - h} width={barW} height={h} rx={2} style={{ fill: TONE_FILL[item.tone], fillOpacity: item.value === 0 ? 0.3 : 0.85 }} />
            </g>
          );
        })}
        {data.map((item, index) => {
          const fullH = Math.max(0, (item.value / max) * plotH);
          const x = pad.left + slot * index + (slot - barW) / 2;
          const y = pad.top + plotH - fullH;
          return (
            <g key={item.key + "-label"}>
              <text x={x + barW / 2} y={Math.max(y - 6, pad.top - 6)} textAnchor="middle" fontSize={11} fill="#E6EDF3" fontFamily="var(--font-geist-mono), ui-monospace, monospace" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatValue(item.value)}
              </text>
              <text x={x + barW / 2} y={pad.top + plotH + 17} textAnchor="middle" fontSize={9} fill="#93A1B0" letterSpacing="0.08em">
                {item.label.toUpperCase()}
              </text>
              {item.hint ? (
                <text x={x + barW / 2} y={pad.top + plotH + 30} textAnchor="middle" fontSize={8.5} fill="#74869B" fontFamily="var(--font-geist-mono), ui-monospace, monospace">
                  {item.hint}
                </text>
              ) : null}
            </g>
          );
        })}
        <line x1={pad.left} x2={width - pad.right} y1={pad.top + plotH} y2={pad.top + plotH} stroke="rgba(255,255,255,0.16)" strokeWidth={1} />
      </svg>
      <ChartTable caption={summary} headers={["Group", "Value"]} rows={rows} />
    </figure>
  );
}