"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Reveal } from "./Reveal";

export function CtaBand() {
  return (
    <section aria-labelledby="cta-title" className="border-t border-rule">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16 lg:py-24">
        <Reveal>
          <div className="panel-raised relative overflow-hidden px-6 py-12 text-center md:py-16">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "radial-gradient(520px 220px at 50% 0%, rgba(110,86,248,0.14), transparent 70%)",
              }}
            />
            <p className="relative font-mono text-xs text-accent-soft">Sandbox · PayPal test mode · no real money</p>
            <h2 id="cta-title" className="relative mx-auto mt-3 max-w-[20ch] text-2xl font-semibold tracking-tight text-ink">
              Price your next dispute before you answer it.
            </h2>
            <p className="relative mx-auto mt-3 max-w-[54ch] text-sm leading-relaxed text-muted">
              Run the three-step simulation — checkout, usage, friendly-fraud inquiry — and watch it score and defend itself.
            </p>
            <div className="relative mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/demo"
                className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-white transition-all duration-150 hover:brightness-110 active:scale-[0.98]"
              >
                Run the live demo
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
              <Link
                href="/disputes"
                className="inline-flex h-11 items-center rounded-full border border-control bg-raised px-5 text-base font-medium text-ink transition-colors duration-150 hover:bg-control"
              >
                See the dashboard
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
