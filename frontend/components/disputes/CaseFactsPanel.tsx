import { SealMark } from "@/components/evidence/SealMark";
import { Badge } from "@/components/ui/Badge";
import { Panel, PanelBody, PanelFooter, PanelHeader } from "@/components/ui/Panel";
import { formatAbsolute, formatInteger, formatPercent, shortHash } from "@/lib/format";
import type { CaseFacts } from "@/lib/types";

/** One row of the definition list: a sentence-case label, a right-aligned figure. */
function FactRow({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="row-rule flex items-baseline justify-between gap-4 py-2 first:border-t-0 first:pt-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="num min-w-0 truncate text-right text-sm text-ink" title={title}>
        {value}
      </dd>
    </div>
  );
}

function ValueList({ values, emptyLabel }: { values: string[]; emptyLabel: string }) {
  if (values.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  const visible = values.slice(0, 6);
  return (
    <div className="space-y-1">
      {visible.map((value) => (
        <p key={value} className="num truncate text-sm text-ink" title={value}>
          {value}
        </p>
      ))}
      {values.length > visible.length ? (
        <p className="num text-sm text-muted">
          and {formatInteger(values.length - visible.length)} more
        </p>
      ) : null}
    </div>
  );
}

/* The fact pack is a backend dict, so its keys are snake_case. A reader should never see
   "matched_on" as a label; known keys get a proper label and anything new is humanised. */
const RECORD_KEY_LABELS: Record<string, string> = {
  resource_id: "Resource",
  sha256: "SHA-256",
  delivered_at: "Delivered",
  transaction_id: "Transaction",
  amount_usd: "Amount (USD)",
  status: "Status",
  days_ago: "Days ago",
  matched_on: "Matched on",
};

function recordKeyLabel(key: string): string {
  const known = RECORD_KEY_LABELS[key];
  if (known) return known;
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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

function RecordList({
  records,
  noun,
  emptyLabel,
}: {
  records: Record<string, unknown>[];
  noun: string;
  emptyLabel: string;
}) {
  if (records.length === 0) {
    return <p className="text-sm text-muted">{emptyLabel}</p>;
  }
  return (
    <ul className="space-y-3">
      {records.map((record, index) => {
        const entries = Object.entries(record)
          .map(([key, value]) => [recordKeyLabel(key), renderValue(value)] as const)
          .filter((entry): entry is readonly [string, string] => entry[1] !== null);
        return (
          <li key={"match-" + String(index)} className="row-rule pt-3 first:border-t-0 first:pt-0">
            <p className="label">
              {noun} {index + 1}
            </p>
            {entries.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No fields were returned.</p>
            ) : (
              <dl className="mt-1.5 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                {entries.map(([key, value]) => (
                  <div key={key} className="flex min-w-0 gap-2">
                    <dt className="shrink-0 text-sm text-muted">{key}</dt>
                    <dd className="num min-w-0 truncate text-sm text-ink" title={value}>
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
    <Panel aria-label="Frozen fact pack">
      <PanelHeader
        title="Frozen fact pack"
        description="The snapshot the dossier is built from. No language model can add a fact to this list."
        actions={
          facts.chain_valid ? (
            <span className="inline-flex items-center gap-1.5">
              <SealMark size={16} tone="positive" />
              <span className="text-sm font-medium text-positive">Chain valid</span>
            </span>
          ) : (
            <Badge tone="negative" dot>
              Chain broken
            </Badge>
          )
        }
      />
      <PanelBody className="pt-0">
        <dl className="grid gap-x-10 sm:grid-cols-2">
          <div>
            <FactRow
              label="Chain head"
              value={shortHash(facts.chain_head, 12, 8)}
              title={facts.chain_head}
            />
            <FactRow label="Events" value={formatInteger(facts.event_count)} />
            <FactRow label="Completeness" value={formatPercent(facts.completeness, 0)} />
            <FactRow label="Usage units" value={formatInteger(facts.usage_units)} />
            <FactRow label="Usage events" value={formatInteger(facts.usage_events)} />
            <FactRow label="Logins" value={formatInteger(facts.login_count)} />
            <FactRow label="First seen" value={formatAbsolute(facts.first_seen)} />
          </div>
          <div>
            <FactRow label="Payer" value={facts.payer_id} title={facts.payer_id} />
            <FactRow label="ToS version" value={facts.tos_version ?? "Not captured"} />
            <FactRow label="ToS accepted" value={formatAbsolute(facts.tos_accepted_at)} />
            <FactRow label="Last seen" value={formatAbsolute(facts.last_seen)} />
            <FactRow
              label="Response due"
              value={formatAbsolute(facts.response_due_date)}
              title={facts.response_due_date ?? undefined}
            />
            <FactRow
              label="CE 3.0 window"
              value={facts.ce3_window_days > 0 ? facts.ce3_window_days + " days" : "Outside window"}
            />
            <FactRow label="CE 3.0 matches" value={formatInteger(facts.ce3_matches.length)} />
          </div>
        </dl>

        <div className="row-rule mt-4 pt-3">
          <p className="label">ToS content hash</p>
          <p
            className="num mt-1 truncate text-sm text-ink"
            title={facts.tos_hash ?? undefined}
          >
            {facts.tos_hash ?? "Not captured"}
          </p>
        </div>

        <div className="row-rule mt-4 grid gap-x-10 gap-y-4 pt-3 sm:grid-cols-2">
          <div>
            <p className="label">Client IPs</p>
            <div className="mt-1.5">
              <ValueList values={facts.ips} emptyLabel="No IP evidence recorded." />
            </div>
          </div>
          <div>
            <p className="label">Devices</p>
            <div className="mt-1.5">
              <ValueList values={facts.devices} emptyLabel="No device evidence recorded." />
            </div>
          </div>
        </div>

        <div className="row-rule mt-4 pt-3">
          <p className="label">Deliveries</p>
          <div className="mt-2">
            <RecordList
              records={facts.deliveries}
              noun="Delivery"
              emptyLabel="No assets were delivered on this order."
            />
          </div>
        </div>

        <div className="row-rule mt-4 pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="label">Visa CE 3.0 matches</p>
            <span className="text-sm text-muted">
              {facts.ce3_window_days > 0 ? "120 to 365 day lookback" : "Lookback unavailable"}
            </span>
          </div>
          <div className="mt-2">
            <RecordList
              records={facts.ce3_matches}
              noun="Match"
              emptyLabel="No prior undisputed transactions share this IP or device."
            />
          </div>
        </div>
      </PanelBody>

      <PanelFooter className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={facts.chain_valid ? "positive" : "negative"} dot>
          {facts.chain_valid ? "Chain valid" : "Chain broken"}
        </Badge>
        <span className="num text-sm text-muted">
          {formatInteger(facts.event_count)} chained events
        </span>
        <span className="num ml-auto truncate text-sm text-muted" title={facts.payer_id}>
          Payer {facts.payer_id}
        </span>
      </PanelFooter>
    </Panel>
  );
}
