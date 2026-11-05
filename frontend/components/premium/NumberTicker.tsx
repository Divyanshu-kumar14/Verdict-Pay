"use client";

/**
 * Number that resolves to its value (Magic UI number-ticker pattern).
 *
 * Fail-visible: the resting state is the real value. The count-up only runs
 * when the browser allows motion, and it is mount-based rather than waiting for
 * the element to scroll into view — a metric that depends on being looked at is
 * a broken metric. Tabular figures stop the width jittering as digits change.
 */

import { useEffect, useState } from "react";
import { animate } from "motion/react";

export type NumberTickerProps = {
  value: number;
  /** Decimal places to hold while counting. */
  decimals?: number;
  /** Prefix and suffix keep money exact at rest. */
  prefix?: string;
  suffix?: string;
  className?: string;
  /** Seconds; short, because a number that dawdles reads as decoration. */
  duration?: number;
};

export function NumberTicker({
  value,
  decimals = 0,
  prefix = "",
  suffix = "",
  className,
  duration = 0.9,
}: NumberTickerProps) {
  // Resting state is the true value, so server output and any failure are correct.
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const controls = animate(0, value, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (latest) => setShown(latest),
      onComplete: () => setShown(value),
    });
    return () => controls.stop();
  }, [value, duration]);

  return (
    <span className={className}>
      {prefix}
      {shown.toFixed(decimals)}
      {suffix}
    </span>
  );
}
