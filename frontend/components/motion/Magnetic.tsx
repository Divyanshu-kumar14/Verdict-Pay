"use client";

import { motion, useReducedMotion, useSpring } from "motion/react";
import { useRef, type PointerEvent, type ReactNode } from "react";

import { SPRING } from "@/lib/motion";

/**
 * Subtle magnetic pull for primary actions. Desktop / fine-pointer only: the
 * element drifts toward the cursor by at most strength and springs back on
 * leave. Disabled under reduced motion and on coarse pointers.
 */
export function Magnetic({
  children,
  strength = 8,
  className,
}: {
  children: ReactNode;
  strength?: number;
  className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const ref = useRef<HTMLDivElement | null>(null);
  const x = useSpring(0, { ...SPRING, stiffness: 300 });
  const y = useSpring(0, { ...SPRING, stiffness: 300 });

  function onMove(event: PointerEvent<HTMLDivElement>) {
    if (reduced) return;
    if (event.pointerType !== "mouse") return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    x.set(dx * (strength / (rect.width / 2)));
    y.set(dy * (strength / (rect.height / 2)));
  }

  function onLeave() {
    x.set(0);
    y.set(0);
  }

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ x, y }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
    >
      {children}
    </motion.div>
  );
}
