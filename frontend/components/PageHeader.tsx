import type { ReactNode } from "react";

import { FieldLabel } from "@/components/premium/FieldLabel";
import { cn } from "@/lib/cn";

/** Page-level instrument masthead: rule, kicker, display title and meta rail. */
export function PageHeader({
  kicker,
  title,
  description,
  meta,
  actions,
  className,
}: {
  kicker: string;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "relative border-b border-hairline pb-5 pt-4 lg:flex lg:items-end lg:justify-between lg:gap-10",
        className,
      )}
    >
      <span aria-hidden className="rule-instrument absolute inset-x-0 top-0 h-px" />
      <div className="min-w-0 max-w-3xl">
        <FieldLabel rule>{kicker}</FieldLabel>
        <h1 className="mt-3 text-hero font-semibold text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">{description}</p>
        ) : null}
        {actions ? <div className="mt-4 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="mt-5 flex shrink-0 flex-wrap items-end gap-x-7 gap-y-4 lg:mt-0 lg:border-l lg:border-hairline lg:pl-7">
          {meta}
        </div>
      ) : null}
    </header>
  );
}

export function PageMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-[72px]">
      <FieldLabel>{label}</FieldLabel>
      <div className="tnum mt-1.5 font-mono text-[13px] leading-none text-ink">{value}</div>
    </div>
  );
}
