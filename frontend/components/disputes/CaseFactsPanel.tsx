import { ShieldCheck, ShieldX } from "lucide-react";

import { FieldLabel } from "@/components/premium/FieldLabel";
import { SpotlightCard } from "@/components/premium/SpotlightCard";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatInteger, formatPercent, shortHash } from "@/lib/format";
import type { CaseFacts } from "@/lib/types";

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline/60 py-1.5 last:border-b-0">
      <dt className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.12em] text-dim">{label}</dt>
      <dd className="num min-w-0 break-words text-right text-[11px] text-ink">{value}</dd>
    </div>
  );
}

function ChipList({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) {
    return <p className="text-[10.5px] text-dim">{emptyLabel}</p>;
  }
  const visible = values.slice(0, 6);
  return (
    <div className="flex flex-wrap gap-1.5">
      {visible.map((value) => (
        <span
          key={value}
          className="num max-w-[14rem] truncate rounded border border-hairline bg-white/[0.02] px-1.5 py-0.5 font-mono text-[9.5px] text-muted"
          title={value}
        >
          {value}
        </span>
      ))}
      {values.length > visible.length ? (
        <span className="font-mono text-[9.5px] text-dim">+{values.length - visible.length} more</span>
      ) : null}
    </div>
  );
}

function renderValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > 96 ? value.slice(0, 96) + "..." : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" || typeof item === "number" ? String(item) : "..."))
      .slice(0, 6)
      .join(", ");
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value).slice(0, 96);
    } catch {
      return "...";
    }
  }
  return String(value);
}

function RecordList({ records, emptyLabel }: { records: Record<string, unknown>[]; emptyLabel: string }) {
  if (records.length === 0) {
    return <p className="text-[10.5px] text-dim">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-1.5">
      {records.map((record, index) => {
        const entries = Object.entries(record)
          .map(([key, value]) => [key, renderValue(value)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== null);
        return (
          <li key={"match-" + String(index)} className="rounded-md border border-hairline bg-white/[0.012] px-2.5 py-2">
            <div className="num font-mono text-[9px] uppercase tracking-[0.12em] text-dim">match {String(index + 1).padStart(2, "0")}</div>
            {entries.length === 0 ? (
              <p className="mt-1 text-[10.5px] text-dim">No scalar fields returned.</p>
            ) : (
              <dl className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
                {entries.map(([key, value]) => (
                  <div key={key} className="flex min-w-0 gap-1.5 font-mono text-[9.5px]">
                    <dt className="shrink-0 text-dim">{key}</dt>
                    <dd className="truncate text-muted" title={value}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The frozen fact pack: everything the dossier can cite, and nothing else. */
export function CaseFactsPanel({ facts }: { facts: CaseFacts }) {
  return (
    <SpotlightCard className="p-4 sm:p-5" aria-label="Frozen fact pack">
      <FieldLabel rule tone="ice">
        Evidence facts · frozen fact pack
      </FieldLabel>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
        Snapshot used to compose the dossier. No language model can add a fact to this list.
      </p>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Chain head</FieldLabel>
          <span className="num font-mono text-[9px] text-dim">
            {shortHash(facts.chain_head, 10, 8)}
          </span>
        </div>
        <p className="num mt-1 break-all rounded-md border border-hairline bg-sunken px-2.5 py-2 font-mono text-[9.5px] leading-relaxed text-muted">
          {facts.chain_head}
        </p>
      </div>

      <dl className="mt-3 grid gap-x-6 sm:grid-cols-2">
        <div>
          <FactRow label="Events" value={formatInteger(facts.event_count)} />
          <FactRow label="Completeness" value={formatPercent(facts.completeness, 0)} />
          <FactRow label="Usage units" value={formatInteger(facts.usage_units)} />
          <FactRow label="Usage events" value={formatInteger(facts.usage_events)} />
          <FactRow label="First seen" value={formatAbsolute(facts.first_seen)} />
        </div>
        <div>
          <FactRow label="ToS version" value={facts.tos_version ?? "not captured"} />
          <FactRow label="ToS accepted" value={formatAbsolute(facts.tos_accepted_at)} />
          <FactRow label="Last seen" value={formatAbsolute(facts.last_seen)} />
          <FactRow
            label="CE 3.0 window"
            value={facts.ce3_window_days > 0 ? facts.ce3_window_days + " days" : "outside window"}
          />
          <FactRow label="CE 3.0 matches" value={formatInteger(facts.ce3_matches.length)} />
        </div>
      </dl>

      <div className="mt-4 space-y-3">
        <div>
          <FieldLabel>ToS content hash</FieldLabel>
          <p className="num mt-1 break-all font-mono text-[9.5px] text-muted">
            {facts.tos_hash ?? "--"}
          </p>
        </div>
        <div>
          <FieldLabel>Client IPs</FieldLabel>
          <div className="mt-1.5">
            <ChipList values={facts.ips} emptyLabel="No IP evidence recorded." />
          </div>
        </div>
        <div>
          <FieldLabel>Devices</FieldLabel>
          <div className="mt-1.5">
            <ChipList values={facts.devices} emptyLabel="No device evidence recorded." />
          </div>
        </div>
      </div>

      <div className="mt-4">
        <FieldLabel>Deliveries</FieldLabel>
        <div className="mt-1.5">
          <RecordList records={facts.deliveries} emptyLabel="No assets delivered on this order." />
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-2">
          <FieldLabel>Visa CE 3.0 matches</FieldLabel>
          <span className="font-mono text-[9px] text-dim">
            {facts.ce3_window_days > 0 ? "120-365d lookback" : "lookback unavailable"}
          </span>
        </div>
        <div className="mt-1.5">
          <RecordList
            records={facts.ce3_matches}
            emptyLabel="No prior undisputed transactions share this IP or device."
          />
        </div>
      </div>

      <div className={cn("mt-4 flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2",
        facts.chain_valid
          ? "border-emerald/20 bg-emerald/[0.04]"
          : "border-rose/25 bg-rose/[0.05]")}
      >
        {facts.chain_valid ? (
          <ShieldCheck size={13} aria-hidden className="shrink-0 text-emerald" />
        ) : (
          <ShieldX size={13} aria-hidden className="shrink-0 text-rose" />
        )}
        <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-dim">
          payer
        </span>
        <span className="num text-[10.5px] text-ink">{facts.payer_id}</span>
        <span className="ml-auto font-mono text-[9px] text-dim">
          {formatInteger(facts.event_count)} chained events ·{" "}
          {facts.chain_valid ? "chain valid" : "CHAIN BROKEN"}
        </span>
      </div>
    </SpotlightCard>
  );
}
