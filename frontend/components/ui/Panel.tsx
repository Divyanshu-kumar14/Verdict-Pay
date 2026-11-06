import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** A card sits one step darker than the ground and is closed by a quiet line. */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

/**
 * Card head. The title names the block in sentence case at 16px; there is no
 * kicker above it, because a label repeated above every title is furniture.
 */
export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 px-4 py-3.5",
        className,
      )}
    >
      <div className="min-w-0">
        {title ? <h2 className="title-card">{title}</h2> : null}
        {description ? (
          <p className="mt-1 max-w-[60ch] text-xs text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("px-4 py-3.5", className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("row-rule px-4 py-2.5", className)} {...rest}>
      {children}
    </div>
  );
}
