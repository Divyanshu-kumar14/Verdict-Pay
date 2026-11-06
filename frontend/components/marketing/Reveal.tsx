"use client";

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { EASE_OUT } from "@/lib/motion";

/** Scroll reveal shared by every landing section: 220ms ease-out, once. */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-72px" }}
      transition={{ duration: 0.22, ease: EASE_OUT, delay }}
    >
      {children}
    </motion.div>
  );
}
