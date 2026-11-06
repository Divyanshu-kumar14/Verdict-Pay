"use client";

import { Check } from "lucide-react";

import { Reveal } from "./Reveal";

const LEFT = [
  "Same inputs, same verdict — every time",
  "Win probability, amount, and fees shown",
  "Mapped to PayPal seller-protection rules",
  "Dossier exports with its hash chain",
];

const RIGHT = [
  "Opaque risk score, no explanation",
  "Thresholds you cannot inspect",
  "No link to what PayPal actually asks for",
  "A verdict you cannot defend or export",
];

export function Comparison() {
  return (
    <section aria-labelledby="compare-title" className="border-t border-rule">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16 lg:py-24">
        <Reveal>
          <p className="font-mono text-xs text-accent-soft">04 — Why deterministic</p>
          <h2 id="compare-title" className="mt-2 max-w-[22ch] text-2xl font-semibold tracking-tight text-ink">
            Deterministic beats black-box.
          </h2>
        </Reveal>
        <div className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-2">
          <div className="bg-surface p-6">
            <Reveal>
              <p className="font-mono text-xs text-positive">VerdictPay · deterministic EV</p>
              <ul className="mt-4 space-y-3">
                {LEFT.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-ink">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-positive" strokeWidth={2.5} aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
          <div className="bg-raised p-6">
            <Reveal delay={0.05}>
              <p className="font-mono text-xs text-muted">Opaque fraud-model scores</p>
              <ul className="mt-4 space-y-3">
                {RIGHT.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-muted">
                    <span aria-hidden className="mt-[7px] h-1 w-4 shrink-0 rounded-full bg-muted opacity-50" />
                    {item}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>
        </div>
        <Reveal delay={0.05}>
          <p className="mt-5 max-w-[68ch] text-sm leading-relaxed text-muted">
            Honest scope: no model wins every dispute. VerdictPay tells you which ones are worth
            fighting — and proves the ones you fight.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
