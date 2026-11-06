import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TONE_BADGE, TONE_DOT, type Tone } from "@/lib/vocab";

export type BadgeProps = {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
  title?: string;
  className?: string;
  size?: "sm" | "md";
};

/**
 * Status pill: a tinted ground with readable ink on it. Always carries words,
 * so colour is a second encoding and never the only one.
 */
export function Badge({
  children,
  tone = "neutral",
  dot = false,
  title,
  className,
  size = "sm",
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium",
        size === "sm" ? "h-5 px-2 text-2xs" : "h-6 px-2.5 text-xs",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", TONE_DOT[tone])} /> : null}
      {children}
    </span>
  );
}
