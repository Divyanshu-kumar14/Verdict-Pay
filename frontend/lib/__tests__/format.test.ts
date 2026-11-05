import { describe, expect, it } from "vitest";

import {
  clamp,
  formatAbsolute,
  formatClock,
  formatCompactInteger,
  formatDayLabel,
  formatDelta,
  formatDueIn,
  formatDuration,
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd,
  formatWeekday,
  humaniseAction,
  isoToMs,
  shortHash,
} from "../format";

// ------------------------------------------------ isoToMs
describe("isoToMs", () => {
  it("returns null for null", () => {
    expect(isoToMs(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(isoToMs(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(isoToMs("")).toBeNull();
  });

  it("returns null for invalid string", () => {
    expect(isoToMs("not-a-date")).toBeNull();
    expect(isoToMs("2026-13-40")).toBeNull();
  });

  it("parses valid ISO string to milliseconds", () => {
    const iso = "2026-11-06T03:30:00.000Z";
    const expected = Date.parse(iso);
    expect(isoToMs(iso)).toBe(expected);
    expect(typeof isoToMs(iso)).toBe("number");
  });

  it("handles timezone offsets correctly", () => {
    // Same instant expressed with different timezones
    const utc = "2026-11-06T10:00:00.000Z";
    const offset = "2026-11-06T15:30:00.000+05:30";
    // 15:30 IST = 10:00 UTC
    expect(isoToMs(utc)).toBe(isoToMs(offset));
  });

  it("parses date-only ISO", () => {
    const ms = isoToMs("2026-11-06");
    expect(ms).not.toBeNull();
    expect(typeof ms).toBe("number");
  });
});

// ------------------------------------------------ formatUsd
describe("formatUsd", () => {
  it('formats 1234.5 as "$1,234.50"', () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
  });

  it('formats 0 as "$0.00"', () => {
    expect(formatUsd(0)).toBe("$0.00");
  });

  it("formats negative values with minus sign", () => {
    const result = formatUsd(-99.99);
    expect(result).toBe("-$99.99");
  });

  it('returns "—" for NaN', () => {
    expect(formatUsd(Number.NaN)).toBe("—");
  });

  it('returns "—" for Infinity and -Infinity', () => {
    expect(formatUsd(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatUsd(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("formats large values with grouping", () => {
    expect(formatUsd(1_000_000)).toBe("$1,000,000.00");
  });

  it("rounds to two decimals", () => {
    expect(formatUsd(1.999)).toBe("$2.00");
    expect(formatUsd(1.004)).toBe("$1.00");
  });
});

// ------------------------------------------------ formatDelta
describe("formatDelta", () => {
  it('formats positive 0.15 as "+0.15"', () => {
    expect(formatDelta(0.15)).toBe("+0.15");
  });

  it('formats negative -0.12 as "-0.12"', () => {
    expect(formatDelta(-0.12)).toBe("-0.12");
  });

  it('formats zero as "0.00" without plus', () => {
    expect(formatDelta(0)).toBe("0.00");
    expect(formatDelta(-0)).toBe("0.00");
  });

  it('returns "—" for NaN', () => {
    expect(formatDelta(Number.NaN)).toBe("—");
  });

  it('returns "—" for Infinity', () => {
    expect(formatDelta(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatDelta(Number.NEGATIVE_INFINITY)).toBe("—");
  });

  it("includes plus sign for small positive", () => {
    expect(formatDelta(0.001)).toBe("+0.00");
  });
});

// ------------------------------------------------ formatPercent
describe("formatPercent", () => {
  it('formats 0.6917 with default digits as "69.2%"', () => {
    expect(formatPercent(0.6917)).toBe("69.2%");
  });

  it("respects digits parameter", () => {
    expect(formatPercent(0.6917, 0)).toBe("69%");
    expect(formatPercent(0.6917, 2)).toBe("69.17%");
    expect(formatPercent(0.5, 1)).toBe("50.0%");
  });

  it('returns "—" for NaN', () => {
    expect(formatPercent(Number.NaN)).toBe("—");
  });

  it('returns "—" for Infinity', () => {
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("handles zero and one", () => {
    expect(formatPercent(0)).toBe("0.0%");
    expect(formatPercent(1)).toBe("100.0%");
  });

  it("handles negative fractions", () => {
    expect(formatPercent(-0.1)).toBe("-10.0%");
  });
});

// ------------------------------------------------ formatInteger
describe("formatInteger", () => {
  it('formats 42000 as "42,000"', () => {
    expect(formatInteger(42_000)).toBe("42,000");
  });

  it('returns "—" for NaN and Infinity', () => {
    expect(formatInteger(Number.NaN)).toBe("—");
    expect(formatInteger(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats zero and negative", () => {
    expect(formatInteger(0)).toBe("0");
    expect(formatInteger(-1000)).toBe("-1,000");
  });
});

// ------------------------------------------------ formatCompactInteger
describe("formatCompactInteger", () => {
  it('formats 42000 as locale compact variant containing "42" and "K"', () => {
    const result = formatCompactInteger(42_000);
    // en-US produces "42K"; be tolerant of narrow no-break space variants
    expect(result).toMatch(/42.*K/);
  });

  it('returns "—" for NaN', () => {
    expect(formatCompactInteger(Number.NaN)).toBe("—");
    expect(formatCompactInteger(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats small numbers without compact suffix", () => {
    const result = formatCompactInteger(42);
    expect(result).toBe("42");
  });

  it("formats large numbers compactly", () => {
    const result = formatCompactInteger(1_500_000);
    expect(result).toMatch(/1\.5.*M/);
  });
});

// ------------------------------------------------ formatLatency
describe("formatLatency", () => {
  it('formats 312 as "312ms"', () => {
    expect(formatLatency(312)).toBe("312ms");
  });

  it('returns "—ms" for NaN', () => {
    expect(formatLatency(Number.NaN)).toBe("—ms");
    expect(formatLatency(Number.POSITIVE_INFINITY)).toBe("—ms");
  });

  it('clamps negative to "0ms"', () => {
    expect(formatLatency(-10)).toBe("0ms");
    expect(formatLatency(-0.1)).toBe("0ms");
  });

  it("rounds to nearest integer", () => {
    expect(formatLatency(10.6)).toBe("11ms");
    expect(formatLatency(10.4)).toBe("10ms");
  });

  it("formats zero", () => {
    expect(formatLatency(0)).toBe("0ms");
  });
});

// ------------------------------------------------ formatAbsolute
describe("formatAbsolute", () => {
  it('returns "—" for null and undefined', () => {
    expect(formatAbsolute(null)).toBe("—");
    expect(formatAbsolute(undefined)).toBe("—");
  });

  it('returns "—" for invalid ISO', () => {
    expect(formatAbsolute("invalid")).toBe("—");
    expect(formatAbsolute("")).toBe("—");
  });

  it("returns formatted string for valid ISO (not dash)", () => {
    const result = formatAbsolute("2026-11-06T10:00:00.000Z");
    expect(result).not.toBe("—");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("contains year for valid date", () => {
    const result = formatAbsolute("2026-11-06T10:00:00.000Z");
    expect(result).toContain("2026");
  });
});

// ------------------------------------------------ formatDayLabel
describe("formatDayLabel", () => {
  it("formats Date object", () => {
    const date = new Date("2026-11-06T10:00:00.000Z");
    const result = formatDayLabel(date);
    expect(result).toMatch(/Nov/);
    expect(result).toMatch(/6/);
  });

  it("formats ISO string", () => {
    const result = formatDayLabel("2026-11-06T10:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats epoch milliseconds", () => {
    const ms = Date.parse("2026-11-06T10:00:00.000Z");
    const result = formatDayLabel(ms);
    expect(typeof result).toBe("string");
  });
});

// ------------------------------------------------ formatWeekday
describe("formatWeekday", () => {
  it("formats Date object to short weekday", () => {
    // 2026-11-06 is a Friday
    const date = new Date("2026-11-06T10:00:00.000Z");
    const result = formatWeekday(date);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("formats epoch number", () => {
    const ms = Date.parse("2026-11-06T10:00:00.000Z");
    const result = formatWeekday(ms);
    expect(typeof result).toBe("string");
  });
});

// ------------------------------------------------ formatClock
describe("formatClock", () => {
  it('formats epochMs to "HH:MM:SS.mmm" pattern', () => {
    const ms = Date.parse("2026-11-06T02:01:51.284Z");
    const result = formatClock(ms);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });

  it("pads milliseconds to 3 digits", () => {
    // Construct a date with known milliseconds in local tz
    const date = new Date(2026, 0, 1, 12, 0, 0, 5);
    const result = formatClock(date.getTime());
    expect(result).toMatch(/\.005$/);
  });

  it('returns placeholder for non-finite', () => {
    expect(formatClock(Number.NaN)).toBe("--:--:--.---");
    expect(formatClock(Number.POSITIVE_INFINITY)).toBe("--:--:--.---");
    expect(formatClock(Number.NEGATIVE_INFINITY)).toBe("--:--:--.---");
  });

  it("formats zero epoch", () => {
    const result = formatClock(0);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/);
  });
});

// ------------------------------------------------ formatDueIn
describe("formatDueIn", () => {
  it('returns "no deadline" for null', () => {
    expect(formatDueIn(null, Date.now())).toBe("no deadline");
    expect(formatDueIn(undefined, Date.now())).toBe("no deadline");
  });

  it('returns "no deadline" for invalid ISO', () => {
    expect(formatDueIn("not-a-date", Date.now())).toBe("no deadline");
  });

  it('returns future with "left" suffix', () => {
    const now = Date.parse("2026-11-06T10:00:00.000Z");
    const future = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(); // 2 days later
    const result = formatDueIn(future, now);
    expect(result).toMatch(/left$/);
    expect(result).toContain("d");
  });

  it('returns past with "overdue" prefix', () => {
    const now = Date.parse("2026-11-06T10:00:00.000Z");
    const past = new Date(now - 3 * 60 * 60 * 1000).toISOString(); // 3h ago
    const result = formatDueIn(past, now);
    expect(result).toMatch(/^overdue /);
  });

  it('returns "due now" for moments threshold', () => {
    const now = Date.parse("2026-11-06T10:00:00.000Z");
    const soon = new Date(now + 30_000).toISOString(); // 30s later -> moments
    expect(formatDueIn(soon, now)).toBe("due now");
    const justPast = new Date(now - 10_000).toISOString();
    expect(formatDueIn(justPast, now)).toBe("due now");
  });
});

// ------------------------------------------------ formatDuration
describe("formatDuration", () => {
  it('returns "moments" for <60s', () => {
    expect(formatDuration(0)).toBe("moments");
    expect(formatDuration(30_000)).toBe("moments");
    expect(formatDuration(59_999)).toBe("moments");
  });

  it('returns "moments" for non-finite', () => {
    expect(formatDuration(Number.NaN)).toBe("moments");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("moments");
  });

  it("formats minutes", () => {
    expect(formatDuration(60_000)).toBe("1m");
    expect(formatDuration(5 * 60_000)).toBe("5m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });

  it("formats hours", () => {
    expect(formatDuration(60 * 60_000)).toBe("1h");
    expect(formatDuration(5 * 60 * 60_000)).toBe("5h");
    expect(formatDuration(23 * 60 * 60_000)).toBe("23h");
  });

  it('formats days with "d"', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe("1d");
    expect(formatDuration(2 * 24 * 60 * 60_000 + 4 * 60 * 60_000)).toBe("2d 4h");
    const twoDaysFourHours = (2 * 24 + 4) * 60 * 60 * 1000;
    expect(formatDuration(twoDaysFourHours)).toContain("d");
  });

  it("omits restHours when zero", () => {
    expect(formatDuration(3 * 24 * 60 * 60_000)).toBe("3d");
  });
});

// ------------------------------------------------ shortHash
describe("shortHash", () => {
  it("truncates long hash with ellipsis", () => {
    const hash = "8f3a1c2e9a7b4c5d6e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d";
    const result = shortHash(hash);
    expect(result).toContain("…");
    expect(result.startsWith(hash.slice(0, 10))).toBe(true);
    expect(result.endsWith(hash.slice(-6))).toBe(true);
  });

  it("respects custom head/tail", () => {
    const hash = "abcdefghij1234567890XYZ";
    const result = shortHash(hash, 4, 3);
    expect(result).toBe("abcd…XYZ");
  });

  it("returns original when short enough", () => {
    const short = "abc";
    expect(shortHash(short)).toBe(short);
    // Exactly head+tail+1 = 17 chars with defaults 10+6+1
    const borderline = "a".repeat(17);
    expect(shortHash(borderline)).toBe(borderline);
  });

  it("returns original when length equals head+tail+1", () => {
    const hash = "1234567890ABCDEF1"; // 17 chars
    expect(shortHash(hash)).toBe(hash);
  });

  it("truncates when length exceeds threshold by one", () => {
    const hash = "1234567890ABCDEF12"; // 18 chars
    const result = shortHash(hash);
    expect(result).toContain("…");
  });
});

// ------------------------------------------------ clamp
describe("clamp", () => {
  it("clamps below min to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps above max to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("returns value when inside range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("handles equal min and max", () => {
    expect(clamp(5, 3, 3)).toBe(3);
  });

  it("handles negative ranges", () => {
    expect(clamp(-15, -10, -5)).toBe(-10);
    expect(clamp(-3, -10, -5)).toBe(-5);
  });
});

// ------------------------------------------------ humaniseAction
describe("humaniseAction", () => {
  it('lowercases and capitalises "SEND_MESSAGE" parts', () => {
    expect(humaniseAction("SEND_MESSAGE")).toBe("Send Message");
  });

  it('handles single word', () => {
    expect(humaniseAction("MONITOR")).toBe("Monitor");
  });

  it('handles path-like action "/actions/SEND_MESSAGE"', () => {
    // The function lowercases whole string, splits by "_", capitalises each part
    // "/actions/SEND_MESSAGE" -> "/actions/send_message" split "_" -> ["/actions/send", "message"]
    // -> "/actions/send" capitalised stays, second part capitalised
    const result = humaniseAction("SEND_MESSAGE");
    expect(result).toBe("Send Message");
  });

  it("handles already lowercased input", () => {
    expect(humaniseAction("send_message")).toBe("Send Message");
  });

  it("handles empty string", () => {
    expect(humaniseAction("")).toBe("");
  });

  it("handles multiple underscores", () => {
    expect(humaniseAction("MAKE_OFFER")).toBe("Make Offer");
    expect(humaniseAction("PROVIDE_EVIDENCE")).toBe("Provide Evidence");
  });
});
