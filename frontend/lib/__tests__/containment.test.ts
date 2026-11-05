import { describe, expect, it } from "vitest";

import { ContainmentSchema, describeContainment, parseContainment } from "../containment";
import type { Containment } from "../containment";

// ------------------------------------------------ parseContainment
describe("parseContainment", () => {
  it("parses valid full dict", () => {
    const raw = {
      attempted: true,
      suspended: true,
      latency_ms: 42,
      subscription_id: "sub_123",
      error: null,
    };
    const result = parseContainment(raw);
    expect(result).toEqual(raw);
  });

  it("applies defaults for empty object", () => {
    const result = parseContainment({});
    expect(result).toEqual({
      attempted: false,
      suspended: false,
      latency_ms: 0,
      subscription_id: null,
      error: null,
    });
  });

  it("ignores unknown keys", () => {
    const raw = {
      attempted: true,
      suspended: false,
      latency_ms: 10,
      subscription_id: "sub_1",
      error: null,
      unknown_extra: "should be ignored",
      another: 123,
    };
    const result = parseContainment(raw);
    expect(result).toEqual({
      attempted: true,
      suspended: false,
      latency_ms: 10,
      subscription_id: "sub_1",
      error: null,
    });
    // ensure extra keys not present
    expect((result as Record<string, unknown>).unknown_extra).toBeUndefined();
  });

  it("returns defaults on invalid shape (wrong types)", () => {
    const raw = {
      attempted: "not-a-bool",
      suspended: false,
      latency_ms: -5, // negative not allowed
      subscription_id: "ok",
      error: null,
    };
    const result = parseContainment(raw);
    expect(result).toEqual({
      attempted: false,
      suspended: false,
      latency_ms: 0,
      subscription_id: null,
      error: null,
    });
  });

  it("parses partial dict with defaults", () => {
    const raw = { attempted: true };
    const result = parseContainment(raw);
    expect(result.attempted).toBe(true);
    expect(result.suspended).toBe(false);
    expect(result.latency_ms).toBe(0);
    expect(result.subscription_id).toBeNull();
    expect(result.error).toBeNull();
  });

  it("validates ContainmentSchema directly", () => {
    const parsed = ContainmentSchema.safeParse({
      attempted: true,
      suspended: true,
      latency_ms: 0,
      subscription_id: null,
      error: "some error",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.error).toBe("some error");
    }
  });

  it("rejects negative latency_ms via schema", () => {
    const parsed = ContainmentSchema.safeParse({ latency_ms: -1 });
    expect(parsed.success).toBe(false);
  });

  it("rejects non-integer latency_ms", () => {
    const parsed = ContainmentSchema.safeParse({ latency_ms: 1.5 });
    expect(parsed.success).toBe(false);
  });
});

// ------------------------------------------------ describeContainment
describe("describeContainment", () => {
  it("returns suspended headline when suspended true", () => {
    const containment: Containment = {
      attempted: true,
      suspended: true,
      latency_ms: 120,
      subscription_id: "sub_abc",
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.text).toBe("Subscription suspended in 120ms");
    expect(result.detail).toBe("sub_abc");
    expect(result.tone).toBe("emerald");
    expect(result.suspended).toBe(true);
  });

  it("formats <1ms for zero latency when suspended", () => {
    const containment: Containment = {
      attempted: true,
      suspended: true,
      latency_ms: 0,
      subscription_id: "sub_1",
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.text).toBe("Subscription suspended in <1ms");
    expect(result.suspended).toBe(true);
  });

  it("also handles negative-zero edge via <=0 check", () => {
    // ContainmentSchema prevents negative, but test via manual object
    const containment: Containment = {
      attempted: true,
      suspended: true,
      latency_ms: 0,
      subscription_id: null,
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.text).toContain("<1ms");
  });

  it("returns skipped when not attempted", () => {
    const containment: Containment = {
      attempted: false,
      suspended: false,
      latency_ms: 0,
      subscription_id: null,
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.text).toBe("Containment skipped (no subscription)");
    expect(result.detail).toBeNull();
    expect(result.tone).toBe("neutral");
    expect(result.suspended).toBe(false);
  });

  it("prioritises suspended over attempted/error", () => {
    const containment: Containment = {
      attempted: true,
      suspended: true,
      latency_ms: 50,
      subscription_id: "sub_x",
      error: "something failed",
    };
    const result = describeContainment(containment);
    expect(result.text).toContain("Subscription suspended");
    expect(result.tone).toBe("emerald");
  });

  it("returns failed when attempted with error", () => {
    const containment: Containment = {
      attempted: true,
      suspended: false,
      latency_ms: 10,
      subscription_id: "sub_err",
      error: "timeout",
    };
    const result = describeContainment(containment);
    expect(result.text).toBe("Containment failed: timeout");
    expect(result.detail).toBe("sub_err");
    expect(result.tone).toBe("rose");
    expect(result.suspended).toBe(false);
  });

  it("returns amber when attempted without error and not suspended", () => {
    const containment: Containment = {
      attempted: true,
      suspended: false,
      latency_ms: 10,
      subscription_id: "sub_ok",
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.text).toBe("Containment ran without suspending billing");
    expect(result.detail).toBe("sub_ok");
    expect(result.tone).toBe("amber");
    expect(result.suspended).toBe(false);
  });

  it("handles attempted with null subscription_id", () => {
    const containment: Containment = {
      attempted: true,
      suspended: false,
      latency_ms: 5,
      subscription_id: null,
      error: null,
    };
    const result = describeContainment(containment);
    expect(result.detail).toBeNull();
    expect(result.tone).toBe("amber");
  });
});
