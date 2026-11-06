"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/cn";

/**
 * A verification seal: a soft hexagon holding a check. Reads as "evidence that
 * was verified" wherever it appears, independent of its surrounding label.
 */
export function SealMark({
  size = 18,
  tone = "positive",
  className,
}: {
  size?: number;
  tone?: "positive" | "accent" | "neutral";
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 20 20" width={size} height={size} fill="none">
        <path
          d="M10 1.5 17.5 5.6v8.8L10 18.5 2.5 14.4V5.6L10 1.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
          opacity="0.5"
        />
      </svg>
      <Check
        size={Math.round(size * 0.62)}
        strokeWidth={2.6}
        className={cn(
          "absolute",
          tone === "positive" && "text-positive",
          tone === "accent" && "text-accent",
          tone === "neutral" && "text-muted",
        )}
      />
    </span>
  );
}
