/**
 * All money, probability, hash and time formatting lives here.
 *
 * Every function is pure: callers pass "now" in milliseconds so a rendered page
 * is reproducible for a given instant. Money never reaches the UI as a string.
 */

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const integerFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

const compactIntegerFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const absoluteFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const dayFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

const weekdayFormatter = new Intl.DateTimeFormat("en-US", { weekday: "short" });

const clockFormatter = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Parse an ISO timestamp; returns null for nullish or unparseable input. */
export function isoToMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** "$1,234.50". Non-finite values render as an em dash, never "NaN". */
export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return usdFormatter.format(value);
}

/** "+0.15" / "-0.12" / "0.00" for the frozen win-probability deltas. */
export function formatDelta(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

/** 0.6917 -> "69.2%". Fractions, not percentages, are the API's unit. */
export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Small integer formatting with grouping ("42,000"). */
export function formatInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return integerFormatter.format(value);
}

/** Compact integer formatting for telemetry volumes ("42K"). */
export function formatCompactInteger(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return compactIntegerFormatter.format(value);
}

/** "312ms" — the containment budget is quoted in milliseconds. */
export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return "—ms";
  return `${Math.max(0, Math.round(ms))}ms`;
}

/** "6 Nov 2026, 14:03" in the viewer's locale time zone. */
export function formatAbsolute(value: string | null | undefined): string {
  const ms = isoToMs(value);
  if (ms === null) return "—";
  return absoluteFormatter.format(new Date(ms));
}

/** "Nov 6" — used for timeline day headers. */
export function formatDayLabel(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return dayFormatter.format(date);
}

/** "Fri" — used for timeline weekday captions. */
export function formatWeekday(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return weekdayFormatter.format(date);
}

/** "02:01:51.284" — the judge step log needs milliseconds. */
export function formatClock(epochMs: number): string {
  if (!Number.isFinite(epochMs)) return "--:--:--.---";
  const date = new Date(epochMs);
  return `${clockFormatter.format(date)}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

/** "2d 4h left" / "overdue 1d 3h" / "no deadline" for seller response due dates. */
export function formatDueIn(value: string | null | undefined, now: number): string {
  const ms = isoToMs(value);
  if (ms === null) return "no deadline";
  const delta = ms - now;
  const body = formatDuration(Math.abs(delta));
  if (body === "moments") return "due now";
  return delta >= 0 ? `${body} left` : `overdue ${body}`;
}

/** Rounded, human duration used by the deadline helpers. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 60_000) return "moments";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days}d` : `${days}d ${restHours}h`;
}

/** "8f3a1c2e…9b7d" — hashes stay readable in dense tables. */
export function shortHash(hash: string, head = 10, tail = 6): string {
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

/** Clamp a value into [min, max]; keeps bar widths and chart geometry sane. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** "…/actions/SEND_MESSAGE" -> "Send message" for audit rows. */
export function humaniseAction(action: string): string {
  return action
    .toLowerCase()
    .split("_")
    .map((part) => (part.length === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(" ");
}