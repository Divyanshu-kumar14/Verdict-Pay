"use client";

import type { ReactNode } from "react";

/**
 * Motion shims for the sandbox cluster.
 *
 * The product renders app screens with no entrance motion, so these carry no
 * animation at all: they render their children directly and report the resting
 * state. They exist only so the modules that grew up around the old premium
 * entrance primitives keep a stable, dependency-free surface.
 */

export type SafeNumberTickerProps = {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  className?: string;
};

/** A plain span holding the formatted figure. Nothing ticks. */
export function SafeNumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
}: SafeNumberTickerProps): ReactNode {
  return (
    <span className={className}>
      {prefix}
      {value.toFixed(decimals)}
      {suffix}
    </span>
  );
}

/** No wrapper element: the children are the layout. */
export function SafeStagger({ children }: { children: ReactNode }): ReactNode {
  return children;
}

/** No wrapper element: the children are the layout. */
export function SafeStaggerItem({ children }: { children: ReactNode }): ReactNode {
  return children;
}
