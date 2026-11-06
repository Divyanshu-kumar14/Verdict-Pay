"use client";

/**
 * A bar chart in flat fills with a real scale.
 *
 * Bars carry the tone their subject already carries in the table, so hue is a
 * restatement and never the only encoding. Vertical bars get gridlines, a
 * labelled y-scale and dates; horizontal bars get their number at the end of
 * the row. Nothing animates an entrance: the geometry is final on first paint.
 */

import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";

export type BarDatum = {
  key: string;
  label: string;
  value: number;
  tone: Tone;
  hint?: string;
};

const TONE_FILL: Record<Tone, string> = {
  positive: "var(--color-positive)",
  warning: "var(--color-warning)",
  negative: "var(--color-negative)",
  accent: "var(--color-accent)",
  neutral: "var(--color-chart-1)",
};

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
  /** Spoken and exposed summary, e.g. "Cases by recommendation: Deflect 4". */
  summary: string;
  maxValue?: number;
  className?: string;
}): React.JSX.Element {
  const max = Math.max(1, maxValue ?? data.reduce((peak, item) => Math.max(peak, item.value), 0));
  const rows: Array<[string, string]> = data.map((item) => [item.label, formatValue(item.value)]);

  if (orientation === "horizontal") {
    return (
      <figure className={className}>
        <div role="img" aria-label={summary} className="space-y-2.5">
          {data.map((item) => {
            const pct = Math.min(100, (item.value / max) * 100);
            return (
              <div key={item.key} className="grid grid-cols-[104px_minmax(0,1fr)_72px] items-center gap-3">
                <span className="truncate text-xs text-muted" title={item.hint ?? item.label}>
                  {item.label}
                </span>
                <span className="block h-2 overflow-hidden rounded-[2px] bg-raised">
                  <span
                    className="block h-full rounded-[2px]"
                    style={{
                      width: pct + "%",
                      minWidth: item.value > 0 ? 3 : 0,
                      backgroundColor: TONE_FILL[item.tone],
                      opacity: item.value === 0 ? 0.35 : 1,
                    }}
                  />
                </span>
                <span className="num text-right text-sm text-ink">{formatValue(item.value)}</span>
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
  const pad = { top: 24, right: 12, bottom: 46, left: 44 };
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
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="var(--color-rule)" strokeWidth={1} />
              <text x={pad.left - 10} y={y + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">
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
            <rect
              key={item.key}
              x={x}
              y={pad.top + plotH - h}
              width={barW}
              height={h}
              rx={2}
              style={{ fill: TONE_FILL[item.tone], fillOpacity: item.value === 0 ? 0.35 : 0.9 }}
            />
          );
        })}
        {data.map((item, index) => {
          const fullH = Math.max(0, (item.value / max) * plotH);
          const x = pad.left + slot * index + slot / 2;
          return (
            <g key={item.key + "-label"}>
              <text
                x={x}
                y={Math.max(pad.top + plotH - fullH - 8, pad.top - 8)}
                textAnchor="middle"
                fontSize={12}
                fill="var(--color-ink)"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatValue(item.value)}
              </text>
              <text x={x} y={pad.top + plotH + 20} textAnchor="middle" fontSize={12} fill="var(--color-muted)">
                {item.label}
              </text>
              {item.hint ? (
                <text x={x} y={pad.top + plotH + 36} textAnchor="middle" fontSize={11} fill="var(--color-muted)" opacity={0.75}>
                  {item.hint}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ChartTable caption={summary} headers={["Group", "Value"]} rows={rows} />
    </figure>
  );
}
