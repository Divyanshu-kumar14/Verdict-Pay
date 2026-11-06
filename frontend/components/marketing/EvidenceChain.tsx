"use client";

import { useReducedMotion } from "motion/react";

import { Badge } from "@/components/ui/Badge";
import { Reveal } from "./Reveal";

const BLOCKS = [
  {
    name: "capture",
    hash: "9f2ac41d08…e77b04",
    time: "2026-10-31T14:02:11Z",
    note: "Checkout events, timestamped at source",
  },
  {
    name: "telemetry bundle",
    hash: "c47d90be33…1a9f62",
    time: "2026-10-31T14:02:12Z",
    note: "prev linked · session + delivery proofs",
  },
  {
    name: "EV worksheet",
    hash: "71b0e5f4aa…d3c817",
    time: "2026-11-02T09:14:55Z",
    note: "p(win) 78.4% · inputs frozen",
  },
  {
    name: "signed dossier",
    hash: "d9f3a1027c…b84e19",
    time: "2026-11-02T09:15:02Z",
    note: "Sealed for PayPal seller protection",
  },
];

export function EvidenceChain() {
  const reduced = useReducedMotion();
  return (
    <section aria-labelledby="evidence-title" className="border-t border-rule">
      <div className="mx-auto w-full max-w-[1120px] px-6 py-16 lg:py-24">
        <Reveal>
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-mono text-xs text-accent-soft">03 — Evidence</p>
            <Badge tone="accent">SHA-256 chain head</Badge>
          </div>
          <h2 id="evidence-title" className="mt-2 max-w-[22ch] text-2xl font-semibold tracking-tight text-ink">
            Cryptographic provenance, not a PDF you hope they believe.
          </h2>
          <p className="title-section mt-3 max-w-[62ch]">
            Each block seals the last. Tamper with one byte and the head changes — that is the whole point.
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <div className="panel mt-10 overflow-x-auto p-0">
            <ol className="flex min-w-[720px] items-stretch">
              {BLOCKS.map((block, i) => (
                <li key={block.hash} className="relative flex-1 px-4 py-5">
                  <div aria-hidden className="absolute left-0 top-7 h-px w-full bg-line" />
                  <div aria-hidden className="absolute left-4 top-[22px] h-[9px] w-[9px] rounded-full border-2 border-accent bg-ground" />
                  <p className="mt-5 font-mono text-xs font-semibold text-ink">{block.name}</p>
                  <p className="num mt-1.5 break-all font-mono text-2xs text-accent-soft">sha256:{block.hash}</p>
                  <p className="num mt-1 font-mono text-2xs text-muted">{block.time}</p>
                  <p className="mt-1.5 text-xs leading-snug text-muted">{block.note}</p>
                  {i === BLOCKS.length - 1 ? (
                    <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-pill-positive px-2.5 py-1 font-mono text-2xs text-pill-positive-ink">
                      <span aria-hidden className={reduced ? "h-1.5 w-1.5 rounded-full bg-positive" : "live-dot h-1.5 w-1.5 rounded-full bg-positive"} />
                      head · verified
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
            <p className="row-rule px-4 py-2.5 font-mono text-2xs text-muted">
              verify: each block embeds the previous hash · head d9f3a1027c…b84e19
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
