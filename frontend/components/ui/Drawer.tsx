"use client";

import { useEffect, useId, useRef } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { SPRING_SOFT } from "@/lib/motion";

/**
 * A right-hand case panel that slides in on a spring and traps focus while
 * open. Escape and the scrim both close it; focus returns to the opener.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = 560,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}): React.JSX.Element {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-modal">
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <motion.aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="absolute inset-y-0 right-0 flex flex-col bg-surface shadow-float outline-none"
            style={{ width: "min(100vw, " + width + "px)", borderLeft: "1px solid var(--color-line)" }}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={SPRING_SOFT}
          >
            <div className="flex items-start justify-between gap-4 border-b border-rule px-5 py-4">
              <div className="min-w-0">
                <h2 id={titleId} className="title-card">
                  {title}
                </h2>
                {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted transition-colors duration-120 hover:bg-raised hover:text-ink"
              >
                <X size={16} strokeWidth={1.7} aria-hidden />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
            {footer ? (
              <div className="border-t border-rule px-5 py-3.5">{footer}</div>
            ) : null}
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
