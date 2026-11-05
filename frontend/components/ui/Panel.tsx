import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Layered dark panel with a one-pixel hairline border. */
export function Panel({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelHeader({
  kicker,
  title,
  description,
  actions,
  className,
}: {
  kicker?: string;
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-hairline px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker ? <div className="kicker">{kicker}</div> : null}
        {title ? (
          <h2 className="mt-0.5 text-[13px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
        ) : null}
        {description ? <p className="mt-0.5 text-[12px] text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function PanelBody({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("p-4", className)} {...rest}>
      {children}
    </div>
  );
}

export function PanelFooter({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("border-t border-hairline px-4 py-2.5", className)} {...rest}>
      {children}
    </div>
  );
}