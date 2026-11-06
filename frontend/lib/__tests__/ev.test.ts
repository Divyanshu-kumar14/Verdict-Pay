import { describe, expect, it } from "vitest";

import {
  bestEvPath,
  evPathValue,
  evRatioState,
  feeComponents,
  fightEvNote,
  highVolumeRuleNote,
  offerEvNote,
  ratioExplain,
  ratioRelationNote,
  ratioVerdict,
  settleEvNote,
  thresholdLabel,
} from "../ev";
import type { EvBreakdown } from "../types";

function makeBreakdown(overrides: Partial<EvBreakdown> = {}): EvBreakdown {
  return {
    amount_usd: 100,
    high_volume: false,
    high_volume_fee_usd: 10,
    standard_fee_usd: 20,
    penalty_ratio_usd: 5,
    ratio_before: 0.01,
    ratio_after: 0.02,
    ratio_threshold: 0.015,
    ratio_relation: "below",
    threshold_crossed_now: false,
    high_volume_min_sales: 100,
    sales_3mo: 400,
    disputes_3mo: 8,
    crosses_cliff: false,
    p_win: 0.6,
    offer_ratio: 0.5,
    ev_fight_usd: 30,
    ev_settle_usd: 20,
    ev_offer_usd: 10,
    best_action: "PROVIDE_EVIDENCE",
    formula_notes: [],
    ...overrides,
  };
}

// ------------------------------------------------ bestEvPath
describe("bestEvPath", () => {
  it("prefers fight when fight >= settle >= offer (tie-breaking)", () => {
    const bd = makeBreakdown({ ev_fight_usd: 30, ev_settle_usd: 20, ev_offer_usd: 10 });
    expect(bestEvPath(bd)).toBe("fight");
  });

  it("returns fight on three-way tie", () => {
    const bd = makeBreakdown({ ev_fight_usd: 10, ev_settle_usd: 10, ev_offer_usd: 10 });
    expect(bestEvPath(bd)).toBe("fight");
  });

  it("returns fight when fight == settle > offer", () => {
    const bd = makeBreakdown({ ev_fight_usd: 20, ev_settle_usd: 20, ev_offer_usd: 10 });
    expect(bestEvPath(bd)).toBe("fight");
  });

  it("returns fight when fight == offer > settle (still fight first)", () => {
    const bd = makeBreakdown({ ev_fight_usd: 20, ev_settle_usd: 10, ev_offer_usd: 20 });
    expect(bestEvPath(bd)).toBe("fight");
  });

  it("prefers settle when settle >= offer and settle > fight", () => {
    const bd = makeBreakdown({ ev_fight_usd: 10, ev_settle_usd: 30, ev_offer_usd: 20 });
    expect(bestEvPath(bd)).toBe("settle");
  });

  it("returns settle on settle == offer > fight", () => {
    const bd = makeBreakdown({ ev_fight_usd: 5, ev_settle_usd: 15, ev_offer_usd: 15 });
    expect(bestEvPath(bd)).toBe("settle");
  });

  it("returns offer when offer is strictly greatest", () => {
    const bd = makeBreakdown({ ev_fight_usd: 5, ev_settle_usd: 10, ev_offer_usd: 20 });
    expect(bestEvPath(bd)).toBe("offer");
  });

  it("returns settle when settle is greatest and offer lower", () => {
    const bd = makeBreakdown({ ev_fight_usd: -10, ev_settle_usd: 0, ev_offer_usd: -5 });
    expect(bestEvPath(bd)).toBe("settle");
  });
});

// ------------------------------------------------ evPathValue
describe("evPathValue", () => {
  it("returns correct breakdown field for fight", () => {
    const bd = makeBreakdown({ ev_fight_usd: 111, ev_settle_usd: 222, ev_offer_usd: 333 });
    expect(evPathValue(bd, "fight")).toBe(111);
  });

  it("returns correct field for settle", () => {
    const bd = makeBreakdown({ ev_fight_usd: 111, ev_settle_usd: 222, ev_offer_usd: 333 });
    expect(evPathValue(bd, "settle")).toBe(222);
  });

  it("returns correct field for offer", () => {
    const bd = makeBreakdown({ ev_fight_usd: 111, ev_settle_usd: 222, ev_offer_usd: 333 });
    expect(evPathValue(bd, "offer")).toBe(333);
  });
});

// ------------------------------------------------ fightEvNote
describe("fightEvNote", () => {
  it("contains win and loss substrings", () => {
    const bd = makeBreakdown();
    const note = fightEvNote(bd);
    expect(note).toContain("win");
    expect(note).toContain("loss");
  });

  it("contains formatted USD values and no NaN", () => {
    const bd = makeBreakdown({
      amount_usd: 100,
      high_volume: false,
      high_volume_fee_usd: 10,
      standard_fee_usd: 20,
      penalty_ratio_usd: 5,
      crosses_cliff: false,
    });
    const note = fightEvNote(bd);
    expect(note).not.toContain("NaN");
    expect(note).not.toContain("undefined");
    // win is -highVolumeFee (0 when not high_volume) => $0.00
    expect(note).toContain("$0.00");
  });

  it("includes high_volume fee when high_volume true", () => {
    const bd = makeBreakdown({ high_volume: true, high_volume_fee_usd: 15 });
    const note = fightEvNote(bd);
    expect(note).toContain("-$15.00");
    expect(note).not.toContain("NaN");
  });

  it("includes cliff annotation when crosses_cliff true", () => {
    const bd = makeBreakdown({ crosses_cliff: true, penalty_ratio_usd: 12.5 });
    const note = fightEvNote(bd);
    expect(note).toContain("cliff");
    expect(note).toContain("$12.50");
  });

  it("omits cliff annotation when crosses_cliff false", () => {
    const bd = makeBreakdown({ crosses_cliff: false });
    const note = fightEvNote(bd);
    expect(note).not.toContain("cliff");
  });

  it("never contains NaN even with zero values", () => {
    const bd = makeBreakdown({
      amount_usd: 0,
      high_volume: false,
      high_volume_fee_usd: 0,
      standard_fee_usd: 0,
      penalty_ratio_usd: 0,
      crosses_cliff: false,
    });
    expect(fightEvNote(bd)).not.toContain("NaN");
  });
});

// ------------------------------------------------ settleEvNote
describe("settleEvNote", () => {
  it("returns principal only for INQUIRY stage", () => {
    const bd = makeBreakdown({ standard_fee_usd: 20 });
    const note = settleEvNote(bd, "INQUIRY");
    expect(note).toContain("principal only");
    expect(note).toContain("no claim fee yet");
    expect(note).not.toContain("NaN");
  });

  it("returns principal + claim fee for CHARGEBACK", () => {
    const bd = makeBreakdown({ standard_fee_usd: 20 });
    const note = settleEvNote(bd, "CHARGEBACK");
    expect(note).toContain("principal");
    expect(note).toContain("$20.00");
    expect(note).toContain("claim fee");
  });

  it("returns claim fee for PRE_ARBITRATION and others", () => {
    const bd = makeBreakdown({ standard_fee_usd: 15 });
    expect(settleEvNote(bd, "PRE_ARBITRATION")).toContain("$15.00");
    expect(settleEvNote(bd, "RESOLVED")).toContain("$15.00");
    expect(settleEvNote(bd, "CLOSED")).toContain("$15.00");
  });

  it("never contains NaN", () => {
    const bd = makeBreakdown({ standard_fee_usd: 0 });
    expect(settleEvNote(bd, "INQUIRY")).not.toContain("NaN");
    expect(settleEvNote(bd, "CHARGEBACK")).not.toContain("NaN");
  });
});

// ------------------------------------------------ offerEvNote
describe("offerEvNote", () => {
  it("contains formatted percent and amount", () => {
    const bd = makeBreakdown({ offer_ratio: 0.5, amount_usd: 100 });
    const note = offerEvNote(bd);
    expect(note).toContain("50%");
    expect(note).toContain("$100.00");
    expect(note).toContain("claim");
  });

  it("formats offer_ratio with 0 digits", () => {
    const bd = makeBreakdown({ offer_ratio: 0.333, amount_usd: 200 });
    const note = offerEvNote(bd);
    expect(note).toContain("33%");
  });

  it("never contains NaN", () => {
    const bd = makeBreakdown({ offer_ratio: 0, amount_usd: 0 });
    expect(offerEvNote(bd)).not.toContain("NaN");
    const bd2 = makeBreakdown({ offer_ratio: 0.5, amount_usd: 100 });
    expect(offerEvNote(bd2)).not.toContain("NaN");
  });
});

// ------------------------------------------------ feeComponents
describe("feeComponents", () => {
  it("returns 4 components", () => {
    const bd = makeBreakdown();
    const comps = feeComponents(bd, "INQUIRY");
    expect(comps).toHaveLength(4);
  });

  it("has expected labels in order", () => {
    const bd = makeBreakdown();
    const comps = feeComponents(bd, "CHARGEBACK");
    expect(comps.map((c) => c.label)).toEqual([
      "Standard fee",
      "High-volume fee",
      "Cliff penalty",
      "Offer ratio",
    ]);
  });

  it("high_volume true affects notes", () => {
    const bdTrue = makeBreakdown({ high_volume: true, high_volume_fee_usd: 10 });
    const compsTrue = feeComponents(bdTrue, "INQUIRY");
    expect(compsTrue[1]?.note).toBe("never refunded");

    const bdFalse = makeBreakdown({ high_volume: false, high_volume_fee_usd: 10 });
    const compsFalse = feeComponents(bdFalse, "INQUIRY");
    expect(compsFalse[1]?.note).toBe("not applied");
  });

  it("names the crossing state from the payload's own threshold", () => {
    const bdCross = makeBreakdown({
      crosses_cliff: true,
      threshold_crossed_now: true,
      ratio_relation: "at_or_above",
      penalty_ratio_usd: 5,
      ratio_threshold: 0.015,
    });
    const comps = feeComponents(bdCross, "INQUIRY");
    expect(comps[2]?.note).toBe("this dispute crosses 1.50%");
  });

  it("names the below state without claiming a crossing", () => {
    const bdNo = makeBreakdown({ crosses_cliff: false, ratio_relation: "below" });
    const comps2 = feeComponents(bdNo, "INQUIRY");
    expect(comps2[2]?.note).toBe("below 1.50%");
  });

  it("never says 'below' for a merchant already at or above the line", () => {
    const bd = makeBreakdown({
      crosses_cliff: false,
      threshold_crossed_now: false,
      ratio_relation: "at_or_above",
      ratio_before: 0.03,
      ratio_after: 0.031,
      ratio_threshold: 0.015,
    });
    const note = feeComponents(bd, "CHARGEBACK")[2]?.note ?? "";
    expect(note).toBe("already above 1.50%");
    expect(note).not.toContain("below");
  });

  it("stage INQUIRY affects offer ratio note", () => {
    const bd = makeBreakdown();
    expect(feeComponents(bd, "INQUIRY")[3]?.note).toBe("no claim fee yet");
    expect(feeComponents(bd, "CHARGEBACK")[3]?.note).toBe("claim fee attached");
  });

  it("values are formatted (no NaN)", () => {
    const bd = makeBreakdown({
      standard_fee_usd: 20,
      high_volume_fee_usd: 10,
      penalty_ratio_usd: 5,
      offer_ratio: 0.5,
    });
    const comps = feeComponents(bd, "CHARGEBACK");
    for (const c of comps) {
      expect(c.value).not.toContain("NaN");
      expect(c.value.length).toBeGreaterThan(0);
    }
    expect(comps[0]?.value).toBe("$20.00");
    expect(comps[1]?.value).toBe("$10.00");
    expect(comps[2]?.value).toBe("$5.00");
    expect(comps[3]?.value).toBe("50%");
  });

  it("standard fee note is always refunded on a win", () => {
    const bd = makeBreakdown();
    expect(feeComponents(bd, "INQUIRY")[0]?.note).toBe("refunded on a win");
    expect(feeComponents(bd, "CHARGEBACK")[0]?.note).toBe("refunded on a win");
  });
});

// ------------------------------------------------ threshold truthfulness (Job A)
/**
 * The live defect: a merchant at 3.00% was described as "below the 1.50% line".
 * `ratio_relation` is the backend's authoritative word, so every string below is
 * derived from it. These cases pin all three states and the exact regression.
 */
describe("evRatioState", () => {
  it("returns below when the relation is below and nothing crossed", () => {
    const bd = makeBreakdown({ ratio_relation: "below", threshold_crossed_now: false });
    expect(evRatioState(bd)).toBe("below");
  });

  it("returns crossing when this dispute pushes the ratio over the line", () => {
    const bd = makeBreakdown({
      ratio_relation: "at_or_above",
      threshold_crossed_now: true,
      crosses_cliff: true,
    });
    expect(evRatioState(bd)).toBe("crossing");
  });

  it("returns above when the merchant was already over the line", () => {
    const bd = makeBreakdown({
      ratio_relation: "at_or_above",
      threshold_crossed_now: false,
      crosses_cliff: false,
    });
    expect(evRatioState(bd)).toBe("above");
  });

  it("trusts threshold_crossed_now over crosses_cliff when only one is set", () => {
    const crossed = makeBreakdown({ threshold_crossed_now: true, crosses_cliff: false });
    expect(evRatioState(crossed)).toBe("crossing");
    const notCrossed = makeBreakdown({
      threshold_crossed_now: false,
      crosses_cliff: false,
      ratio_relation: "at_or_above",
    });
    expect(evRatioState(notCrossed)).toBe("above");
  });
});

describe("thresholdLabel", () => {
  it("renders the payload threshold, not a literal", () => {
    expect(thresholdLabel(makeBreakdown({ ratio_threshold: 0.015 }))).toBe("1.50%");
    expect(thresholdLabel(makeBreakdown({ ratio_threshold: 0.01 }))).toBe("1.00%");
    expect(thresholdLabel(makeBreakdown({ ratio_threshold: 0.025 }))).toBe("2.50%");
  });
});

describe("ratioExplain", () => {
  it("describes the crossing state with the real threshold and the penalty", () => {
    const bd = makeBreakdown({
      ratio_before: 0.0145,
      ratio_after: 0.0155,
      ratio_threshold: 0.015,
      ratio_relation: "at_or_above",
      threshold_crossed_now: true,
      crosses_cliff: true,
      penalty_ratio_usd: 25,
    });
    const text = ratioExplain(bd);
    expect(text).toContain("crossing");
    expect(text).toContain("1.50%");
    expect(text).toContain("$25.00");
    expect(text).toContain("lands on the fight path");
  });

  it("describes the below state and denies any penalty", () => {
    const bd = makeBreakdown({
      ratio_before: 0.005,
      ratio_after: 0.006,
      ratio_threshold: 0.015,
      ratio_relation: "below",
      threshold_crossed_now: false,
      crosses_cliff: false,
      penalty_ratio_usd: 0,
    });
    const text = ratioExplain(bd);
    expect(text).toContain("staying below");
    expect(text).toContain("1.50%");
    expect(text).toContain("No cliff penalty");
  });

  it("REGRESSION: 3.00% vs 1.50% never says 'below' when the merchant is above", () => {
    const bd = makeBreakdown({
      ratio_before: 0.03,
      ratio_after: 0.0302,
      ratio_threshold: 0.015,
      ratio_relation: "at_or_above",
      threshold_crossed_now: false,
      crosses_cliff: false,
      penalty_ratio_usd: 0,
    });
    const text = ratioExplain(bd);
    // The defect sentence was "3.00% ... below the 1.5% line".
    expect(text).not.toMatch(/below/i);
    expect(text).toContain("already at or above");
    expect(text).toContain("3.00%");
    expect(text).toContain("1.50%");
    expect(text).toContain("no new cliff penalty");
  });

  it("renders a non-default threshold from the payload", () => {
    const bd = makeBreakdown({
      ratio_threshold: 0.02,
      ratio_relation: "below",
      threshold_crossed_now: false,
      crosses_cliff: false,
    });
    expect(ratioExplain(bd)).toContain("2.00%");
  });
});

describe("ratioRelationNote and ratioVerdict", () => {
  it("keeps relation wording truthful in all three states", () => {
    const below = makeBreakdown({ ratio_relation: "below", threshold_crossed_now: false });
    const crossing = makeBreakdown({
      ratio_relation: "at_or_above",
      threshold_crossed_now: true,
      crosses_cliff: true,
    });
    const above = makeBreakdown({ ratio_relation: "at_or_above", threshold_crossed_now: false });

    expect(ratioRelationNote(below)).toBe("below 1.50%");
    expect(ratioRelationNote(crossing)).toBe("this dispute crosses 1.50%");
    expect(ratioRelationNote(above)).toBe("already above 1.50%");

    expect(ratioVerdict(below)).toBe("Below 1.50%");
    expect(ratioVerdict(crossing)).toBe("Crosses 1.50% now");
    expect(ratioVerdict(above)).toBe("Already above 1.50%");
  });

  it("REGRESSION: an at_or_above verdict never contains 'below' in any helper", () => {
    const above = makeBreakdown({
      ratio_relation: "at_or_above",
      threshold_crossed_now: false,
      crosses_cliff: false,
      ratio_before: 0.03,
      ratio_after: 0.03,
    });
    for (const text of [
      ratioExplain(above),
      ratioRelationNote(above),
      ratioVerdict(above),
      ...feeComponents(above, "CHARGEBACK").map((c) => c.note),
    ]) {
      expect(text.toLowerCase()).not.toContain("below");
    }
  });
});

describe("highVolumeRuleNote", () => {
  it("states the ratio and the sales gate from the payload", () => {
    const bd = makeBreakdown({ ratio_threshold: 0.015, high_volume_min_sales: 100 });
    const text = highVolumeRuleNote(bd);
    expect(text).toContain("1.50%");
    expect(text).toContain("100+");
    expect(text).not.toContain("NaN");
  });
});
