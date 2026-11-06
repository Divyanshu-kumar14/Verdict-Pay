"use client";

import { Activity, MessagesSquare, Scale, ShieldCheck } from "lucide-react";

import { Reveal } from "./Reveal";

const ROWS = [
  {
    icon: "activity",
    title: "Pre-dispute telemetry",
    body: "Terms acceptance, authenticated sessions, delivery and usage are captured at checkout and metered afterward, so an inquiry arrives with its context already attached.",
    meta: "evt_tos · evt_auth · evt_dlv · evt_use",
  },
  {
    icon: "scale",
    title: "Deterministic dispute EV",
    body: "Every inquiry is priced from win probability, amount at risk, and PayPal fees — the same inputs, the same verdict, every time. You can audit the arithmetic.",
    meta: "p(win) × amount − fees",
  },
  {
    icon: "shield",
    title: "Signed evidence defense",
    body: "The dossier PayPal sees is assembled from that telemetry and sealed with a SHA-256 hash chain, so seller-protection eligibility is provable, not asserted.",
    meta: "sha256 chain · exportable dossier",
  },
  {
    icon: "chat",
    title: "Friendly-fraud handling",
    body: "Recognize the patterns that look like fraud but are not — first-use confusion, family-member purchases, forgotten renewals — and deflect them before they escalate.",
    meta: "deflect · offer · evidence · accept",
  },
];

function RowIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4 text-accent-soft";
  if (kind === "scale") return <Scale className={cls} aria-hidden />;
  if (kind === "shield") return <ShieldCheck className={cls} aria-hidden />;
  if (kind === "chat") return <MessagesSquare className={cls} aria-hidden />;
  return <Activity className={cls} aria-hidden />;
}

export function ProductSection() {
  return (
    <section id="product" aria-labelledby="product-title" className="scroll-mt-20">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16 lg:py-24">
        <Reveal>
          <p className="font-mono text-xs text-accent-soft">01 — Product</p>
          <h2 id="product-title" className="mt-2 max-w-[20ch] text-2xl font-semibold tracking-tight text-ink">
            The whole dispute, priced before you answer it.
          </h2>
          <p className="title-section mt-3 max-w-[62ch]">
            Four capabilities, one ledger: what happened, what it is worth, and what proves it.
          </p>
        </Reveal>
        <dl className="mt-10">
          {ROWS.map((row, i) => (
            <Reveal key={row.title} delay={Math.min(i * 0.03, 0.09)}>
              <div className="row-rule grid gap-3 py-6 md:grid-cols-[28px_1fr_1.2fr] md:gap-6">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface">
                  <RowIcon kind={row.icon} />
                </div>
                <div>
                  <dt className="title-card">{row.title}</dt>
                  <dd className="mt-1 font-mono text-2xs text-muted">{row.meta}</dd>
                </div>
                <dd className="max-w-[62ch] text-sm leading-relaxed text-muted">{row.body}</dd>
              </div>
            </Reveal>
          ))}
        </dl>
      </div>
    </section>
  );
}
