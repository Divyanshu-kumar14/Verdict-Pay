"use client";

import { Check, Minus } from "lucide-react";

import { DonutGauge } from "@/components/charts";
import { Badge } from "@/components/ui/Badge";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { cn } from "@/lib/cn";
import { formatDelta, formatPercent } from "@/lib/format";
import type { WinProbability } from "@/lib/types";
import { TONE_TEXT, type Tone } from "@/lib/vocab";

function scoreTone(score: number): Tone {
  if (score >= 0.7) return "positive";
  if (score >= 0.45) return "accent";
  if (score >= 0.3) return "warning";
  return "negative";
}

function scoreWord(score: number): string {
  if (score >= 0.7) return "Strong";
  if (score >= 0.45) return "Tilted";
  if (score >= 0.3) return "Slim";
  return "Weak";
}

export function WinProbabilityPanel({ probability }: { probability: WinProbability }) {
  const tone = scoreTone(probability.score);
  const present = probability.signals.filter((signal) => signal.present).length;
  const gaugeSummary =
    "Win probability " +
    formatPercent(probability.score) +
    " from " +
    present +
    " of " +
    probability.signals.length +
    " frozen signals";

  return (
    <Panel aria-label="Win probability analysis">
      <PanelHeader
        title="Win probability"
        description="A frozen, policy-driven estimate: base score plus reason weighting over telemetry signals."
        actions={
          <Badge tone={tone} dot>
            {scoreWord(probability.score)}
          </Badge>
        }
      />

      <PanelBody className="pt-0">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
          <DonutGauge
            value={probability.score}
            formatValue={formatPercent}
            tone={tone}
            summary={gaugeSummary}
            size={168}
            caption={scoreWord(probability.score) + " position"}
            className="self-center"
          />

          <div className="min-w-0 flex-1">
            <p className="label">Clamped p(win)</p>
            <p className={cn("value mt-1 text-lg", TONE_TEXT[tone])}>
              <AnimatedNumber value={probability.score} format={(value) => formatPercent(value)} />
            </p>

            <div className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
              <div>
                <p className="label">Base</p>
                <p className="num mt-1 text-base text-ink">{probability.base.toFixed(2)}</p>
              </div>
              <div>
                <p className="label">Signal sum</p>
                <p className="num mt-1 text-base text-ink">{formatDelta(probability.signal_sum)}</p>
              </div>
              <div>
                <p className="label">Reason ×</p>
                <p className="num mt-1 text-base text-ink">
                  ×{probability.reason_multiplier.toFixed(2)}
                </p>
              </div>
            </div>

            <p className="row-rule mt-4 pt-3 text-sm leading-relaxed text-muted">
              Base {probability.base.toFixed(2)}, plus signals {formatDelta(probability.signal_sum)}{" "}
              scaled by the reason multiplier ×{probability.reason_multiplier.toFixed(2)}, clamped to
              [0, 1].
            </p>
          </div>
        </div>

        <div className="row-rule mt-4 pt-3">
          <p className="label">
            Signal breakdown{" "}
            <span className="num">
              {present}/{probability.signals.length}
            </span>
          </p>

          <ul aria-label="Win probability signals" className="mt-1.5 space-y-1.5">
            {probability.signals.map((signal) => (
              <li key={signal.key} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={cn(
                    "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                    signal.present ? "bg-pill-positive" : "bg-raised",
                  )}
                >
                  {signal.present ? (
                    <Check size={11} className="text-pill-positive-ink" strokeWidth={2.5} />
                  ) : (
                    <Minus size={11} className="text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-muted">
                  {signal.label}
                  <span className="text-ink"> · {formatDelta(signal.delta)}</span>
                </span>
                <span
                  className={cn(
                    "shrink-0 text-2xs",
                    signal.present ? "text-pill-positive-ink" : "text-muted",
                  )}
                >
                  {signal.present ? "present" : "missing"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </PanelBody>

      <PanelFooter className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm text-muted">
          Score is frozen by policy — recompute only re-reads saved telemetry.
        </span>
        <span className={cn("num text-sm", TONE_TEXT[tone])}>{formatPercent(probability.score)}</span>
      </PanelFooter>
    </Panel>
  );
}
