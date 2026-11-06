"use client";

/**
 * A lightweight hover/focus tooltip. The trigger is rendered by the caller and
 * the label appears above it with a short fade; it is removed from the tab
 * order but reachable via the trigger's focus state, so it reads in a keyboard
 * flow. Positioning is fixed, so wrap in an element with position relative
 * where a specific side matters.
 */

import { useState } from "react";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Tooltip({
  label,
  children,
  side = "top",
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}): React.JSX.Element {
  const [visible, setVisible] = useState(false);

  const sideClass = {
    top: "bottom-full left-1/2 mb-2 -translate-x-1/2",
    bottom: "top-full left-1/2 mt-2 -translate-x-1/2",
    left: "right-full top-1/2 mr-2 -translate-y-1/2",
    right: "left-full top-1/2 ml-2 -translate-y-1/2",
  }[side];

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      <span
        role="tooltip"
        aria-hidden={!visible}
        className={cn(
          "pointer-events-none absolute z-toast whitespace-nowrap rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink shadow-float transition-opacity duration-120",
          sideClass,
          visible ? "opacity-100" : "opacity-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
