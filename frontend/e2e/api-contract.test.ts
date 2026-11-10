/**
 * API contract tests over real HTTP (no mocks, no browser).
 *
 * Every JSON body is validated with the frozen zod schemas from lib/types.ts,
 * so backend contract drift fails here first. Requires the demo API from
 * docs/demo.md (default http://127.0.0.1:8000, key vp_demo_sk_local).
 *
 * Transport, the one-shot health probe and the failure message live in
 * ./support so both E2E suites share one implementation.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  DisputeDetailSchema,
  DisputePageSchema,
  ErrorEnvelopeSchema,
  HealthResponseSchema,
  ReportingSummarySchema,
  TriageResponseSchema,
} from "../lib/types";
import { assertDemoApiReachable, callBinary, callJson } from "./support";

/** Fetch one INQUIRY case id from the seeded queue. */
async function findInquiryDisputeId(): Promise<string> {
  const res = await callJson("/api/v1/disputes?per_page=50");
  expect(res.status).toBe(200);
  const page = DisputePageSchema.parse(res.payload);
  const inquiry = page.data.find((item) => item.stage === "INQUIRY");
  if (inquiry === undefined) {
    throw new Error(
      "Seeded queue holds no INQUIRY case; re-run backend/scripts/seed_demo.py --reset.",
    );
  }
  return inquiry.dispute_id;
}

describe("api-contract", () => {
  // Single choke point: an unreachable API fails once here, not once per test.
  beforeAll(async () => {
    await assertDemoApiReachable();
  });

  it("serves PayPal Sandbox health", async () => {
    const res = await callJson("/api/v1/health");

    expect(res.status).toBe(200);
    const health = HealthResponseSchema.parse(res.payload);
    const gateway = health.gateway_status;
    if (gateway === null) {
      throw new Error("health.gateway_status is null");
    }
    expect(gateway.mode).toBe("PAYPAL_SANDBOX");
    expect(gateway.readiness).toBe("ready");
  });

  it("lists the seeded dispute queue", async () => {
    const res = await callJson("/api/v1/disputes");

    expect(res.status).toBe(200);
    const page = DisputePageSchema.parse(res.payload);
    expect(page.meta.total).toBeGreaterThanOrEqual(5);
    const first = page.data[0];
    if (first === undefined) {
      throw new Error("Dispute list is empty despite meta.total >= 5.");
    }
    expect(first.dispute_id.length).toBeGreaterThan(0);
    expect(first.payer_id.length).toBeGreaterThan(0);
    expect(first.order_id.length).toBeGreaterThan(0);
    expect(first.reason_code.length).toBeGreaterThan(0);
    expect(first.stage.length).toBeGreaterThan(0);
    expect(first.status.length).toBeGreaterThan(0);
    expect(first.recommended_action.length).toBeGreaterThan(0);
  });

  it("serves a fully priced INQUIRY case", async () => {
    const disputeId = await findInquiryDisputeId();

    const res = await callJson(`/api/v1/disputes/${encodeURIComponent(disputeId)}`);

    expect(res.status).toBe(200);
    const detail = DisputeDetailSchema.parse(res.payload);
    expect(detail.facts.chain_valid).toBe(true);
    expect(detail.win_probability.signals).toHaveLength(6);
    expect(detail.allowed_actions).toHaveLength(6);
    expect(Number(detail.breakdown.ev_fight_usd)).toBeLessThan(0);
  });

  /* The decision is deterministic function of its inputs, but one input is live: the
     trailing-90-day volume window that ratio_before divides by. Opening any dispute between
     the two calls below changes that ratio and the two answers diverge for a reason that is
     not nondeterminism. The e2e config therefore runs these files serially; keep it that way
     before adding a second writer to this suite. */
  it("recomputes triage deterministically", async () => {
    const disputeId = await findInquiryDisputeId();
    const path = `/api/v1/disputes/${encodeURIComponent(disputeId)}/triage`;

    const first = await callJson(path, { method: "POST" });
    const second = await callJson(path, { method: "POST" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    const firstTriage = TriageResponseSchema.parse(first.payload);
    const secondTriage = TriageResponseSchema.parse(second.payload);
    expect(firstTriage).toEqual(secondTriage);
  });

  it("summarises reporting within valid bounds", async () => {
    const res = await callJson("/api/v1/reporting/summary");

    expect(res.status).toBe(200);
    const summary = ReportingSummarySchema.parse(res.payload);
    expect(summary.total_cases).toBeGreaterThanOrEqual(5);
    expect(summary.avg_p_win).toBeGreaterThanOrEqual(0);
    expect(summary.avg_p_win).toBeLessThanOrEqual(1);
  });

  it("serves the dossier as a real PDF", async () => {
    const disputeId = await findInquiryDisputeId();

    const dossier = await callBinary(
      `/api/v1/disputes/${encodeURIComponent(disputeId)}/dossier.pdf`,
    );

    expect(dossier.status).toBe(200);
    expect(dossier.contentType ?? "").toContain("application/pdf");
    expect(new TextDecoder().decode(dossier.bytes.slice(0, 4))).toBe("%PDF");
  });

  it("returns the error envelope for an unknown dispute", async () => {
    const res = await callJson("/api/v1/disputes/DOES-NOT-EXIST");

    expect(res.status).toBe(404);
    const envelope = ErrorEnvelopeSchema.parse(res.payload);
    expect(envelope.error.code.length).toBeGreaterThan(0);
  });

  it("rejects requests without an API key", async () => {
    const res = await callJson("/api/v1/disputes", { apiKey: null });

    expect(res.status).toBe(401);
    const envelope = ErrorEnvelopeSchema.parse(res.payload);
    expect(envelope.error.code).toBe("unauthorized");
  });
});
