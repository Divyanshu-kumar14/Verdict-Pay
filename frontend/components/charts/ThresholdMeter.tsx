"use client";

/**
 * Hand-built threshold meter: a ratio drawn against a hard limit, with the
 * limit marked as a flag on the scale. The product's whole point is staying
 * left of PayPal's 1.5 percent high-volume line, so the line is the chart.
 */

import { formatPercent } from "@/lib/format";
import { ChartTable } from "./ChartTable";
import { useReveal } from "./use-reveal";

export function ThresholdMeter({
  ratio,
  limit,
  scaleMax,
  formatValue = (value) => formatPercent(value, 2),
  summary,
  className,
}: {
  /** Current ratio as a fraction (e.g. 0.011 for 1.1 percent). */
  ratio: number;
  /** Hard limit as a fraction (e.g. 0.015 for the PayPal line). */
  limit: number;
  /** Right edge of the scale; defaults to 1.4x the limit. */
  scaleMax?: number;
  formatValue?: (value: number) => string;
  /** Spoken summary of ratio versus limit. */
  summary: string;
  className?: string;
}): React.JSX.Element {
  const { ready, reduce } = useReveal();
  const safeLimit = limit > 0 ? limit : 0.015;
  const max = scaleMax ?? Math.max(safeLimit * 1.4, ratio * 1.1, 0.02);
  const ratioPct = Math.min(100, Math.max(0, (ratio / max) * 100));
  const limitPct = Math.min(100, Math.max(0, (safeLimit / max) * 100));
  const over = ratio >= safeLimit;

  return (
    <figure className={className}>
      <div
        role="meter"
        aria-label={summary}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((ratio / max) * 100)}
        aria-valuetext={formatValue(ratio) + " against a limit of " + formatValue(safeLimit)}
      >
        <div className="relative h-[14px] overflow-visible rounded-[4px] bg-white/[0.05]">
          <div
            className={over ? "absolute inset-y-0 left-0 rounded-[4px] bg-rose/70" : "absolute inset-y-0 left-0 rounded-[4px] bg-emerald/60"}
            style={{
              width: ready ? ratioPct + "%" : "0%",
              transition: reduce ? undefined : "width 900ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
          <div className="absolute -inset-y-[5px] w-[2px] bg-amber" style={{ left: limitPct + "%" }} title={"Limit " + formatValue(safeLimit)} />
        </div>
        <div className="mt-1.5 flex items-baseline justify-between font-mono text-[9.5px] text-dim">
          <span className="tnum">0%</span>
          <span className="tnum text-amber">LIMIT {formatValue(safeLimit)}</span>
          <span className="tnum">{formatValue(max)}</span>
        </div>
      </div>
      <ChartTable
        caption={summary}
        headers={["Measure", "Value"]}
        rows={[
          ["Current ratio", formatValue(ratio)],
          ["Limit", formatValue(safeLimit)],
          ["Scale maximum", formatValue(max)],
        ]}
      />
    </figure>
  );
}