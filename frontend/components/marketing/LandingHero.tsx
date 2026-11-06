"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check, LayoutDashboard } from "lucide-react";

import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Badge } from "@/components/ui/Badge";
import { EASE_OUT } from "@/lib/motion";

const TELEMETRY_ROWS = [
  { id: "evt_tos_8f3a", label: "Terms accepted · signed checkout" },
  { id: "evt_auth_41c9", label: "Session authenticated · device match" },
  { id: "evt_dlv_07be", label: "Asset delivered · first use metered" },
];

function HeroBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(640px 340px at 18% 8%, rgba(110,86,248,0.13), transparent 70%), radial-gradient(560px 300px at 82% 22%, rgba(167,139,250,0.07), transparent 70%)",
        }}
      />
      <svg
        className="absolute inset-0 h-full w-full opacity-[0.05]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <pattern id="vp-hero-grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path
              d="M 44 0 L 0 0 0 44"
              fill="none"
              stroke="white"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#vp-hero-grid)" />
      </svg>
      <div
        className="absolute inset-x-0 bottom-0 h-24"
        style={{
          background: "linear-gradient(to bottom, transparent, var(--color-ground))",
        }}
      />
    </div>
  );
}

function SampleCasePanel() {
  const reduced = useReducedMotion();
  return (
    <motion.div
      initial={reduced ? undefined : { opacity: 0, y: 10 }}
      animate={reduced ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE_OUT }}
      className="panel-raised relative overflow-hidden"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <Badge tone="neutral">Sample case</Badge>
        <Badge tone="accent" dot>
          Sandbox · PayPal test mode
        </Badge>
        <span className="ml-auto font-mono text-xs text-muted">PP-D-48213</span>
      </div>

      <div className="space-y-4 px-4 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="label">Item not received · Inquiry</p>
            <p className="mt-0.5 font-mono text-sm text-ink">$184.20 <span className="text-muted">claimed</span></p>
          </div>
          <Badge tone="warning">Awaiting reply</Badge>
        </div>

        <ul className="space-y-1.5" aria-label="Telemetry coverage">
          {TELEMETRY_ROWS.map((row, i) => (
            <motion.li
              key={row.id}
              initial={reduced ? undefined : { opacity: 0, x: -6 }}
              animate={reduced ? undefined : { opacity: 1, x: 0 }}
              transition={reduced ? undefined : { duration: 0.2, ease: EASE_OUT, delay: 0.25 + i * 0.12 }}
              className="flex items-center gap-2.5 text-sm"
            >
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-pill-positive">
                <Check className="h-3 w-3 text-positive" strokeWidth={3} aria-hidden />
              </span>
              <span className="text-ink">{row.label}</span>
            </motion.li>
          ))}
        </ul>

        <div className="row-rule flex items-end justify-between gap-3 pt-3.5">
          <div>
            <p className="label">Expected value of defending</p>
            <p className="value num mt-1 font-mono text-lg text-positive">
              <AnimatedNumber value={131.44} format={(n) => "$" + n.toFixed(2)} />
            </p>
            <p className="mt-0.5 font-mono text-xs text-muted">p(win) 78.4% · auditable inputs</p>
          </div>
          <motion.div
            initial={reduced ? undefined : { opacity: 0, scale: 0.96 }}
            animate={reduced ? undefined : { opacity: 1, scale: 1 }}
            transition={reduced ? undefined : { duration: 0.22, ease: EASE_OUT, delay: 0.65 }}
          >
            <Badge tone="positive" size="md" dot>
              Provide evidence
            </Badge>
          </motion.div>
        </div>

        <div className="flex items-center gap-2 font-mono text-2xs text-muted" aria-label="Verdict trail">
          <span>telemetry</span>
          <span aria-hidden className="text-accent-soft">→</span>
          <span>scored</span>
          <span aria-hidden className="text-accent-soft">→</span>
          <span className="text-ink">signed dossier</span>
          <span className="live-dot ml-auto h-1.5 w-1.5 rounded-full bg-positive" aria-hidden />
        </div>
      </div>
    </motion.div>
  );
}

export function LandingHero() {
  return (
    <section className="relative overflow-hidden" aria-labelledby="hero-title">
      <HeroBackdrop />
      <div className="relative mx-auto grid w-full max-w-[1120px] items-center gap-10 px-6 pb-16 pt-14 md:pt-20 lg:grid-cols-[1.02fr_0.98fr] lg:gap-12 lg:pb-24">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 font-mono text-2xs text-muted">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            Pre-dispute telemetry · PayPal seller protection
          </p>
          <h1 id="hero-title" className="mt-5 max-w-[14ch] text-3xl font-semibold tracking-tight text-ink">
            Win the disputes you&apos;d normally eat.
          </h1>
          <p className="mt-4 max-w-[52ch] text-base leading-relaxed text-muted">
            VerdictPay captures pre-dispute telemetry, scores every PayPal dispute by
            deterministic expected value, and defends it with SHA-256-signed evidence.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Link
              href="/demo"
              className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
            >
              Run the live demo
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/disputes"
              className="inline-flex h-11 items-center gap-2 rounded-full border border-control bg-raised px-5 text-base font-medium text-ink transition-colors duration-150 hover:bg-control"
            >
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              See the dashboard
            </Link>
          </div>
          <p className="mt-4 font-mono text-xs text-muted">
            Deterministic EV · no black-box scores · exportable proof
          </p>
        </div>

        <div className="relative">
          <SampleCasePanel />
          <p className="mt-2.5 text-right font-mono text-2xs text-muted">
            Static sample · figures shown for illustration
          </p>
        </div>
      </div>
    </section>
  );
}
