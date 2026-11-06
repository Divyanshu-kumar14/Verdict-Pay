"use client";

/**
 * A page entrance: the canvas rises 8px and settles in 220ms. Shared by every
 * route so the whole application enters with one consistent gesture.
 */

import { motion } from "motion/react";
import type { ReactNode } from "react";

import { fadeUp } from "@/lib/motion";

export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="show" className={className}>
      {children}
    </motion.div>
  );
}
