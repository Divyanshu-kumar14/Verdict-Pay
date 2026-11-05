import { Check, Minus } from "lucide-react";

import { FieldLabel } from "@/components/premium/FieldLabel";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { cn } from "@/lib/cn";
import { formatDelta, formatPercent } from "@/lib/format";
import type { WinProbability } from "@/lib/types";
import type { Tone } from "@/lib/vocab";

function scoreTone(score: number): Tone {
  if (score >= 0.55) return "emerald";
  if (score >= 0.35) return "amber";
  return "rose";
}

function scoreWord(score: number): string {
  if (score >= 0.55) return "strong";
  if (score >= 0.35) return "contested";
  return "weak";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-white/[0.012] px-2.5 py-2">
      <FieldLabel>{label}</FieldLabel>
      <div className="num mt-1 text-[13px] text-ink">{value}</div>
    </div>
  );
}

/** Six deterministic signals, their deltas and whether they are present. */
export function WinProbabilityPanel({ probability }: { probability: WinProbability }) {
  const tone = scoreTone(probability.score);

  return (
    <SpotlightCard className="p-4 sm:p-5" aria-label="Win probability analysis">
      <FieldLabel rule tone="ice">
        Win probability · frozen signal weights
      </FieldLabel>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          <span className="num text-[38px] font-medium leading-none tracking-[-0.03em] text-ink">
            {formatPercent(probability.score)}
          </span>
          <span className="num mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
            p(win) · {scoreWord(probability.score)}
          </span>
        </div>
        <span className="num mb-1 font-mono text-[10px] text-dim">
          {probability.signals.filter((signal) => signal.present).length}/{probability.signals.length} signals present
        </span>
      </div>
      <div className="mt-3">
        <ProgressBar
          value={probability.score}
          tone={tone}
          label={"Win probability " + formatPercent(probability.score)}
          className="h-2"
        />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Metric label="Base" value={probability.base.toFixed(2)} />
        <Metric label="Signal sum" value={formatDelta(probability.signal_sum)} />
        <Metric label="Multiplier" value={"× " + probability.reason_multiplier.toFixed(2)} />
      </div>

      <p className="num mt-2 rounded-md border border-hairline bg-white/[0.012] px-2.5 py-2 font-mono text-[9.5px] leading-relaxed text-muted">
        clamp(({probability.base.toFixed(2)} + {formatDelta(probability.signal_sum)}) ×{" "}
        {probability.reason_multiplier.toFixed(2)}, 0.02, 0.95) ={" "}
        {probability.score.toFixed(4)}
      </p>

      <ol className="mt-3 border-t border-hairline" aria-label="Signal checklist">
        {probability.signals.map((signal, index) => (
          <li
            key={signal.key}
            className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-white/[0.045] py-2 last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)_6rem_4.5rem_auto]"
          >
            <span className="num font-mono text-[10px] text-dim">
              {"0" + String(index + 1)}
            </span>
            <span className="min-w-0 text-[12px] leading-snug text-ink">
              {signal.label}
              <span className="num mt-0.5 block font-mono text-[9.5px] text-dim sm:hidden">
                {formatDelta(signal.delta)} · {signal.present ? "present" : "missing"}
              </span>
            </span>
            <span className="hidden sm:block">
              <ProgressBar
                value={Math.abs(signal.delta) / 0.2}
                tone={signal.present ? "emerald" : "neutral"}
                label={signal.label + " contribution"}
                className="h-1"
              />
            </span>
            <span
              className={cn(
                "num hidden text-right text-[11px] sm:block",
                signal.present ? "text-ink" : "text-dim",
              )}
            >
              {formatDelta(signal.delta)}
            </span>
            <span
              className={cn(
                "inline-flex items-center gap-1 justify-self-end rounded border px-1.5 py-[3px] text-[9px] font-semibold tracking-[0.08em]",
                signal.present
                  ? "border-emerald/25 bg-emerald/10 text-emerald"
                  : "border-white/10 bg-white/[0.03] text-dim",
              )}
            >
              {signal.present ? (
                <Check size={10} aria-hidden />
              ) : (
                <Minus size={10} aria-hidden />
              )}
              {signal.present ? "PRESENT" : "MISSING"}
            </span>
          </li>
        ))}
      </ol>
    </SpotlightCard>
  );
}
