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
  PROVIDE_EVIDENCE: "PROVIDE_EVIDENCE",
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
    // A real PayPal order is created, not paid, and carries no subscription.
    expect(checkout.approval_url).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);
    payerId = checkout.payer_id;
    orderId = checkout.order_id;
    subscriptionId = checkout.subscription_id ?? "";
  });

  it("2 - records four chained telemetry events", async () => {
    const res = await callJson("/api/v1/sandbox/usage", {
      method: "POST",
      body: {
        payer_id: payerId,
        order_id: orderId,
        ...(subscriptionId ? { subscription_id: subscriptionId } : {}),
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

  it("3 - opens a dispute on the order", async () => {
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
    const opened = DisputeSimulationResponseSchema.parse(res.payload);
    // PayPal created it, or the demo built it locally and says so.
    expect(["paypal_sandbox", "internal_test_event"]).toContain(opened.origin);
    expect(opened.dispute.order_id).toBe(orderId);
    expect(opened.dispute.stage).toBe("INQUIRY");
    disputeId = opened.dispute.dispute_id;
  });

  it("4 - exposes the recommended action on the rail", async () => {
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
