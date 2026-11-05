import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Page-level masthead: kicker, title, plain-language description and meta rail. */
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
        "flex flex-col gap-4 border-b border-hairline pb-5 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="kicker">{kicker}</div>
        <h1 className="mt-1.5 text-[22px] font-semibold leading-[1.27] tracking-[-0.02em] text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-3xl text-[12.5px] leading-relaxed text-muted">{description}</p>
        ) : null}
        {actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {meta ? (
        <div className="flex shrink-0 flex-wrap items-end gap-x-6 gap-y-3">{meta}</div>
      ) : null}
    </header>
  );
}

export function PageMeta({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="kicker">{label}</div>
      <div className="num mt-1 text-[12px] text-ink">{value}</div>
    </div>
  );
}