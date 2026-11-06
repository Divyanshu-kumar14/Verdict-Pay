"use client";

import {
  type CellKeyDownEvent,
  type ColDef,
  type GridReadyEvent,
  type GridSizeChangedEvent,
  type ICellRendererParams,
  type RowClassParams,
  type RowClickedEvent,
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo } from "react";

import { Badge } from "@/components/ui/Badge";
import { GRID_THEME } from "@/lib/ag-grid";
import { cn } from "@/lib/cn";
import { formatAbsolute, formatDueIn, formatUsd, isoToMs, shortHash } from "@/lib/format";
import { useNow } from "@/lib/hooks/useNow";
import type { DisputeSummary } from "@/lib/types";
import { REASON_META, RECOMMENDATION_META, STAGE_META } from "@/lib/vocab";

const DEFAULT_COL_DEF: ColDef<DisputeSummary> = {
  sortable: true,
  filter: true,
  resizable: true,
  suppressHeaderMenuButton: true,
  // Keep min widths small enough that all seven columns fit a 768px card.
  minWidth: 80,
};

// Seller response window: the same 72h arithmetic the workspace filter uses.
const SOON_WINDOW_MS = 3 * 86_400_000;
const ISO_DATE_PREFIX = /^[0-9]{4}-[0-9]{2}-[0-9]{2}/;

export type DisputesGridProps = {
  rows: DisputeSummary[];
  onRowClick?: (disputeId: string) => void;
  height?: number;
  compact?: boolean;
};

function CaseCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num block truncate text-sm text-ink" title={data.dispute_id}>
      {shortHash(data.dispute_id, 12, 4)}
    </span>
  );
}

function StageCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = STAGE_META[data.stage];
  return (
    <span className="block truncate text-sm text-muted" title={meta.label}>
      {meta.short}
    </span>
  );
}

function ReasonCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = REASON_META[data.reason_code];
  return (
    <span className="block truncate text-sm text-muted" title={meta.label}>
      {meta.short}
    </span>
  );
}

function AmountCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num block truncate text-right text-sm text-ink">
      {formatUsd(data.amount_usd)}
    </span>
  );
}

function ExpectedLossCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  return (
    <span className="num block truncate text-right text-sm text-muted" title="Expected loss">
      {formatUsd(data.ev_settle_usd)}
    </span>
  );
}

function RecommendedCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  const data = params.data;
  if (!data) return null;
  const meta = RECOMMENDATION_META[data.recommended_action];
  return (
    <Badge tone={meta.tone} title={meta.label}>
      {meta.short}
    </Badge>
  );
}

function DueCell({ params }: { params: ICellRendererParams<DisputeSummary> }) {
  // Tick on its own clock so deadline polarity can flip in place without the
  // parent re-rendering the grid's column definitions (which would reset sort
  // and scroll).
  const now = useNow(60000) ?? Date.now();
  const data = params.data;
  if (!data) return null;
  const due = data.seller_response_due_date;
  const dueMs = isoToMs(due);
  if (due === null || dueMs === null) {
    return <span className="block text-sm text-muted">no deadline</span>;
  }
  const overdue = dueMs < now;
  const soon = !overdue && dueMs - now < SOON_WINDOW_MS;
  const label = ISO_DATE_PREFIX.test(due) ? due.slice(0, 10) : formatAbsolute(due);
  return (
    <span
      className={cn(
        "num block truncate text-sm",
        overdue ? "text-negative" : soon ? "text-warning" : "text-muted",
      )}
      title={formatAbsolute(due) + " · " + formatDueIn(due, now)}
    >
      {label}
    </span>
  );
}

/**
 * AG Grid Community triage queue. Default sort is seller response due date
 * ascending. Rows carry a left accent bar for their deadline risk: negative for
 * overdue, warning for due soon, none for the rest.
 */
export function DisputesGrid({
  rows,
  onRowClick,
  height = 560,
  compact = false,
}: DisputesGridProps) {
  // One render-scope clock for the row accent; DueCell keeps its own so it can
  // refresh in place. Neither is part of the column definitions, so sorting and
  // scroll survive every tick.
  const now = useNow(60000) ?? Date.now();

  const columnDefs = useMemo<ColDef<DisputeSummary>[]>(() => {
    const caseColumn: ColDef<DisputeSummary> = {
      headerName: "Case",
      field: "dispute_id",
      width: 140,
      minWidth: 96,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <CaseCell params={params} />,
    };
    const stageColumn: ColDef<DisputeSummary> = {
      headerName: "Stage",
      field: "stage",
      width: 128,
      minWidth: 78,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <StageCell params={params} />,
    };
    const reasonColumn: ColDef<DisputeSummary> = {
      headerName: "Reason",
      field: "reason_code",
      width: 176,
      minWidth: 84,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <ReasonCell params={params} />,
    };
    const amountColumn: ColDef<DisputeSummary> = {
      headerName: "Amount",
      field: "amount_usd",
      width: 132,
      minWidth: 82,
      type: "numericColumn",
      cellStyle: { textAlign: "right" },
      headerClass: "ag-right-aligned-header",
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <AmountCell params={params} />,
    };
    const lossColumn: ColDef<DisputeSummary> = {
      headerName: "Expected loss",
      field: "ev_settle_usd",
      width: 152,
      minWidth: 94,
      type: "numericColumn",
      cellStyle: { textAlign: "right" },
      headerClass: "ag-right-aligned-header",
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
        <ExpectedLossCell params={params} />
      ),
    };
    const dueColumn: ColDef<DisputeSummary> = {
      headerName: "Deadline",
      field: "seller_response_due_date",
      width: 128,
      minWidth: 100,
      sort: "asc",
      comparator: (left: string | null, right: string | null) => {
        const leftMs = isoToMs(left) ?? Number.POSITIVE_INFINITY;
        const rightMs = isoToMs(right) ?? Number.POSITIVE_INFINITY;
        return leftMs - rightMs;
      },
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => <DueCell params={params} />,
    };
    const recommendedColumn: ColDef<DisputeSummary> = {
      headerName: "Recommended",
      field: "recommended_action",
      width: 168,
      minWidth: 96,
      cellRenderer: (params: ICellRendererParams<DisputeSummary>) => (
        <RecommendedCell params={params} />
      ),
    };

    if (compact) {
      return [caseColumn, amountColumn, dueColumn, recommendedColumn];
    }

    return [
      caseColumn,
      stageColumn,
      reasonColumn,
      amountColumn,
      lossColumn,
      dueColumn,
      recommendedColumn,
    ];
  }, [compact]);

  return (
    <div role="region" aria-label="Dispute triage grid" className="w-full" style={{ height }}>
      <AgGridReact<DisputeSummary>
        theme={GRID_THEME}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={DEFAULT_COL_DEF}
        getRowId={(params) => params.data.dispute_id}
        rowSelection={{ mode: "singleRow", checkboxes: false, enableClickSelection: true }}
        animateRows={false}
        suppressCellFocus={false}
        ensureDomOrder
        enableCellTextSelection
        suppressDragLeaveHidesColumns
        rowClass="cursor-pointer"
        getRowStyle={(params: RowClassParams<DisputeSummary>) => {
          const data = params.data;
          if (!data) return undefined;
          const accents: string[] = [];
          const dueMs = isoToMs(data.seller_response_due_date);
          if (dueMs !== null) {
            if (dueMs < now) accents.push("inset 3px 0 0 var(--color-negative)");
            else if (dueMs - now <= SOON_WINDOW_MS) {
              accents.push("inset 3px 0 0 var(--color-warning)");
            }
          }
          // Selection reads as a crisp accent ring that keeps the deadline accent beside it.
          if (params.node.isSelected()) accents.push("inset 0 0 0 1px var(--color-accent)");
          return accents.length > 0 ? { boxShadow: accents.join(", ") } : undefined;
        }}
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
