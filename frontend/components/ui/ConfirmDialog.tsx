"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/Button";

/**
 * Confirmation for irreversible PayPal actions: focus is trapped, Escape
 * cancels, the page behind cannot scroll, and the confirm control is focused
 * on open so the action is reachable without a mouse.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "positive",
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "positive" | "negative";
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef(onCancel);

  useEffect(function () {
    cancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(
    function () {
      if (!open) return;
      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";

      const onKeyDown = function (event: KeyboardEvent): void {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRef.current();
          return;
        }
        if (event.key !== "Tab") return;
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      document.addEventListener("keydown", onKeyDown);
      return function () {
        document.body.style.overflow = previousOverflow;
        document.removeEventListener("keydown", onKeyDown);
      };
    },
    [open],
  );

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-modal flex items-end justify-center bg-black/70 p-4 sm:items-center">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby={description ? "confirm-dialog-description" : undefined}
        className="panel w-full max-w-md shadow-float"
      >
        <div className="px-4 py-3.5">
          <h2 id="confirm-dialog-title" className="title-card">
            {title}
          </h2>
          {description ? (
            <p id="confirm-dialog-description" className="mt-1 text-sm text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {children ? <div className="row-rule px-4 py-3.5">{children}</div> : null}
        <div className="row-rule flex items-center justify-end gap-2 px-4 py-3">
          <Button
            autoFocus={tone === "negative"}
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </Button>
          <Button
            autoFocus={tone !== "negative"}
            variant={tone === "negative" ? "danger" : "primary"}
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
