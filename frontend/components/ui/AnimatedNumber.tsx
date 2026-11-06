"use client";

/**
 * A figure that eases toward its value, for KPI counts on first load.
 *
 * Uses Motion's reduced-motion signal so the number lands instantly when the
 * reader prefers stillness; otherwise it counts up over ~500ms with an
 * ease-out. It reports the formatted value either way — animation is a
 * garnish, never the record.
 */

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);

export function AnimatedNumber({
  value,
  format,
  duration = 500,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
}): React.JSX.Element {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    fromRef.current = display;
  }, [display]);

  useEffect(() => {
    const from = fromRef.current;
    if (reduced || from === value) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min(1, (now - start) / duration);
      setDisplay(from + (value - from) * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [value, duration, reduced]);

  return <>{format(display)}</>;
}
