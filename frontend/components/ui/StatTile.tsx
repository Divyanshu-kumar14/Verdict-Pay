import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * A KPI is a label and a figure: no tinted icon square above it, because a boxed
 * icon on every tile is the tell that the numbers were never the point.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  emphasis = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "positive" | "warning" | "negative" | "accent" | "neutral";
  emphasis?: "default" | "lead";
  className?: string;
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
      <div
        className={cn(
          "value mt-1.5",
          emphasis === "lead" ? "text-xl" : "text-lg",
          INK[tone],
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1 text-xs leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}
