import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { TONE_BADGE, TONE_DOT, type Tone } from "@/lib/vocab";

export type BadgeProps = {
  children: ReactNode;
  tone?: Tone;
  mono?: boolean;
  dot?: boolean;
  title?: string;
  className?: string;
  size?: "xs" | "sm";
};

/** Status chip. Always carries text; colour is a secondary encoding only. */
export function Badge({
  children,
  tone = "neutral",
  mono = false,
  dot = false,
  title,
  className,
  size = "xs",
}: BadgeProps) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded border font-medium",
        size === "xs"
          ? "px-1.5 py-[2px] text-[10px] tracking-[0.06em]"
          : "px-2 py-1 text-[11px] tracking-[0.04em]",
        mono && "font-mono tracking-normal normal-case",
        TONE_BADGE[tone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1 w-1 rounded-full", TONE_DOT[tone])} /> : null}
      {children}
    </span>
  );
}
