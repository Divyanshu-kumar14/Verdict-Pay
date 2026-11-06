import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/**
 * The screen's title, in sentence case at 26px, with the numbers that qualify it
 * on the right. A screen is named, not announced: no kicker sits above this.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "pb-6 lg:flex lg:items-end lg:justify-between lg:gap-10",
        className,
      )}
    >
      <div className="min-w-0 max-w-[70ch]">
        <h1 className="text-xl font-semibold text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 text-base text-muted">{description}</p>
        ) : null}
        {actions ? (
          <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? (
        <div className="mt-5 flex shrink-0 flex-wrap items-end gap-x-8 gap-y-4 lg:mt-0">
          {meta}
        </div>
      ) : null}
    </header>
  );
}

export function PageMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[80px]">
      <p className="label">{label}</p>
      {/* a div, not a p: value is a ReactNode and a caller may pass block content
          (a loading placeholder), which is invalid inside a paragraph. */}
      <div className="num mt-1.5 text-lg font-semibold text-ink">{value}</div>
    </div>
  );
}
