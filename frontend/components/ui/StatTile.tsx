import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { type Tone, TONE_TEXT } from "@/lib/vocab";

export function StatTile({
  label,
  value,
  sub,
  tone = "neutral",
  mono = true,
  icon,
  emphasis = "default",
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  mono?: boolean;
  icon?: ReactNode;
  emphasis?: "default" | "headline";
  className?: string;
}) {
  return (
    <div className={cn("panel-flat px-3.5 py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="kicker">{label}</span>
        {icon ? <span className={TONE_TEXT[tone]}>{icon}</span> : null}
      </div>
      <div
        className={cn(
          "mt-1.5 font-medium leading-none tracking-[-0.02em]",
          emphasis === "headline" ? "text-[28px]" : "text-[19px]",
          mono && "num",
          TONE_TEXT[tone] === "text-muted" ? "text-ink" : TONE_TEXT[tone],
        )}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[11px] leading-snug text-muted">{sub}</div> : null}
    </div>
  );
}