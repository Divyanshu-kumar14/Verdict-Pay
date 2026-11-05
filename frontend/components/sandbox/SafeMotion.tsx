"use client";

import { useEffect, useState, type ReactNode } from "react";

import {
  NumberTicker,
  Stagger,
  StaggerItem,
  type NumberTickerProps,
} from "@/components/premium";

/**
 * Motion with a static fallback. The premium entrance primitives need
 * IntersectionObserver, which jsdom does not provide, and the product law
 * disables every entrance under prefers-reduced-motion. When either applies,
 * these render the exact resting state — same classes, same copy, no motion.
 */

function useMotionAllowed(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setAllowed(typeof IntersectionObserver !== "undefined" && !reduced);
  }, []);
  return allowed;
}

export function SafeNumberTicker(props: NumberTickerProps) {
  const allowed = useMotionAllowed();
  if (!allowed) {
    const { value, decimals = 0, prefix = "", suffix = "", className } = props;
    return (
      <span className={className}>
        {prefix}
        {value.toFixed(decimals)}
        {suffix}
      </span>
    );
  }
  return <NumberTicker {...props} />;
}

export function SafeStagger({
  children,
  className,
  step = 0.07,
}: {
  children: ReactNode;
  className?: string;
  step?: number;
}) {
  const allowed = useMotionAllowed();
  if (!allowed) {
    return <div className={className}>{children}</div>;
  }
  return (
    <Stagger className={className} step={step}>
      {children}
    </Stagger>
  );
}

export function SafeStaggerItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const allowed = useMotionAllowed();
  if (!allowed) {
    return <div className={className}>{children}</div>;
  }
  return <StaggerItem className={className}>{children}</StaggerItem>;
}
