"use client";

import {
  type CellKeyDownEvent,
  type ColDef,
  type GridReadyEvent,
  type GridSizeChangedEvent,
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
import { REASON_META, RECOMMENDATION_META, STAGE_META, CHANNEL_META, TONE_DOT } from "@/lib/vocab";

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
    <span className="flex items-center gap-1.5">
      {data.dossier_available ? (
        <span aria-hidden className="h-3 w-[2px] rounded-full bg-emerald" />
      ) : (
        <span aria-hidden className="h-3 w-[2px] rounded-full bg-white/15" />
      )}
      <span className="num text-[11px] text-ink" title={data.dispute_id}>
        {shortHash(data.dispute_id, 12, 4)}
      </span>
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
    <Badge tone={meta.tone} dot title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function StageCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = STAGE_META[data.stage];
  return (
    <Badge tone={meta.tone} dot title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function ChannelCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = CHANNEL_META[data.channel];
  const rail = data.channel === "EXTERNAL" ? "bg-sky" : "bg-white/25";
  return (
    <span className="flex items-center gap-1.5" title={meta.label}>
      <span aria-hidden className={cn("h-3 w-[2px] rounded-full", rail)} />
      <span className="font-mono text-[10px] tracking-[0.08em] text-muted">{meta.short}</span>
    </span>
  );
}

function AmountCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num block text-right text-[12px] font-medium tabular-nums text-ink">
      {formatUsd(data.amount_usd)}
    </span>
  );
}

function WinProbCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const pct = Math.max(0, Math.min(1, data.p_win));
  const tone = pct >= 0.55 ? "bg-emerald" : pct >= 0.35 ? "bg-amber" : "bg-rose";
  const word = pct >= 0.55 ? "strong" : pct >= 0.35 ? "contested" : "weak";
  return (
    <span
      className="flex items-center justify-end gap-2"
      role="img"
      aria-label={"Win probability " + formatPercent(data.p_win) + ", " + word}
    >
      <span aria-hidden className="h-[5px] w-11 overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: pct * 100 + "%" }} />
      </span>
      <span className="num w-11 text-right text-[11px] tabular-nums text-ink">
        {formatPercent(data.p_win)}
      </span>
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
        "num block text-right text-[11.5px] tabular-nums",
        highlighted ? "font-semibold text-emerald" : "text-muted",
      )}
      title={highlighted ? "Cheapest recommended path" : formatUsd(data[field])}
      aria-label={highlighted ? formatUsd(data[field]) + ", cheapest path" : undefined}
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
  const soon = !overdue && dueMs - now < 3 * 86_400_000;
  const rail = overdue ? "bg-rose" : soon ? "bg-amber" : "bg-ice/60";
  return (
    <span className="flex items-center gap-1.5" title={formatAbsolute(data.seller_response_due_date)}>
      <span aria-hidden className={cn("h-3.5 w-[2px] rounded-full", rail)} />
      <span
        className={cn(
          "num text-[11px] tabular-nums",
          overdue ? "font-medium text-rose" : soon ? "text-amber" : "text-muted",
        )}
      >
        {formatDueIn(data.seller_response_due_date, now)}
      </span>
      {overdue ? (
        <span aria-hidden className={cn("h-1 w-1 rounded-full", TONE_DOT.rose)} />
      ) : null}
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
      className="inline-flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] text-emerald"
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
      width: 122,
      minWidth: 112,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <IdCell params={params} />,
    };
    const queueColumns: ColDef<DisputeSummary>[] = [
      {
        headerName: "Payer",
        field: "payer_id",
        width: 84,
        minWidth: 78,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <PayerCell params={params} />,
      },
      {
        headerName: "Reason",
        field: "reason_code",
        width: 78,
        minWidth: 72,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <ReasonCell params={params} />,
      },
      {
        headerName: "Stage",
        field: "stage",
        width: 96,
        minWidth: 88,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <StageCell params={params} />,
      },
      {
        headerName: "Channel",
        field: "channel",
        width: 96,
        minWidth: 88,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <ChannelCell params={params} />
        ),
      },
      {
        headerName: "Amount",
        field: "amount_usd",
        width: 92,
        minWidth: 84,
        type: "numericColumn",
        cellStyle: { textAlign: "right" },
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <AmountCell params={params} />,
      },
      {
        headerName: "p(win)",
        field: "p_win",
        width: 112,
        minWidth: 104,
        type: "numericColumn",
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <WinProbCell params={params} />
        ),
      },
      {
        headerName: "EV fight",
        field: "ev_fight_usd",
        width: 92,
        minWidth: 84,
        cellStyle: { textAlign: "right" },
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_fight_usd" />
        ),
      },
      {
        headerName: "EV settle",
        field: "ev_settle_usd",
        width: 96,
        minWidth: 88,
        cellStyle: { textAlign: "right" },
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_settle_usd" />
        ),
      },
      {
        headerName: "EV offer",
        field: "ev_offer_usd",
        width: 92,
        minWidth: 84,
        cellStyle: { textAlign: "right" },
        headerClass: "ag-right-aligned-header",
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <EvCell params={params} field="ev_offer_usd" />
        ),
      },
      {
        headerName: "Recommendation",
        field: "recommended_action",
        width: 138,
        minWidth: 126,
        cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
          <RecommendationCell params={params} />
        ),
      },
      {
        headerName: "Due",
        field: "seller_response_due_date",
        width: 118,
        minWidth: 108,
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
        width: 58,
        minWidth: 52,
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
        rowHeight={40}
        headerHeight={32}
        animateRows={false}
        suppressCellFocus={false}
        ensureDomOrder
        enableCellTextSelection
        suppressDragLeaveHidesColumns
        rowClass="cursor-pointer"
        // Columns carry fixed widths that total more than the card at narrow
        // widths, which pushed the header viewport past its container and made
        // the grid scroll under its own frame. Fit the columns to whatever
        // space the card actually has, and re-fit whenever it resizes.
        onGridReady={(event: GridReadyEvent<DisputeSummary>) => {
          event.api.sizeColumnsToFit();
        }}
        onGridSizeChanged={(event: GridSizeChangedEvent<DisputeSummary>) => {
          event.api.sizeColumnsToFit();
        }}
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
