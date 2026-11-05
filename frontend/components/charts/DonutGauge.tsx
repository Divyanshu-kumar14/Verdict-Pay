"use client";

/**
 * Hand-built donut gauge: a single flat arc against a hairline track with the
 * reading set large in the middle. One hue, one number, no segments.
 */

import { clamp } from "@/lib/format";
import type { Tone } from "@/lib/vocab";
import { ChartTable } from "./ChartTable";
import { useReveal } from "./use-reveal";

const TONE_STROKE: Record<Tone, string> = {
  emerald: "var(--color-emerald)",
  amber: "var(--color-amber)",
  rose: "var(--color-rose)",
  sky: "var(--color-sky)",
  neutral: "rgba(255,255,255,0.55)",
};

export function DonutGauge({
  value,
  formatValue,
  summary,
  tone = "emerald",
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
  const { ready, reduce } = useReveal();
  const safe = Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  const radius = 62;
  const circ = 2 * Math.PI * radius;
  const text = formatValue ? formatValue(safe) : Math.round(safe * 100) + "%";

  return (
    <figure className={className}>
      <div role="img" aria-label={summary} className="relative mx-auto" style={{ width: size, height: size }}>
        <svg viewBox="0 0 160 160" width={size} height={size} className="block">
          <circle cx={80} cy={80} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={11} />
          <circle
            cx={80}
            cy={80}
            r={radius}
            fill="none"
            strokeLinecap="round"
            strokeWidth={11}
            strokeDasharray={circ}
            strokeDashoffset={ready ? circ * (1 - safe) : circ}
            transform="rotate(-90 80 80)"
            style={{
              stroke: TONE_STROKE[tone],
              transition: reduce ? undefined : "stroke-dashoffset 1000ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="tnum font-mono text-[26px] font-medium leading-none tracking-[-0.02em] text-ink">{text}</span>
          {caption ? (
            <span className="mt-1.5 max-w-[110px] text-center text-[9px] font-medium uppercase leading-snug tracking-[0.14em] text-dim">
              {caption}
            </span>
          ) : null}
        </div>
      </div>
      <ChartTable caption={summary} headers={["Metric", "Value"]} rows={[["Reading", text]]} />
    </figure>
  );
}