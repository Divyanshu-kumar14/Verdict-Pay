import { describe, expect, it } from "vitest";

import {
  ACTION_META,
  CHANNEL_META,
  EVENT_META,
  REASON_META,
  RECOMMENDATION_META,
  RECOMMENDATION_ORDER,
  STAGE_META,
  STATUS_META,
  TONE_BADGE,
  TONE_BAR,
  TONE_DOT,
  TONE_TEXT,
} from "../vocab";
import type { Tone } from "../vocab";

// ------------------------------------------------ Tone maps
describe("TONE_* maps", () => {
  const tones: Tone[] = ["emerald", "amber", "rose", "sky", "neutral"];

  it("TONE_TEXT contains all tones with text- prefix", () => {
    for (const tone of tones) {
      expect(TONE_TEXT[tone]).toBeDefined();
      expect(TONE_TEXT[tone]).toContain(tone === "neutral" ? "text-muted" : `text-${tone}`);
    }
    expect(TONE_TEXT.emerald).toBe("text-emerald");
    expect(TONE_TEXT.neutral).toBe("text-muted");
  });

  it("TONE_BADGE contains border/bg/text for each tone", () => {
    for (const tone of tones) {
      const badge = TONE_BADGE[tone];
      expect(badge).toContain("border-");
      expect(badge).toContain("bg-");
      expect(badge).toContain("text-");
    }
    expect(TONE_BADGE.rose).toBe("border-rose/25 bg-rose/10 text-rose");
  });

  it("TONE_DOT contains bg- class", () => {
    for (const tone of tones) {
      expect(TONE_DOT[tone]).toContain("bg-");
    }
    expect(TONE_DOT.emerald).toBe("bg-emerald");
    expect(TONE_DOT.neutral).toBe("bg-white/30");
  });

  it("TONE_BAR contains bg- class", () => {
    for (const tone of tones) {
      expect(TONE_BAR[tone]).toContain("bg-");
    }
    expect(TONE_BAR.sky).toBe("bg-sky");
    expect(TONE_BAR.neutral).toBe("bg-white/25");
  });

  it("all TONE maps have exactly 5 entries", () => {
    expect(Object.keys(TONE_TEXT)).toHaveLength(5);
    expect(Object.keys(TONE_BADGE)).toHaveLength(5);
    expect(Object.keys(TONE_DOT)).toHaveLength(5);
    expect(Object.keys(TONE_BAR)).toHaveLength(5);
  });
});

// ------------------------------------------------ REASON_META
describe("REASON_META", () => {
  it("has all 4 reasons with short/label/tone", () => {
    expect(Object.keys(REASON_META)).toHaveLength(4);
    expect(REASON_META.MERCHANDISE_OR_SERVICE_NOT_RECEIVED).toEqual({
      short: "INR",
      label: "Item not received",
      tone: "amber",
    });
    expect(REASON_META.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED).toEqual({
      short: "SNAD",
      label: "Not as described",
      tone: "rose",
    });
    expect(REASON_META.UNAUTHORIZED).toEqual({ short: "UA", label: "Unauthorized", tone: "rose" });
    expect(REASON_META.OTHER).toEqual({ short: "OTHER", label: "Other", tone: "neutral" });
  });

  it("every reason meta has required fields", () => {
    for (const meta of Object.values(REASON_META)) {
      expect(typeof meta.short).toBe("string");
      expect(typeof meta.label).toBe("string");
      expect(["emerald", "amber", "rose", "sky", "neutral"]).toContain(meta.tone);
    }
  });
});

// ------------------------------------------------ STAGE_META
describe("STAGE_META", () => {
  it("has all 5 stages", () => {
    expect(Object.keys(STAGE_META)).toHaveLength(5);
  });

  it("contains expected short/label/tone for each stage", () => {
    expect(STAGE_META.INQUIRY).toEqual({ short: "INQUIRY", label: "Inquiry", tone: "amber" });
    expect(STAGE_META.CHARGEBACK).toEqual({ short: "CHARGEBACK", label: "Chargeback", tone: "rose" });
    expect(STAGE_META.PRE_ARBITRATION).toEqual({ short: "PRE-ARB", label: "Pre-arbitration", tone: "rose" });
    expect(STAGE_META.RESOLVED).toEqual({ short: "RESOLVED", label: "Resolved", tone: "emerald" });
    expect(STAGE_META.CLOSED).toEqual({ short: "CLOSED", label: "Closed", tone: "neutral" });
  });
});

// ------------------------------------------------ CHANNEL_META
describe("CHANNEL_META", () => {
  it("has INTERNAL and EXTERNAL", () => {
    expect(Object.keys(CHANNEL_META)).toHaveLength(2);
    expect(CHANNEL_META.INTERNAL).toEqual({
      short: "INTERNAL",
      label: "PayPal channel",
      tone: "neutral",
    });
    expect(CHANNEL_META.EXTERNAL).toEqual({
      short: "EXTERNAL",
      label: "Card / bank channel",
      tone: "sky",
    });
  });
});

// ------------------------------------------------ STATUS_META
describe("STATUS_META", () => {
  it("has all 5 statuses", () => {
    expect(Object.keys(STATUS_META)).toHaveLength(5);
  });

  it("contains expected entries", () => {
    expect(STATUS_META.OPEN).toEqual({ short: "OPEN", label: "Open", tone: "sky" });
    expect(STATUS_META.WAITING_FOR_SELLER_RESPONSE).toEqual({
      short: "AWAITING REPLY",
      label: "Waiting for seller response",
      tone: "amber",
    });
    expect(STATUS_META.UNDER_REVIEW).toEqual({
      short: "UNDER REVIEW",
      label: "Under review",
      tone: "sky",
    });
    expect(STATUS_META.RESOLVED).toEqual({ short: "RESOLVED", label: "Resolved", tone: "emerald" });
    expect(STATUS_META.CLOSED).toEqual({ short: "CLOSED", label: "Closed", tone: "neutral" });
  });
});

// ------------------------------------------------ RECOMMENDATION_META
describe("RECOMMENDATION_META", () => {
  it("has all 5 recommendations", () => {
    expect(Object.keys(RECOMMENDATION_META)).toHaveLength(5);
  });

  it("contains expected mapping for each recommendation", () => {
    expect(RECOMMENDATION_META.DEFLECT_INQUIRY).toEqual({
      short: "DEFLECT",
      label: "Deflect inquiry",
      tone: "amber",
      action: "SEND_MESSAGE",
      verb: "Deflect inquiry",
    });
    expect(RECOMMENDATION_META.MAKE_OFFER).toEqual({
      short: "OFFER",
      label: "Make offer",
      tone: "sky",
      action: "MAKE_OFFER",
      verb: "Make offer",
    });
    expect(RECOMMENDATION_META.ACCEPT_CLAIM).toEqual({
      short: "ACCEPT",
      label: "Accept claim",
      tone: "rose",
      action: "ACCEPT_CLAIM",
      verb: "Accept claim",
    });
    expect(RECOMMENDATION_META.PROVIDE_EVIDENCE).toEqual({
      short: "EVIDENCE",
      label: "Provide evidence",
      tone: "emerald",
      action: "PROVIDE_EVIDENCE",
      verb: "Provide evidence",
    });
    expect(RECOMMENDATION_META.MONITOR).toEqual({
      short: "MONITOR",
      label: "Monitor",
      tone: "neutral",
      action: null,
      verb: "Monitor only",
    });
  });

  it("every recommendation has short/label/tone/verb", () => {
    for (const meta of Object.values(RECOMMENDATION_META)) {
      expect(typeof meta.short).toBe("string");
      expect(typeof meta.label).toBe("string");
      expect(typeof meta.verb).toBe("string");
      expect(["emerald", "amber", "rose", "sky", "neutral"]).toContain(meta.tone);
    }
  });
});

// ------------------------------------------------ ACTION_META
describe("ACTION_META", () => {
  it("has all 4 actions", () => {
    expect(Object.keys(ACTION_META)).toHaveLength(4);
  });

  it("contains expected labels and descriptions", () => {
    expect(ACTION_META.SEND_MESSAGE.label).toBe("Send message");
    expect(ACTION_META.SEND_MESSAGE.tone).toBe("amber");
    expect(ACTION_META.SEND_MESSAGE.description).toContain("PayPal resolution centre");

    expect(ACTION_META.MAKE_OFFER.label).toBe("Make offer");
    expect(ACTION_META.MAKE_OFFER.tone).toBe("sky");

    expect(ACTION_META.ACCEPT_CLAIM.label).toBe("Accept claim");
    expect(ACTION_META.ACCEPT_CLAIM.tone).toBe("rose");

    expect(ACTION_META.PROVIDE_EVIDENCE.label).toBe("Provide evidence");
    expect(ACTION_META.PROVIDE_EVIDENCE.tone).toBe("emerald");
    expect(ACTION_META.PROVIDE_EVIDENCE.description).toContain("dossier");
  });
});

// ------------------------------------------------ EVENT_META
describe("EVENT_META", () => {
  it("has all 4 event types", () => {
    expect(Object.keys(EVENT_META)).toHaveLength(4);
  });

  it("contains expected short/label for each event", () => {
    expect(EVENT_META.TOS_ACCEPTED).toEqual({ short: "TOS", label: "Terms accepted" });
    expect(EVENT_META.SESSION_AUTH).toEqual({ short: "AUTH", label: "Session authenticated" });
    expect(EVENT_META.ASSET_DELIVERED).toEqual({ short: "DELIVER", label: "Asset delivered" });
    expect(EVENT_META.USAGE_METERED).toEqual({ short: "USAGE", label: "Metered usage" });
  });
});

// ------------------------------------------------ RECOMMENDATION_ORDER
describe("RECOMMENDATION_ORDER", () => {
  it("has 5 entries in expected analytics order", () => {
    expect(RECOMMENDATION_ORDER).toEqual([
      "DEFLECT_INQUIRY",
      "MAKE_OFFER",
      "PROVIDE_EVIDENCE",
      "ACCEPT_CLAIM",
      "MONITOR",
    ]);
  });

  it("contains every recommendation exactly once", () => {
    const set = new Set(RECOMMENDATION_ORDER);
    expect(set.size).toBe(5);
    for (const key of Object.keys(RECOMMENDATION_META)) {
      expect(set.has(key as (typeof RECOMMENDATION_ORDER)[number])).toBe(true);
    }
  });
});
