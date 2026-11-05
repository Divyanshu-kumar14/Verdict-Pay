/**
 * Judge flow over real HTTP: the three sandbox buttons in order, exactly as the
 * UI calls them (see docs/demo.md and CommandCenter).
 *
 * Steps share ids through sequential awaits; no step runs before the ids it
 * needs exist. Each sandbox call mints fresh rows, so assertions use the demo
 * numbers, never hardcoded ids. Transport lives in ./support.
 */
import { describe, expect, it } from "vitest";

import type { DisputeAction, RecommendedAction } from "../lib/types";
import {
  CheckoutResponseSchema,
  DisputeDetailSchema,
  DisputeSimulationResponseSchema,
  UsageResponseSchema,
} from "../lib/types";
import { callJson } from "./support";

/** Triage recommendation to the executable rail action (mirrors backend e2e_demo.py). */
const EXECUTABLE_ACTION: Record<RecommendedAction, DisputeAction> = {
  DEFLECT_INQUIRY: "SEND_MESSAGE",
  MAKE_OFFER: "MAKE_OFFER",
  ACCEPT_CLAIM: "ACCEPT_CLAIM",
  PROVIDE_EVIDENCE: "ACCEPT_CLAIM",
  MONITOR: "SEND_MESSAGE",
};

describe("judge-flow", () => {
  let payerId = "";
  let orderId = "";
  let subscriptionId = "";
  let disputeId = "";

  it("1 - checks out the $99 Pro plan", async () => {
    const res = await callJson("/api/v1/sandbox/checkout", {
      method: "POST",
      body: { plan: "pro" },
    });

    expect(res.status).toBe(200);
    const checkout = CheckoutResponseSchema.parse(res.payload);
    expect(Number(checkout.amount_usd)).toBe(99);
    expect(checkout.order_id.length).toBeGreaterThan(0);
    const subscription = checkout.subscription_id;
    if (subscription === null || subscription.length === 0) {
      throw new Error("Checkout returned no subscription id.");
    }
    payerId = checkout.payer_id;
    orderId = checkout.order_id;
    subscriptionId = subscription;
  });

  it("2 - records four chained telemetry events", async () => {
    const res = await callJson("/api/v1/sandbox/usage", {
      method: "POST",
      body: {
        payer_id: payerId,
        order_id: orderId,
        subscription_id: subscriptionId,
        logins: 15,
        tokens: 42000,
        export_name: "q3_financial_model.xlsx",
      },
    });

    expect(res.status).toBe(200);
    const usage = UsageResponseSchema.parse(res.payload);
    expect(usage.events).toHaveLength(4);
    expect(usage.chain.valid).toBe(true);
    expect(usage.totals["tokens"]).toBe(42000);
    expect(usage.totals["logins"]).toBe(15);
  });

  it("3 - files a SNAD inquiry and contains it", async () => {
    const res = await callJson("/api/v1/sandbox/dispute", {
      method: "POST",
      body: {
        payer_id: payerId,
        order_id: orderId,
        reason_code: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
        stage: "INQUIRY",
        channel: "INTERNAL",
        amount_usd: "99.00",
      },
    });

    expect(res.status).toBe(200);
    const simulation = DisputeSimulationResponseSchema.parse(res.payload);
    expect(simulation.dispute.stage).toBe("INQUIRY");
    expect(simulation.dispute.subscription_suspended).toBe(true);
    expect("attempted" in simulation.containment).toBe(true);
    expect("suspended" in simulation.containment).toBe(true);
    expect("latency_ms" in simulation.containment).toBe(true);
    expect(["DEFLECT_INQUIRY", "MAKE_OFFER", "ACCEPT_CLAIM"]).toContain(
      simulation.dispute.recommended_action,
    );
    disputeId = simulation.dispute.dispute_id;
  });

  it("4 - exposes the recommended action on the rail", async () => {
    if (disputeId.length === 0) {
      throw new Error("Judge flow broke order: the dispute step must run first.");
    }
    const res = await callJson(`/api/v1/disputes/${encodeURIComponent(disputeId)}`);

    expect(res.status).toBe(200);
    const detail = DisputeDetailSchema.parse(res.payload);
    // DEFLECT_INQUIRY is a triage-level recommendation; its executable rail
    // entry is SEND_MESSAGE, per the mapping in backend/scripts/e2e_demo.py.
    const runnable = detail.allowed_actions.find(
      (entry) => entry.action === EXECUTABLE_ACTION[detail.recommended_action],
    );
    if (runnable === undefined) {
      throw new Error(
        `Recommendation ${detail.recommended_action} has no entry on the action rail.`,
      );
    }
    expect(runnable.allowed).toBe(true);
  });
});
