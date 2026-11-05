import { cn } from "@/lib/cn";
import { clamp } from "@/lib/format";
import { type Tone, TONE_BAR } from "@/lib/vocab";

/** Thin meter used for p(win) and signal contribution bars. */
export function ProgressBar({
  value,
  tone = "emerald",
  label,
  className,
  trackClassName,
}: {
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
  trackClassName?: string;
}) {
  const pct = clamp(value, 0, 1) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]", trackClassName, className)}
    >
      <div className={cn("h-full rounded-full transition-[width]", TONE_BAR[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}
