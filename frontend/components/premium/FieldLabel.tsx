import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * Instrument label — the small tracked caption used above a measured value.
 *
 * One type treatment for every label in the product, so structure reads as
 * machined rather than ad hoc. Optional rule draws the hairline that ties the
 * label to the value beneath it.
 */

export type FieldLabelProps = {
  children: ReactNode;
  /** Draws the instrument rule to the right of the text. */
  rule?: boolean;
  /** Accent colour of the rule's origin point. */
  tone?: "ice" | "emerald" | "amber" | "rose" | "neutral";
  className?: string;
};

const TONE: Record<NonNullable<FieldLabelProps["tone"]>, string> = {
  ice: "text-ice",
  emerald: "text-emerald",
  amber: "text-amber",
  rose: "text-rose",
  neutral: "text-dim",
};

export function FieldLabel({ children, rule = false, tone = "neutral", className }: FieldLabelProps) {
  return (
    // The label must never dictate the row width: a long caption used to keep
    // shrink-0 and pushed the whole row past the card, which on a phone put the
    // text off-screen. The label may now shrink and wrap, and the hairline rule
    // yields first on very narrow screens.
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      <span
        className={cn(
          "min-w-0 max-w-full text-[10px] font-medium uppercase tracking-[0.18em]",
          TONE[tone],
        )}
      >
        {children}
      </span>
      {rule ? (
        <span aria-hidden className="rule-instrument hidden h-px flex-1 sm:block" />
      ) : null}
    </div>
  );
}
