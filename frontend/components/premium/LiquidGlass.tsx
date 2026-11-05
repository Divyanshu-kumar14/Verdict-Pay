"use client";

/**
 * Liquid glass surface (KokonutUI liquid-glass-card pattern).
 *
 * The pointer drives a soft specular highlight across the pane, so the surface
 * behaves like glass rather than a translucent rectangle. Used only where the
 * product means "sealed / under inspection": the hero verdict, evidence packs,
 * and the live case summary. One highlight per card, not per child.
 */

import { useCallback, useRef, type PointerEvent, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export type LiquidGlassProps = {
  children: ReactNode;
  /** 1 = quiet pane, 2 = default, 3 = focused evidence surface. */
  depth?: 1 | 2 | 3;
  /** Radius scale; glass cards use the panel radius. */
  className?: string;
  /** Adds the calibration grid beneath the glass. */
  grid?: boolean;
  /** Colours the top bevel and the aura with the instrument accent. */
  accent?: "ice" | "emerald" | "amber" | "rose" | "none";
};

const ACCENT: Record<NonNullable<LiquidGlassProps["accent"]>, string> = {
  ice: "rgba(125,211,252,0.42)",
  emerald: "rgba(46,230,168,0.42)",
  amber: "rgba(255,178,36,0.42)",
  rose: "rgba(255,92,120,0.42)",
  none: "rgba(255,255,255,0.26)",
};

const DEPTH: Record<NonNullable<LiquidGlassProps["depth"]>, string> = {
  1: "bg-white/[0.028] backdrop-blur-md border-white/[0.09]",
  2: "bg-white/[0.05] backdrop-blur-xl border-white/[0.13]",
  3: "bg-white/[0.075] backdrop-blur-2xl border-white/[0.18]",
};

export function LiquidGlass({
  children,
  depth = 2,
  className,
  grid = false,
  accent = "ice",
}: LiquidGlassProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const glowRef = useRef<HTMLDivElement | null>(null);

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const host = hostRef.current;
    const glow = glowRef.current;
    if (host === null || glow === null) return;
    const rect = host.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    glow.style.background = `radial-gradient(420px circle at ${x}% ${y}%, rgba(255,255,255,0.10), transparent 62%)`;
    glow.style.opacity = "1";
  }, []);

  const onPointerLeave = useCallback(() => {
    const glow = glowRef.current;
    if (glow !== null) glow.style.opacity = "0";
  }, []);

  return (
    <div
      ref={hostRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        "relative isolate overflow-hidden rounded-[14px] border shadow-[0_32px_64px_-32px_rgba(0,0,0,0.9)]",
        DEPTH[depth],
        className,
      )}
    >
      {grid ? (
        <div aria-hidden className="instrument-grid pointer-events-none absolute inset-0 opacity-60" />
      ) : null}

      {/* Specular top bevel — the single cue that separates glass from a tint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{
          background: `linear-gradient(90deg, transparent, ${ACCENT[accent]} 50%, transparent)`,
        }}
      />

      {/* Pointer-tracked sheen, painted into a child so React never re-renders. */}
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300"
      />

      <div className="relative z-10">{children}</div>
    </div>
  );
}
