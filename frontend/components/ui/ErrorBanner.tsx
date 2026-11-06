"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Never a silent failure: what broke, and one way to recover. */
export function ErrorBanner({
  error,
  onRetry,
  onDismiss,
  context,
  className,
}: {
  error: ApiError;
  onRetry?: () => void;
  onDismiss?: () => void;
  context?: string;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn("panel relative flex items-start gap-3 overflow-hidden py-3 pr-3 pl-4", className)}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-px bg-negative" />
      <CircleAlert size={16} aria-hidden className="mt-0.5 shrink-0 text-negative" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm text-ink">{error.message}</p>
        {context ? <p className="text-xs text-muted">{context}</p> : null}
        <p className="num text-xs text-muted">
          {error.code}
          {error.status !== null ? " · HTTP " + error.status : ""}
          {error.requestId ? " · " + error.requestId : ""}
        </p>
        {error.details.length > 0 ? (
          <ul className="num space-y-0.5 pt-1 text-xs text-muted">
            {error.details.slice(0, 3).map(function (detail, index) {
              return (
                <li key={(detail.field || "detail") + "-" + index}>
                  {detail.field ? detail.field + ": " : ""}
                  {detail.message}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      {onRetry || onDismiss ? (
        <div className="flex shrink-0 items-center gap-1">
          {onRetry ? (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Retry
            </Button>
          ) : null}
          {onDismiss ? (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
