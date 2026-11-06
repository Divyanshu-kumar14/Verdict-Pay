import { Check, Minus } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { formatDelta, formatPercent } from "@/lib/format";
import type { WinProbability } from "@/lib/types";
import { TONE_TEXT, type Tone } from "@/lib/vocab";

function scoreTone(score: number): Tone {
  if (score >= 0.55) return "positive";
  if (score >= 0.35) return "warning";
  return "negative";
}

function scoreWord(score: number): string {
  if (score >= 0.55) return "strong";
  if (score >= 0.35) return "contested";
  return "weak";
}

/**
 * The win probability is a checklist, not a dial: every frozen signal with its
 * contribution, then the clamped total. Only the final p(win) reading is
 * coloured; the inputs stay in ink and muted.
 */
export function WinProbabilityPanel({ probability }: { probability: WinProbability }) {
  const tone = scoreTone(probability.score);
  const present = probability.signals.filter((signal) => signal.present).length;

  return (
    <Panel aria-label="Win probability analysis">
      <PanelHeader
        title="Win probability"
        description="Signal weights frozen by the deterministic triage policy. Each present signal adds or subtracts its fixed contribution."
        actions={
          <Badge tone="neutral">
            {present} of {probability.signals.length} signals present
          </Badge>
        }
      />
      <PanelBody className="pt-0">
        <div className="hidden items-baseline gap-x-4 border-b border-rule pb-1.5 text-xs text-muted sm:flex">
          <span className="w-5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Input</span>
          <span className="w-16 shrink-0 text-right">Contribution</span>
          <span className="w-20 shrink-0">State</span>
        </div>

        <ol aria-label="Signal checklist">
          {probability.signals.map((signal, index) => (
            <li
              key={signal.key}
              className="row-rule flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2.5 first:border-t-0 first:pt-2.5"
            >
              <span className="num w-5 shrink-0 text-xs text-muted" aria-hidden>
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-sm leading-snug text-ink">{signal.label}</span>
              <span
                className={cn(
                  "num w-16 shrink-0 text-right text-sm",
                  signal.present ? "text-ink" : "text-muted",
                )}
              >
                {formatDelta(signal.delta)}
              </span>
              <span className="flex w-20 shrink-0 items-center gap-1.5 text-sm text-muted">
                {signal.present ? (
                  <Check size={12} aria-hidden />
                ) : (
                  <Minus size={12} aria-hidden />
                )}
                {signal.present ? "present" : "missing"}
              </span>
            </li>
          ))}
        </ol>

        <div className="row-rule mt-3 grid gap-x-8 gap-y-3 pt-3 sm:grid-cols-3">
          <div>
            <p className="label">Base</p>
            <p className="num mt-1 text-base text-ink">{probability.base.toFixed(2)}</p>
          </div>
          <div>
            <p className="label">Signal sum</p>
            <p className="num mt-1 text-base text-ink">{formatDelta(probability.signal_sum)}</p>
          </div>
          <div>
            <p className="label">Reason multiplier</p>
            <p className="num mt-1 text-base text-ink">
              {"x " + probability.reason_multiplier.toFixed(2)}
            </p>
          </div>
        </div>
      </PanelBody>

      <PanelFooter>
        <p className="label">Clamped total</p>
        <p className="num mt-1 text-sm text-muted">
          clamp(({probability.base.toFixed(2)}{" "}
          {probability.signal_sum < 0 ? "-" : "+"}{" "}
          {Math.abs(probability.signal_sum).toFixed(2)}) ×{" "}
          {probability.reason_multiplier.toFixed(2)}, 0.02, 0.95)
        </p>
        <p className="mt-1.5">
          <span className={cn("num text-lg", TONE_TEXT[tone])}>
            {formatPercent(probability.score)}
          </span>{" "}
          <span className="text-sm text-muted">p(win), {scoreWord(probability.score)}</span>
        </p>
      </PanelFooter>
    </Panel>
  );
}
