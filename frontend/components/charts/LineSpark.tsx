"use client";

/**
 * Hand-built sparkline: one instrument-ice line, an end reading, no fill
 * gradient, no grid. For intake-over-time shapes where the slope is the story.
 */

import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";
import { useReveal } from "./use-reveal";

const TONE_STROKE: Record<Tone, string> = {
  emerald: "var(--color-emerald)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose)",
  sky: "var(--color-sky)",
  neutral: "rgba(255,255,255,0.5)",
};

export function LineSpark({
  points,
  labels = [],
  formatValue = (value) => String(value),
  summary,
  tone = "sky",
  height = 72,
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
  const { ready, reduce } = useReveal();
  const width = 560;
  const padX = 4;
  const padY = 8;
  const max = Math.max(1, ...points);
  const min = Math.min(0, ...points);
  const span = Math.max(1, max - min);
  const step = points.length > 1 ? (width - padX * 2) / (points.length - 1) : 0;
  const coords = points.map((value, index) => {
    const x = padX + step * index;
    const y = padY + (1 - (value - min) / span) * (height - padY * 2);
    return { x, y };
  });
  const line = coords.map((pt, index) => (index === 0 ? "M " + pt.x + "," + pt.y : " L " + pt.x + "," + pt.y)).join("");
  const last = coords.length > 0 ? (coords[coords.length - 1] ?? null) : null;
  const lastValue = points.length > 0 ? (points[points.length - 1] ?? null) : null;
  const rows: Array<[string, string]> = points.map((value, index) => {
    const label = labels[index] ?? "Point " + (index + 1);
    return [label, formatValue(value)];
  });

  if (points.length < 2) {
    return (
      <figure className={className}>
        <p className="py-6 text-center text-[11px] text-dim">Not enough points for a trend yet.</p>
        <ChartTable caption={summary} headers={["Bucket", "Value"]} rows={rows} />
      </figure>
    );
  }

  return (
    <figure className={cn("w-full", className)}>
      <svg viewBox={"0 0 " + width + " " + height} style={{ height }} className="h-auto w-full" role="img" aria-label={summary}>
        <line x1={padX} x2={width - padX} y1={height - 1.5} y2={height - 1.5} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        <path
          d={line}
          fill="none"
          strokeWidth={1.75}
          strokeLinejoin="round"
          strokeLinecap="round"
          pathLength={1}
          style={{
            stroke: TONE_STROKE[tone],
            strokeDasharray: 1,
            strokeDashoffset: ready ? 0 : 1,
            transition: reduce ? undefined : "stroke-dashoffset 900ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        />
        {last !== null && lastValue !== null ? (
          <g style={{ opacity: ready ? 1 : 0, transition: reduce ? undefined : "opacity 400ms ease 700ms" }}>
            <circle cx={last.x} cy={last.y} r={3} style={{ fill: TONE_STROKE[tone] }} />
            <circle cx={last.x} cy={last.y} r={6.5} fill="none" strokeWidth={1} style={{ stroke: TONE_STROKE[tone], opacity: 0.4 }} />
          </g>
        ) : null}
      </svg>
      <ChartTable caption={summary} headers={["Bucket", "Value"]} rows={rows} />
    </figure>
  );
}