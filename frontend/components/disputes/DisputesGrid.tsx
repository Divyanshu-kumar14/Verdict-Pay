"use client";

import {
  type CellKeyDownEvent,
  type ColDef,
  type ICellRendererParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { FileText } from "lucide-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/Badge";
import { GRID_THEME } from "@/lib/ag-grid";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatDueIn, formatPercent, formatUsd, isoToMs, shortHash } from "@/lib/format";
import type { DisputeSummary } from "@/lib/types";
import { REASON_META, RECOMMENDATION_META, STAGE_META, CHANNEL_META } from "@/lib/vocab";

const DEFAULT_COL_DEF: ColDef<DisputeSummary> = {
  sortable: true,
  filter: true,
  resizable: true,
  suppressHeaderMenuButton: true,
  minWidth: 88,
};

type RecommendedEvField = "ev_fight_usd" | "ev_settle_usd" | "ev_offer_usd";

const RECOMMENDED_EV_FIELD: Partial<Record<DisputeSummary["recommended_action"], RecommendedEvField>> = {
  PROVIDE_EVIDENCE: "ev_fight_usd",
  MAKE_OFFER: "ev_offer_usd",
  ACCEPT_CLAIM: "ev_settle_usd",
};

export type DisputesGridProps = {
  rows: DisputeSummary[];
  now: number;
  onRowClick?: (disputeId: string) => void;
  height?: number;
  compact?: boolean;
};

function IdCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num text-[11px] text-ink" title={data.dispute_id}>
      {shortHash(data.dispute_id, 14, 4)}
    </span>
  );
}

function PayerCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num text-[11px] text-muted" title={data.payer_id}>
      {shortHash(data.payer_id, 8, 4)}
    </span>
  );
}

function ReasonCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = REASON_META[data.reason_code];
  return (
    <Badge tone={meta.tone} title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function StageCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = STAGE_META[data.stage];
  return (
    <Badge tone={meta.tone} title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function ChannelCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = CHANNEL_META[data.channel];
  return (
    <span className="font-mono text-[10px] text-muted" title={meta.label}>
      {meta.short}
    </span>
  );
}

function AmountCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num text-[11.5px] tabular-nums text-ink">{formatUsd(data.amount_usd)}</span>
  );
}

function WinProbCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const pct = Math.max(0, Math.min(1, data.p_win));
  const tone = pct >= 0.55 ? "bg-emerald" : pct >= 0.35 ? "bg-amber" : "bg-rose";
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden className="h-1 w-12 overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${pct * 100}%` }} />
      </span>
      <span className="num text-[11px] tabular-nums text-ink">{formatPercent(data.p_win)}</span>
    </span>
  );
}

function EvCell({
  params,
  field,
}: {
  params: ICellRendererParams<DisputeSummary>;
  field: RecommendedEvField;
}) {
  const data = params.data;
  if (!data) return null;
  const highlighted = RECOMMENDED_EV_FIELD[data.recommended_action] === field;
  return (
    <span
      className={cn(
        "num text-[11px] tabular-nums",
        highlighted ? "text-emerald" : "text-muted",
      )}
      title={highlighted ? "Cheapest recommended path" : undefined}
    >
      {formatUsd(data[field])}
    </span>
  );
}

function RecommendationCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = RECOMMENDATION_META[data.recommended_action];
  return (
    <Badge tone={meta.tone} dot title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function DueCell({ params, now }: { params: ICellRendererParams<DisputeSummary>; now: number }) {
  const data = params.data;
  if (!data) return null;
  const dueMs = isoToMs(data.seller_response_due_date);
  if (dueMs === null) {
    return <span className="text-[11px] text-dim">no deadline</span>;
  }
  const overdue = dueMs < now;
  return (
    <span
      className={cn(
        "num text-[11px] tabular-nums",
        overdue ? "text-rose" : dueMs - now < 3 * 86_400_000 ? "text-amber" : "text-muted",
      )}
      title={formatAbsolute(data.seller_response_due_date)}
    >
      {formatDueIn(data.seller_response_due_date, now)}
    </span>
  );
}

function DossierCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  if (!data.dossier_available) {
    return (
      <span className="text-[11px] text-dim" aria-label="No dossier yet">
        —
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald"
      aria-label="Dossier available"
    >
      <FileText size={12} aria-hidden />
      PDF
    </span>
  );
}

/** AG Grid Community triage queue. Default sort is seller response due date ascending. */
export function DisputesGrid({
  rows,
  now,
  onRowClick,
  height = 560,
  compact = false,
}: DisputesGridProps) {
  const columnDefs = useMemo<ColDef<DisputeSummary>[]>(() => {
    const idColumn: ColDef<DisputeSummary> = {
      headerName: "Dispute",
      field: "dispute_id",
      width: 118,
      minWidth: 110,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <IdCell params={params} />,
    };
    const queueColumns: ColDef<DisputeSummary>[] = [
      {
        headerName: "Payer",
        field: "payer_id",
        width: 82,
        minWidth: 78,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <PayerCell params={params} />,
      },
      {
        headerName: "Reason",
        field: "reason_code",
        width: 84,
        minWidth: 78,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <ReasonCell params={params} />,
      },
      {
        headerName: "Stage",
        field: "stage",
        width: 88,
        minWidth: 82,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <StageCell params={params} />,
      },
      {
        headerName: "Channel",
        field: "channel",
        width: 91,
        minWidth: 84,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <ChannelCell params={params} />
        ),
      },
      {
        headerName: "Amount",
        field: "amount_usd",
        width: 86,
        minWidth: 80,
        type: "numericColumn",
        cellStyle: { textAlign: "right" },
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <AmountCell params={params} />,
      },
      {
        headerName: "p(win)",
        field: "p_win",
        width: 96,
        minWidth: 90,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <WinProbCell params={params} />
        ),
      },
      {
        headerName: "EV fight",
        field: "ev_fight_usd",
        width: 88,
        minWidth: 82,
        cellStyle: { textAlign: "right" },
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_fight_usd" />
        ),
      },
      {
        headerName: "EV settle",
        field: "ev_settle_usd",
        width: 98,
        minWidth: 90,
        cellStyle: { textAlign: "right" },
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_settle_usd" />
        ),
      },
      {
        headerName: "EV offer",
        field: "ev_offer_usd",
        width: 92,
        minWidth: 86,
        cellStyle: { textAlign: "right" },
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_offer_usd" />
        ),
      },
      {
        headerName: "Recommendation",
        field: "recommended_action",
        width: 146,
        minWidth: 132,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <RecommendationCell params={params} />
        ),
      },
      {
        headerName: "Due",
        field: "seller_response_due_date",
        width: 104,
        minWidth: 96,
        sort: "asc",
        comparator: (left: string | null, right: string | null) => {
          const leftMs = isoToMs(left) ?? Number.POSITIVE_INFINITY;
          const rightMs = isoToMs(right) ?? Number.POSITIVE_INFINITY;
          return leftMs - rightMs;
        },
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <DueCell params={params} now={now} />
        ),
      },
      {
        headerName: "PDF",
        field: "dossier_available",
        width: 60,
        minWidth: 54,
        sortable: false,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <DossierCell params={params} />
        ),
      },
    ];

    if (compact) {
      return [
        idColumn,
        queueColumns[2],
        queueColumns[4],
        queueColumns[5],
        queueColumns[9],
        queueColumns[10],
      ].filter((column): column is ColDef<DisputeSummary> => Boolean(column));
    }

    return [idColumn, ...queueColumns];
  }, [compact, now]);

  return (
    <div
      role="region"
      aria-label="Dispute triage grid"
      className="w-full"
      style={{ height }}
    >
      <AgGridReact<DisputeSummary>
        theme={GRID_THEME}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        getRowId={(params) => params.data.dispute_id}
        rowHeight={44}
        headerHeight={34}
        animateRows={false}
        suppressCellFocus={false}
        ensureDomOrder
        enableCellTextSelection
        suppressDragLeaveHidesColumns
        rowClass="cursor-pointer"
        onRowClicked={(event: RowClickedEvent<DisputeSummary>) => {
          if (event.data) onRowClick?.(event.data.dispute_id);
        }}
        onCellKeyDown={(event: CellKeyDownEvent<DisputeSummary>) => {
          const keyboardEvent = event.event;
          if (
            keyboardEvent instanceof KeyboardEvent &&
            keyboardEvent.key === "Enter" &&
            event.data
          ) {
            keyboardEvent.preventDefault();
            onRowClick?.(event.data.dispute_id);
          }
        }}
      />
    </div>
  );
}