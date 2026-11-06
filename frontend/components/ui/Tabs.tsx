"use client";

import { useId } from "react";
import { motion } from "motion/react";

import { cn } from "@/lib/cn";
import { SPRING } from "@/lib/motion";

export type TabOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

/**
 * A segmented control with a sliding active pill. The indicator is a shared
 * layoutId, so it glides between options on a spring instead of jumping.
 */
export function Tabs<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label?: string;
  className?: string;
}): React.JSX.Element {
  const groupId = useId();
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-line bg-surface p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-120",
              selected ? "text-ink" : "text-muted hover:text-ink",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={groupId}
                aria-hidden
                className="absolute inset-0 rounded-full border border-line bg-raised"
                transition={SPRING}
              />
            ) : null}
            <span className="relative z-10">{option.label}</span>
            {option.count !== undefined ? (
              <span className="num relative z-10 text-2xs text-muted">{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
