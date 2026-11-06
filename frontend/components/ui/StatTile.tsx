import type { ReactNode } from "react";

import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { cn } from "@/lib/cn";

/**
 * A KPI is a label and a figure: no tinted icon square above it, because a boxed
 * icon on every tile is the tell that the numbers were never the point.
 *
 * Pass countValue + countFormat to count the figure up on first load (the
 * animation is a garnish only — reduced-motion renders the value directly), or
 * pass value + sub for a fully custom readout. Exactly one of the two shapes
 * is expected.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  className,
  countValue,
  countFormat,
}: {
  label: string;
  value?: ReactNode;
  sub?: ReactNode;
  tone?: "positive" | "warning" | "negative" | "accent" | "neutral";
  className?: string;
  countValue?: number;
  countFormat?: (n: number) => string;
}) {
  const INK = {
    positive: "text-positive",
    warning: "text-warning",
    negative: "text-negative",
    accent: "text-accent",
    neutral: "text-ink",
  } as const;

  return (
    <div className={cn("px-4 py-3.5", className)}>
      <p className="label">{label}</p>
      {/* divs, not paragraphs: value and sub are ReactNodes and may hold block
          content, which is invalid inside a p. */}
      {/* KPI figures sit at the 20px "section" scale of the type stack. A larger
          26px value reads as a headline in the design gate's covered-text hit-test,
          and on mobile the fixed bottom nav overlaps a tile that lands at the fold. */}
      <div className={cn("value mt-1.5 text-lg", INK[tone])}>
        {countValue !== undefined && countFormat ? (
          <AnimatedNumber value={countValue} format={countFormat} />
        ) : (
          value
        )}
      </div>
      {sub ? <div className="mt-1 text-xs leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}
