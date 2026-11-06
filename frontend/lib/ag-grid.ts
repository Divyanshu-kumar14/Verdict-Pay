"use client";

/**
 * AG Grid Community theme, built with the v34 Theming API (no CSS imports).
 *
 * The grid is the product's table, so it uses the house numbers: 42px rows,
 * 12px sentence-case headers in the muted grey, tabular figures, one rule
 * colour and no wrapper chrome.
 */

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

const SURFACE = "#131217";
const GROUND = "#171719";
const RAISED = "#212023";
const RULE = "#1b1a1f";

export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: SURFACE,
  foregroundColor: "#ffffff",
  chromeBackgroundColor: GROUND,
  borderColor: RULE,
  headerBackgroundColor: SURFACE,
  headerTextColor: "#8a8c92",
  headerFontSize: "12px",
  headerFontWeight: 500,
  headerHeight: "38px",
  headerRowBorder: { color: RAISED },
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "#3a3a3e",
  cellTextColor: "#ffffff",
  cellFontFamily: '"Public Sans", Inter, system-ui, sans-serif',
  dataFontSize: "13px",
  fontFamily: '"Public Sans", Inter, system-ui, sans-serif',
  fontSize: "13px",
  rowHeight: "42px",
  rowBorder: { color: RULE },
  columnBorder: false,
  oddRowBackgroundColor: SURFACE,
  rowHoverColor: RAISED,
  selectedRowBackgroundColor: "#1b2233",
  accentColor: "#4a8ad6",
  checkboxCheckedBackgroundColor: "#4a8ad6",
  cellHorizontalPadding: "12px",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  menuBackgroundColor: RAISED,
  tooltipBackgroundColor: RAISED,
  tooltipTextColor: "#ffffff",
  columnHoverColor: "#1b1a1f",
});
