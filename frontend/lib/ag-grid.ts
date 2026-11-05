"use client";

/**
 * AG Grid Community theme, built with the v34 Theming API (no CSS imports).
 * Community only — no enterprise modules are registered anywhere in the app.
 */

import { AllCommunityModule, ModuleRegistry, themeQuartz } from "ag-grid-community";

ModuleRegistry.registerModules([AllCommunityModule]);

export const GRID_THEME = themeQuartz.withParams({
  backgroundColor: "#0b1118",
  foregroundColor: "#e6edf3",
  chromeBackgroundColor: "#080d13",
  borderColor: "rgba(255, 255, 255, 0.07)",
  headerBackgroundColor: "#080d13",
  headerTextColor: "#74869b",
  headerFontSize: "10px",
  headerFontWeight: 600,
  headerHeight: "32px",
  headerRowBorder: { color: "rgba(125, 211, 252, 0.14)" },
  headerColumnBorder: false,
  headerColumnResizeHandleColor: "rgba(255, 255, 255, 0.14)",
  cellTextColor: "#cbd5e1",
  cellFontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  dataFontSize: "12px",
  fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
  fontSize: "12px",
  rowHeight: "40px",
  rowBorder: { color: "rgba(255, 255, 255, 0.045)" },
  columnBorder: false,
  oddRowBackgroundColor: "#0a0f16",
  rowHoverColor: "#141c26",
  selectedRowBackgroundColor: "#12251f",
  accentColor: "#2ee6a8",
  cellHorizontalPadding: "8px",
  wrapperBorder: false,
  wrapperBorderRadius: 0,
  menuBackgroundColor: "#121a23",
  tooltipBackgroundColor: "#121a23",
  tooltipTextColor: "#e6edf3",
  columnHoverColor: "rgba(255, 255, 255, 0.02)",
});