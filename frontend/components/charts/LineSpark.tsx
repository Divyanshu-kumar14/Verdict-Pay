"use client";

/**
 * A line over time with a scale and dates.
 *
 * One stroke, one end marker, a baseline and a labelled y-scale. There is no
 * area fill: a fill would be a gradient by another name.
 */

import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";

const TONE_STROKE: Record<Tone, string> = {
  positive: "var(--color-positive)",
  warning: "var(--color-warning)",
  negative: "var(--color-negative)",
  accent: "var(--color-accent)",
  neutral: "var(--color-chart-1)",
};

export function LineSpark({
  points,
  labels = [],
  formatValue = (value) => String(value),
  summary,
  tone = "accent",
  height = 96,
  className,
}: {
  points: number[];
  labels?: string[];
  formatValue?: (value: number) => string;
  /** Spoken summary, e.g. "New cases per day, last 14 days: peak 3 on Nov 2". */
  summary: string;
  tone?: Tone;
  height?: number;
  className?: string;
}): React.JSX.Element {
  const width = 560;
  const pad = { top: 12, right: 12, bottom: 26, left: 40 };
  const safeHeight = Math.max(height, pad.top + pad.bottom + 40);
  const plotW = width - pad.left - pad.right;
  const plotH = safeHeight - pad.top - pad.bottom;
  const max = Math.max(0, ...points);
  const step = points.length > 1 ? plotW / (points.length - 1) : 0;
  const yOf = (value: number) => pad.top + plotH - (max > 0 ? value / max : 0) * plotH;
  const coords = points.map((value, index) => ({ x: pad.left + step * index, y: yOf(value) }));
  const line = coords.map((pt, index) => (index === 0 ? "M " + pt.x + "," + pt.y : " L " + pt.x + "," + pt.y)).join("");
  const last = coords.length > 0 ? (coords[coords.length - 1] ?? null) : null;
  const lastValue = points.length > 0 ? (points[points.length - 1] ?? null) : null;
  const rows: Array<[string, string]> = points.map((value, index) => [
    labels[index] ?? "Point " + (index + 1),
    formatValue(value),
  ]);

  if (points.length < 2) {
    return (
      <figure className={className}>
        <p className="py-6 text-center text-sm text-muted">Not enough points for a trend yet.</p>
        <ChartTable caption={summary} headers={["Bucket", "Value"]} rows={rows} />
      </figure>
    );
  }

  const firstLabel = labels[0] ?? "";
  const lastLabel = labels[labels.length - 1] ?? "";

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={"0 0 " + width + " " + safeHeight} style={{ height: safeHeight }} className="h-auto w-full" role="img" aria-label={summary}>
        <line x1={pad.left} x2={width - pad.right} y1={pad.top} y2={pad.top} stroke="var(--color-rule)" strokeWidth={1} />
        <line
          x1={pad.left}
          x2={width - pad.right}
          y1={pad.top + plotH}
          y2={pad.top + plotH}
          stroke="var(--color-control)"
          strokeWidth={1}
        />
        <text x={pad.left - 10} y={pad.top + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">
          {formatValue(max)}
        </text>
        <text x={pad.left - 10} y={pad.top + plotH + 4} textAnchor="end" fontSize={12} fill="var(--color-muted)">
          0
        </text>
        <path d={line} fill="none" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" style={{ stroke: TONE_STROKE[tone] }} />
        {last !== null && lastValue !== null ? (
          <circle cx={last.x} cy={last.y} r={3} style={{ fill: TONE_STROKE[tone] }} />
        ) : null}
        {firstLabel ? (
          <text x={pad.left} y={safeHeight - 8} fontSize={12} fill="var(--color-muted)">
            {firstLabel}
          </text>
        ) : null}
        {lastLabel ? (
          <text x={width - pad.right} y={safeHeight - 8} textAnchor="end" fontSize={12} fill="var(--color-muted)">
            {lastLabel}
          </text>
        ) : null}
      </svg>
      <ChartTable caption={summary} headers={["Bucket", "Value"]} rows={rows} />
    </figure>
  );
}
