import { cn } from "@/lib/cn";
import { clamp } from "@/lib/format";
import { type Tone, TONE_BAR } from "@/lib/vocab";

/** A meter. The track is a tone step, the fill is one flat hue. */
export function ProgressBar({
  value,
  tone = "accent",
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
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-raised", trackClassName, className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-240", TONE_BAR[tone])}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}
