"use client";

/**
 * A ratio drawn against a hard limit.
 *
 * The product's whole point is staying left of PayPal's 1.5 percent
 * high-volume line, so the limit is a flag on the scale rather than a note in
 * the caption.
 */

import { formatPercent } from "@/lib/format";
import { ChartTable } from "./ChartTable";

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
        <div className="relative h-3.5 rounded-[2px] bg-raised">
          <div
            className="absolute inset-y-0 left-0 rounded-[2px]"
            style={{
              width: ratioPct + "%",
              backgroundColor: over ? "var(--color-negative)" : "var(--color-positive)",
            }}
          />
          <div
            aria-hidden
            className="absolute -inset-y-1 w-0.5 bg-warning"
            style={{ left: limitPct + "%" }}
            title={"Limit " + formatValue(safeLimit)}
          />
        </div>
        <div className="mt-2 flex items-baseline justify-between text-xs text-muted">
          <span className="num">0%</span>
          <span className="num text-warning">Limit {formatValue(safeLimit)}</span>
          <span className="num">{formatValue(max)}</span>
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
