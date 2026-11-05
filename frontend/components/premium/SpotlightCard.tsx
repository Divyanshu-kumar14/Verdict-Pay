"use client";

/**
 * Spotlight surface (Magic UI / Aceternity spotlight-card pattern).
 *
 * A cursor-tracked light on a dark panel. Cheaper than glass and used for dense
 * repeated cards (queue rows, metric tiles) where full glass would be noise.
 */

import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type SpotlightCardProps = {
  children: ReactNode;
  className?: string;
  /** Light colour; defaults to the instrument ice. */
  color?: string;
};

export function SpotlightCard({
  children,
  className,
  color = "rgba(125,211,252,0.10)",
}: SpotlightCardProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    const spot = spotRef.current;
    if (host === null || spot === null) return;
    const rect = host.getBoundingClientRect();
    spot.style.background = `radial-gradient(320px circle at ${event.clientX - rect.left}px ${
      event.clientY - rect.top
    }px, ${color}, transparent 68%)`;
    spot.style.opacity = "1";
  }, [color]);

  const onPointerLeave = useCallback(() => {
    const spot = spotRef.current;
    if (spot !== null) spot.style.opacity = "0";
  }, []);

  return (
    <div
      ref={hostRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        "group relative isolate overflow-hidden rounded-xl border border-white/[0.07] bg-white/[0.02] transition-colors duration-300 hover:border-white/[0.15]",
        className,
      )}
    >
      <div
        ref={spotRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
