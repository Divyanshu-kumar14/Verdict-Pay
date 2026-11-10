"use client";

import { Reveal } from "./Reveal";

function TraceDiagram() {
  return (
    <svg viewBox="0 0 220 72" className="h-[72px] w-full" role="img" aria-label="Telemetry signal trace">
      <path d="M8 52 H52 L70 52 L84 28 L98 60 L112 40 L126 44 H212" fill="none" stroke="var(--color-accent)" strokeWidth="1.5" />
      <circle cx="8" cy="52" r="3" fill="var(--color-ground)" stroke="var(--color-accent-soft)" strokeWidth="1.5" />
      <circle cx="126" cy="44" r="3" fill="var(--color-accent)" />
      <circle cx="212" cy="44" r="3" fill="var(--color-ground)" stroke="var(--color-positive)" strokeWidth="1.5" />
      <text x="8" y="68" fill="var(--color-muted)" fontSize="11" fontFamily="monospace">evt_tos_8f3a</text>
      <text x="132" y="68" fill="var(--color-muted)" fontSize="11" fontFamily="monospace">evt_dlv_07be</text>
    </svg>
  );
}

function ForkDiagram() {
  return (
    <svg viewBox="0 0 220 84" className="h-[84px] w-full" role="img" aria-label="Expected value decision fork">
      <circle cx="20" cy="42" r="4" fill="var(--color-accent)" />
      <path d="M24 42 H76 L120 20 H196" fill="none" stroke="var(--color-positive)" strokeWidth="1.5" />
      <path d="M24 42 H76 L120 64 H196" fill="none" stroke="var(--color-negative)" strokeWidth="1.5" strokeDasharray="4 3" />
      <rect x="144" y="8" width="72" height="18" rx="9" fill="rgba(52,211,153,0.12)" />
      <text x="151" y="21" fill="var(--color-positive)" fontSize="11" fontFamily="monospace">+$131.44</text>
      <rect x="144" y="58" width="72" height="18" rx="9" fill="rgba(248,113,113,0.10)" />
      <text x="151" y="71" fill="var(--color-negative)" fontSize="11" fontFamily="monospace">−$184.20</text>
      <text x="8" y="80" fill="var(--color-muted)" fontSize="11" fontFamily="monospace">ev_calc_01</text>
    </svg>
  );
}

function SealDiagram() {
  return (
    <svg viewBox="0 0 220 84" className="h-[84px] w-full" role="img" aria-label="Sealed evidence dossier">
      <rect x="70" y="8" width="80" height="58" rx="8" fill="none" stroke="var(--color-line)" strokeWidth="1.5" />
      <path d="M110 2 L128 16 H92 Z" fill="none" stroke="var(--color-accent-soft)" strokeWidth="1.5" />
      <circle cx="110" cy="16" r="2.5" fill="var(--color-accent)" />
      <line x1="84" y1="34" x2="136" y2="34" stroke="var(--color-muted)" strokeWidth="1.5" />
      <line x1="84" y1="43" x2="136" y2="43" stroke="var(--color-muted)" strokeWidth="1.5" opacity="0.6" />
      <line x1="84" y1="52" x2="118" y2="52" stroke="var(--color-positive)" strokeWidth="1.5" />
      <text x="48" y="80" fill="var(--color-muted)" fontSize="11" fontFamily="monospace">pkg_sha256 · sealed</text>
    </svg>
  );
}

const STEPS = [
  {
    n: "Step 1",
    title: "Capture telemetry",
    body: "Checkout and usage events are recorded with timestamps as they happen — terms, authentication, delivery, metered use.",
    diagram: <TraceDiagram />,
  },
  {
    n: "Step 2",
    title: "Score dispute EV deterministically",
    body: "Win probability, amount at risk, and fees collapse into one expected value. Defend when it clears the bar; concede when it does not.",
    diagram: <ForkDiagram />,
  },
  {
    n: "Step 3",
    title: "Submit signed evidence",
    body: "The winning cases ship as a hash-sealed dossier mapped to PayPal seller-protection requirements. Export it, audit it, send it.",
    diagram: <SealDiagram />,
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t border-rule">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16 lg:py-24">
        <Reveal>
          <p className="font-mono text-xs text-accent-soft">02 — How it works</p>
          <h2 id="how-title" className="mt-2 max-w-[20ch] text-2xl font-semibold tracking-tight text-ink">
            Three steps, each one auditable.
          </h2>
        </Reveal>
        <ol className="mt-10 grid gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="bg-surface p-5">
              <Reveal delay={Math.min(i * 0.04, 0.08)}>
                <p className="font-mono text-2xs text-accent-soft">{step.n}</p>
                <div className="mt-3 rounded-lg border border-rule bg-ground px-3 py-2">{step.diagram}</div>
                <h3 className="title-card mt-4">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
