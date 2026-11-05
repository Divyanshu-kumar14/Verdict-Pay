"use client";

import { CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { ApiError } from "@/lib/api";
import { cn } from "@/lib/cn";

/** Never a silent failure: code, message, request id and one recovery action. */
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
      className={cn(
        "flex items-start gap-2.5 rounded-lg border border-rose/30 bg-rose/10 px-3.5 py-3",
        className,
      )}
    >
      <CircleAlert size={15} aria-hidden className="mt-0.5 shrink-0 text-rose" />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-rose">
            {error.code}
          </span>
          {error.status !== null ? (
            <span className="font-mono text-[10px] text-dim">HTTP {error.status}</span>
          ) : null}
        </div>
        <p className="text-[12.5px] leading-snug text-ink">{error.message}</p>
        {context ? <p className="text-[11.5px] text-muted">{context}</p> : null}
        {error.requestId ? (
          <p className="font-mono text-[10.5px] text-dim">
            request_id · <span className="text-muted">{error.requestId}</span>
          </p>
        ) : null}
        {error.details.length > 0 ? (
          <ul className="space-y-0.5 pt-1 font-mono text-[10.5px] text-muted">
            {error.details.slice(0, 3).map((detail, index) => (
              <li key={`${detail.field ?? "detail"}-${index}`}>
                {detail.field ? <span className="text-dim">{detail.field}: </span> : null}
                {detail.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {onRetry || onDismiss ? (
        <div className="flex shrink-0 flex-col items-end gap-1">
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
