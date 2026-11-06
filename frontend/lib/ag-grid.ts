"use client";

/**
 * AG Grid Community theme, built with the v34 Theming API (no CSS imports).
 *
 * The grid is the product's table, so it uses the house numbers: 42px rows,
 * 12px sentence-case headers in the muted grey, tabular figures, one rule
 * colour and no wrapper chrome. Colours mirror the midnight-navy palette in
 * app/globals.css so the grid never drifts from the surface it sits on.
 */

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const SURFACE = "#101527";
const GROUND = "#0a0e1b";
const RAISED = "#1b2338";
const RULE = "#1a2233";
const LINE = "#232d45";

export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: SURFACE,
  foregroundColor: "#edf2f9",
  chromeBackgroundColor: GROUND,
  borderColor: RULE,
  headerBackgroundColor: SURFACE,
  headerTextColor: "#8b99b0",
  headerFontSize: "12px",
  headerFontWeight: 500,
  headerHeight: "38px",
  headerRowBorder: { color: LINE },
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "#2c3752",
  cellTextColor: "#edf2f9",
  cellFontFamily: '"Public Sans", Inter, system-ui, sans-serif',
  dataFontSize: "13px",
  fontFamily: '"Public Sans", Inter, system-ui, sans-serif',
  fontSize: "13px",
  rowHeight: "42px",
  rowBorder: { color: RULE },
  columnBorder: false,
  oddRowBackgroundColor: SURFACE,
  rowHoverColor: RAISED,
  selectedRowBackgroundColor: "#0e2430",
  accentColor: "#35c4e8",
  checkboxCheckedBackgroundColor: "#35c4e8",
  cellHorizontalPadding: "12px",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  menuBackgroundColor: RAISED,
  tooltipBackgroundColor: RAISED,
  tooltipTextColor: "#edf2f9",
  columnHoverColor: "#1a2233",
});
