import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelHeader } from "@/components/ui/Panel";
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2">
      <div className="kicker">{label}</div>
      <div className="num mt-0.5 text-[12px] text-ink">{value}</div>
    </div>
  );
}

/** Six deterministic signals, their deltas and whether they are present. */
export function WinProbabilityPanel({ probability }: { probability: WinProbability }) {
  const tone = scoreTone(probability.score);

  return (
    <Panel>
      <PanelHeader
        kicker="Win probability"
        title={`p(win) ${formatPercent(probability.score)}`}
        description="Frozen signal weights applied to verified telemetry. A missing signal never adds points."
      />
      <PanelBody className="space-y-3.5">
        <div className="flex items-center gap-3">
          <span className="num text-[26px] font-medium leading-none tracking-[-0.03em] text-ink">
            {formatPercent(probability.score)}
          </span>
          <ProgressBar
            value={probability.score}
            tone={tone}
            label="Win probability"
            className="h-2"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Base" value={probability.base.toFixed(2)} />
          <Metric label="Signal sum" value={formatDelta(probability.signal_sum)} />
          <Metric label="Multiplier" value={`× ${probability.reason_multiplier.toFixed(2)}`} />
        </div>

        <p className="rounded border border-hairline bg-white/[0.012] px-2.5 py-2 font-mono text-[9.5px] leading-relaxed text-muted">
          clamp(({probability.base.toFixed(2)} + {formatDelta(probability.signal_sum)}) ×{" "}
          {probability.reason_multiplier.toFixed(2)}, 0.02, 0.95) ={" "}
          {probability.score.toFixed(4)}
        </p>

        <ul className="divide-y divide-white/[0.045]">
          {probability.signals.map((signal) => (
            <li key={signal.key} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-ink">
                {signal.label}
              </span>
              <span className="hidden w-20 shrink-0 sm:block">
                <ProgressBar
                  value={Math.abs(signal.delta) / 0.2}
                  tone={signal.present ? "emerald" : "neutral"}
                  label={`${signal.label} contribution`}
                  className="h-1"
                />
              </span>
              <span
                className={cn(
                  "num w-11 shrink-0 text-right text-[10.5px]",
                  signal.present ? "text-ink" : "text-dim",
                )}
              >
                {formatDelta(signal.delta)}
              </span>
              <Badge tone={signal.present ? "emerald" : "neutral"} dot>
                {signal.present ? "present" : "missing"}
              </Badge>
            </li>
          ))}
        </ul>
      </PanelBody>
    </Panel>
  );
}
