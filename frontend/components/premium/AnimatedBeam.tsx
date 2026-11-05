"use client";

/**
 * Animated beam (Magic UI AnimatedBeam pattern).
 *
 * Draws the custody path between two refs: ledger -> dispute -> PayPal. The
 * gradient travels along the path on a loop, which communicates "evidence in
 * transit" instead of decorating a diagram.
 *
 * Degrades to a static dashed line under prefers-reduced-motion.
 */

import { useEffect, useId, useRef, useState, type RefObject } from "react";

export type AnimatedBeamProps = {
  containerRef: RefObject<HTMLElement | null>;
  fromRef: RefObject<HTMLElement | null>;
  toRef: RefObject<HTMLElement | null>;
  /** Curve depth in px. 0 is a straight line. */
  curvature?: number;
  /** Gradient stops for the travelling light. */
  colorFrom?: string;
  colorTo?: string;
  durationSeconds?: number;
  strokeWidth?: number;
};

export function AnimatedBeam({
  containerRef,
  fromRef,
  toRef,
  curvature = 0,
  colorFrom = "#7dd3fc",
  colorTo = "#2ee6a8",
  durationSeconds = 5,
  strokeWidth = 1.5,
}: AnimatedBeamProps) {
  const id = useId();
  const [path, setPath] = useState<string>("");
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const frame = useRef(0);

  useEffect(() => {
    const measure = (): void => {
      const container = containerRef.current;
      const from = fromRef.current;
      const to = toRef.current;
      if (container === null || from === null || to === null) return;

      const box = container.getBoundingClientRect();
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();

      const x1 = a.left - box.left + a.width / 2;
      const y1 = a.top - box.top + a.height / 2;
      const x2 = b.left - box.left + b.width / 2;
      const y2 = b.top - box.top + b.height / 2;
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 - curvature;

      setSize({ w: box.width, h: box.height });
      setPath(`M ${x1},${y1} Q ${midX},${midY} ${x2},${y2}`);
    };

    frame.current = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    if (containerRef.current !== null) observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
    };
  }, [containerRef, fromRef, toRef, curvature]);

  if (path === "" || size.w === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox={`0 0 ${size.w} ${size.h}`}
      fill="none"
    >
      <path d={path} stroke="rgba(255,255,255,0.10)" strokeWidth={strokeWidth} strokeDasharray="3 5" />
      <path d={path} stroke={`url(#${id})`} strokeWidth={strokeWidth} strokeLinecap="round">
        <animate
          attributeName="stroke-dasharray"
          values="0 1000;180 1000;180 1000"
          dur={`${durationSeconds}s`}
          repeatCount="indefinite"
        />
        <animate
          attributeName="stroke-dashoffset"
          values="0;-1000"
          dur={`${durationSeconds}s`}
          repeatCount="indefinite"
        />
      </path>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor={colorFrom} stopOpacity="0" />
          <stop offset="45%" stopColor={colorFrom} stopOpacity="0.9" />
          <stop offset="100%" stopColor={colorTo} stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}
