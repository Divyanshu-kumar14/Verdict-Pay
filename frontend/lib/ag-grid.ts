"use client";

/**
 * AG Grid Community theme, built with the v34 Theming API (no CSS imports).
 * Community only — no enterprise modules are registered anywhere in the app.
 */

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: "#0e141b",
  foregroundColor: "#e6edf3",
  chromeBackgroundColor: "#0b1117",
  borderColor: "rgba(255, 255, 255, 0.07)",
  headerBackgroundColor: "#0b1117",
  headerTextColor: "#93a1b0",
  headerFontSize: "10.5px",
  headerFontWeight: 600,
  headerHeight: "34px",
  headerRowBorder: { color: "rgba(255, 255, 255, 0.07)" },
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "rgba(255, 255, 255, 0.12)",
  cellTextColor: "#cbd5e1",
  cellFontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  dataFontSize: "12px",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontSize: "12px",
  rowHeight: "44px",
  rowBorder: { color: "rgba(255, 255, 255, 0.045)" },
  columnBorder: false,
  oddRowBackgroundColor: "#0c1219",
  rowHoverColor: "#181d24",
  selectedRowBackgroundColor: "#12251f",
  accentColor: "#34d399",
  cellHorizontalPadding: "10px",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  menuBackgroundColor: "#121a23",
  tooltipBackgroundColor: "#121a23",
  tooltipTextColor: "#e6edf3",
  columnHoverColor: "rgba(255, 255, 255, 0.02)",
});