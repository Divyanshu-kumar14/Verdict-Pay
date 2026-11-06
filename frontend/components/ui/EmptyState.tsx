import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

/** Empty states are unboxed and always name the next action. */
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
    <div className={cn("flex flex-col items-start gap-2 px-4 py-10", className)}>
      {icon ? <span className="text-muted">{icon}</span> : null}
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-[60ch] text-sm text-muted">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}
