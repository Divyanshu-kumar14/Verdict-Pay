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

const TONES: Tone[] = ["positive", "warning", "negative", "accent", "neutral"];
const TONE_MAPS = { TONE_TEXT, TONE_BADGE, TONE_DOT, TONE_BAR } as const;

// ------------------------------------------------ Tone maps
describe("TONE_* maps", () => {
  it("every map covers exactly the five dealt tones", () => {
    for (const map of Object.values(TONE_MAPS)) {
      expect(Object.keys(map)).toHaveLength(5);
      for (const tone of TONES) {
        expect(map[tone]).toBeDefined();
        expect(typeof map[tone]).toBe("string");
        expect(map[tone].length).toBeGreaterThan(0);
      }
    }
  });

  it("TONE_TEXT carries a text- class per tone", () => {
    expect(TONE_TEXT.positive).toBe("text-positive");
    expect(TONE_TEXT.warning).toBe("text-warning");
    expect(TONE_TEXT.negative).toBe("text-negative");
    expect(TONE_TEXT.accent).toBe("text-accent");
    expect(TONE_TEXT.neutral).toBe("text-muted");
  });

  it("TONE_BADGE is a tinted ground with readable ink, never a hue utility", () => {
    for (const tone of TONES) {
      expect(TONE_BADGE[tone]).toContain("bg-pill-");
      expect(TONE_BADGE[tone]).toContain("text-pill-");
      expect(TONE_BADGE[tone]).not.toContain("border-");
    }
    expect(TONE_BADGE.positive).toBe("bg-pill-positive text-pill-positive-ink");
    expect(TONE_BADGE.neutral).toBe("bg-pill-neutral text-pill-neutral-ink");
  });

  it("TONE_DOT and TONE_BAR carry a bg- class per tone", () => {
    for (const tone of TONES) {
      expect(TONE_DOT[tone]).toContain("bg-");
      expect(TONE_BAR[tone]).toContain("bg-");
    }
    expect(TONE_DOT.neutral).toBe("bg-muted");
    // Neutral bars read as a chart mark, not as a status hue.
    expect(TONE_BAR.neutral).toBe("bg-chart-1");
  });

  it("no tone class string smuggles in uppercase or letter-spacing", () => {
    for (const map of Object.values(TONE_MAPS)) {
      for (const value of Object.values(map)) {
        expect(value).toBe(value.toLowerCase());
        expect(value).not.toContain("tracking-");
      }
    }
  });
});

// ------------------------------------------------ REASON_META
describe("REASON_META", () => {
  it("has all 4 reasons with a sentence-case short, a label and a tone", () => {
    expect(Object.keys(REASON_META)).toHaveLength(4);
    expect(REASON_META.MERCHANDISE_OR_SERVICE_NOT_RECEIVED).toEqual({
      short: "Not received",
      label: "Item not received",
      tone: "warning",
    });
    expect(REASON_META.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED).toEqual({
      short: "Not as described",
      label: "Item not as described",
      tone: "negative",
    });
    expect(REASON_META.UNAUTHORIZED).toEqual({
      short: "Unauthorized",
      label: "Unauthorized payment",
      tone: "negative",
    });
    expect(REASON_META.OTHER).toEqual({ short: "Other", label: "Other reason", tone: "neutral" });
  });

  it("every reason meta has required fields on the dealt tone list", () => {
    for (const meta of Object.values(REASON_META)) {
      expect(typeof meta.short).toBe("string");
      expect(typeof meta.label).toBe("string");
      expect(TONES).toContain(meta.tone);
    }
  });
});

// ------------------------------------------------ STAGE_META
describe("STAGE_META", () => {
  it("has all 6 stages", () => {
    expect(Object.keys(STAGE_META)).toHaveLength(6);
  });

  it("contains expected short/label/tone for each stage", () => {
    expect(STAGE_META.INQUIRY).toEqual({ short: "Inquiry", label: "Inquiry", tone: "warning" });
    expect(STAGE_META.CHARGEBACK).toEqual({
      short: "Chargeback",
      label: "Chargeback",
      tone: "negative",
    });
    expect(STAGE_META.PRE_ARBITRATION).toEqual({
      short: "Pre-arbitration",
      label: "Pre-arbitration",
      tone: "negative",
    });
    expect(STAGE_META.RESOLVED).toEqual({ short: "Resolved", label: "Resolved", tone: "positive" });
    expect(STAGE_META.CLOSED).toEqual({ short: "Closed", label: "Closed", tone: "neutral" });
  });
});

// ------------------------------------------------ CHANNEL_META
describe("CHANNEL_META", () => {
  it("has INTERNAL and EXTERNAL", () => {
    expect(Object.keys(CHANNEL_META)).toHaveLength(2);
    expect(CHANNEL_META.INTERNAL).toEqual({
      short: "PayPal",
      label: "PayPal channel",
      tone: "neutral",
    });
    expect(CHANNEL_META.EXTERNAL).toEqual({
      short: "Card / bank",
      label: "Card or bank channel",
      tone: "accent",
    });
  });
});

// ------------------------------------------------ STATUS_META
describe("STATUS_META", () => {
  it("has all 5 statuses", () => {
    expect(Object.keys(STATUS_META)).toHaveLength(5);
  });

  it("contains expected entries", () => {
    expect(STATUS_META.OPEN).toEqual({ short: "Open", label: "Open", tone: "accent" });
    expect(STATUS_META.WAITING_FOR_SELLER_RESPONSE).toEqual({
      short: "Awaiting reply",
      label: "Waiting for seller response",
      tone: "warning",
    });
    expect(STATUS_META.UNDER_REVIEW).toEqual({
      short: "Under review",
      label: "Under review",
      tone: "accent",
    });
    expect(STATUS_META.RESOLVED).toEqual({ short: "Resolved", label: "Resolved", tone: "positive" });
    expect(STATUS_META.CLOSED).toEqual({ short: "Closed", label: "Closed", tone: "neutral" });
  });
});

// ------------------------------------------------ RECOMMENDATION_META
describe("RECOMMENDATION_META", () => {
  it("has all 5 recommendations", () => {
    expect(Object.keys(RECOMMENDATION_META)).toHaveLength(5);
  });

  it("contains expected mapping for each recommendation", () => {
    expect(RECOMMENDATION_META.DEFLECT_INQUIRY).toEqual({
      short: "Deflect",
      label: "Deflect inquiry",
      tone: "warning",
      action: "SEND_MESSAGE",
      verb: "Deflect inquiry",
    });
    expect(RECOMMENDATION_META.MAKE_OFFER).toEqual({
      short: "Offer",
      label: "Make offer",
      tone: "accent",
      action: "MAKE_OFFER",
      verb: "Make offer",
    });
    expect(RECOMMENDATION_META.ACCEPT_CLAIM).toEqual({
      short: "Accept",
      label: "Accept claim",
      tone: "negative",
      action: "ACCEPT_CLAIM",
      verb: "Accept claim",
    });
    expect(RECOMMENDATION_META.PROVIDE_EVIDENCE).toEqual({
      short: "Evidence",
      label: "Provide evidence",
      tone: "positive",
      action: "PROVIDE_EVIDENCE",
      verb: "Provide evidence",
    });
    expect(RECOMMENDATION_META.MONITOR).toEqual({
      short: "Monitor",
      label: "Monitor",
      tone: "neutral",
      action: null,
      verb: "Monitor only",
    });
  });

  it("every recommendation has short/label/tone/verb on the dealt tone list", () => {
    for (const meta of Object.values(RECOMMENDATION_META)) {
      expect(typeof meta.short).toBe("string");
      expect(typeof meta.label).toBe("string");
      expect(typeof meta.verb).toBe("string");
      expect(TONES).toContain(meta.tone);
    }
  });
});

// ------------------------------------------------ ACTION_META
describe("ACTION_META", () => {
  it("has all 6 actions", () => {
    expect(Object.keys(ACTION_META)).toHaveLength(6);
  });

  it("contains expected labels and descriptions", () => {
    expect(ACTION_META.SEND_MESSAGE.label).toBe("Send message");
    expect(ACTION_META.SEND_MESSAGE.tone).toBe("warning");
    expect(ACTION_META.SEND_MESSAGE.description).toContain("resolution centre");

    expect(ACTION_META.MAKE_OFFER.label).toBe("Make offer");
    expect(ACTION_META.MAKE_OFFER.tone).toBe("accent");

    expect(ACTION_META.ACCEPT_CLAIM.label).toBe("Accept claim");
    expect(ACTION_META.ACCEPT_CLAIM.tone).toBe("negative");

    expect(ACTION_META.PROVIDE_EVIDENCE.label).toBe("Provide evidence");
    expect(ACTION_META.PROVIDE_EVIDENCE.tone).toBe("positive");
    expect(ACTION_META.PROVIDE_EVIDENCE.description).toContain("dossier");
  });
});

// ------------------------------------------------ EVENT_META
describe("EVENT_META", () => {
  it("has all 4 event types", () => {
    expect(Object.keys(EVENT_META)).toHaveLength(4);
  });

  it("contains expected short/label for each event", () => {
    expect(EVENT_META.TOS_ACCEPTED).toEqual({ short: "Terms", label: "Terms accepted" });
    expect(EVENT_META.SESSION_AUTH).toEqual({ short: "Session", label: "Session authenticated" });
    expect(EVENT_META.ASSET_DELIVERED).toEqual({ short: "Delivery", label: "Asset delivered" });
    expect(EVENT_META.USAGE_METERED).toEqual({ short: "Usage", label: "Metered usage" });
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
