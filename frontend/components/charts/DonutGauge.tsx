"use client";

/**
 * A single reading drawn as one flat arc against a hairline track.
 *
 * One hue, one number, no segments and no shadow inside the ring.
 */

import { clamp } from "@/lib/format";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";

const TONE_STROKE: Record<Tone, string> = {
  positive: "var(--color-positive)",
  warning: "var(--color-warning)",
  negative: "var(--color-negative)",
  accent: "var(--color-accent)",
  neutral: "var(--color-chart-1)",
};

export function DonutGauge({
  value,
  formatValue,
  summary,
  tone = "positive",
  size = 168,
  caption,
  className,
}: {
  /** Fraction in [0, 1]. Clamped, never NaN on screen. */
  value: number;
  formatValue?: (value: number) => string;
  /** Spoken summary, e.g. "Win-rate estimate 62 percent of decided cases". */
  summary: string;
  tone?: Tone;
  size?: number;
  caption?: string;
  className?: string;
}): React.JSX.Element {
  const safe = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  const radius = 62;
  const circ = 2 * Math.PI * radius;
  const text = formatValue ? formatValue(safe) : Math.round(safe * 100) + "%";

  return (
    <figure className={className}>
      <div role="img" aria-label={summary} className="relative mx-auto" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" width={size} height={size} className="block">
          <circle cx={80} cy={80} r={radius} fill="none" stroke="var(--color-raised)" strokeWidth={11} />
          <circle
            cx={80}
            cy={80}
            r={radius}
            fill="none"
            strokeLinecap="round"
            strokeWidth={11}
            strokeDasharray={circ}
            strokeDashoffset={circ * (1 - safe)}
            transform="rotate(-90 80 80)"
            style={{ stroke: TONE_STROKE[tone] }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="value text-xl text-ink">{text}</span>
          {caption ? (
            <span className="mt-1.5 max-w-[110px] text-center text-xs text-muted">{caption}</span>
          ) : null}
        </div>
      </div>
      <ChartTable caption={summary} headers={["Metric", "Value"]} rows={[["Reading", text]]} />
    </figure>
  );
}
