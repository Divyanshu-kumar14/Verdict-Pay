import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Empty states always explain the next action. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-white/10 px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="grid h-10 w-10 place-items-center rounded-full border border-hairline bg-white/[0.02] text-muted">
          {icon}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        <p className="mx-auto max-w-sm text-[12px] text-muted">{description}</p>
      </div>
      {action ? <div className="pt-1">{action}</div> : null}
    </div>
  );
}
