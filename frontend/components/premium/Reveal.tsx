"use client";

/**
 * Entrance motion for a section (Motion springs).
 *
 * FAIL-VISIBLE, BY DESIGN. Earlier this primitive started at opacity 0 and
 * waited for IntersectionObserver to reveal it. When the observer never fired
 * (headless render, nested scroller, an aggressive viewport margin) the content
 * stayed invisible forever while still occupying layout — panels read as
 * missing and their neighbours looked collided.
 *
 * The contract now:
 *   server + first paint  -> plain, fully visible markup (no inline opacity)
 *   after hydration       -> the entrance plays, once, from a hidden state
 *   reduced motion / no JS / any failure -> the resting state is visible
 *
 * The entrance is mount-based, not viewport-based: a dashboard panel must not
 * depend on the reader scrolling to the right place before it can be read.
 * One Reveal per section; children stagger, they do not each animate.
 */

import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";

/** True only in a browser that allows motion. Never true during SSR. */
function useEntranceEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setEnabled(true);
  }, []);
  return enabled;
}

export type RevealProps = {
  children: ReactNode;
  /** Seconds to wait before this group resolves. */
  delay?: number;
  /** Travel distance in px; keep small, this is not a slideshow. */
  y?: number;
  className?: string;
};

export function Reveal({ children, delay = 0, y = 14, className }: RevealProps) {
  const enabled = useEntranceEnabled();

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 210, damping: 26, mass: 0.7, delay }}
    >
      {children}
    </motion.div>
  );
}

export type StaggerProps = {
  children: ReactNode;
  className?: string;
  /** Gap between children in seconds. */
  step?: number;
};

export function Stagger({ children, className, step = 0.07 }: StaggerProps) {
  const enabled = useEntranceEnabled();

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: step } } }}
    >
      {children}
    </motion.div>
  );
}

/**
 * A staggered child. Variants come from the enclosing Stagger, so a standalone
 * StaggerItem carries no initial state and therefore renders visible.
 */
export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const enabled = useEntranceEnabled();

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 16 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 200, damping: 25 } },
      }}
    >
      {children}
    </motion.div>
  );
}
