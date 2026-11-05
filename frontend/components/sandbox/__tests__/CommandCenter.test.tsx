import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { CommandCenter } from "../CommandCenter";
import type { PolledQuery } from "@/lib/hooks/usePolledQuery";
import type {
  CustomerTimeline,
  DisputeDetail,
  DisputeSimulationResponse,
  EvBreakdown,
} from "@/lib/types";

// Minimal but realistic fixtures covering all fields CommandCenter touches
function makeBreakdown(overrides: Partial<EvBreakdown> = {}): EvBreakdown {
  return {
    amount_usd: 99,
    high_volume: false,
    high_volume_fee_usd: 0,
    standard_fee_usd: 15,
    penalty_ratio_usd: 0,
    ratio_before: 0.01,
    ratio_after: 0.012,
    crosses_cliff: false,
    p_win: 0.68,
    offer_ratio: 0.5,
    ev_fight_usd: -12,
    ev_settle_usd: -99,
    ev_offer_usd: -45,
    best_action: "PROVIDE_EVIDENCE",
    formula_notes: [],
    ...overrides,
  };
}

function makeDisputeDetail(overrides: Partial<Record<string, unknown>> = {}): DisputeDetail {
  return {
    dispute_id: "disp_001",
    payer_id: "payer_789",
    order_id: "ord_123",
    subscription_id: "sub_456",
    reason_code: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    stage: "INQUIRY",
    channel: "INTERNAL",
    status: "OPEN",
    currency: "USD",
    amount_usd: 99,
    p_win: 0.68,
    ev_fight_usd: -12,
    ev_settle_usd: -99,
    ev_offer_usd: -45,
    telemetry_completeness: 0.92,
    recommended_action: "PROVIDE_EVIDENCE",
    subscription_suspended: false,
    dossier_available: true,
    seller_response_due_date: "2026-11-20T23:59:00.000Z",
    created_at: "2026-11-06T03:07:00.000Z",
    updated_at: "2026-11-06T03:07:00.000Z",
    breakdown: makeBreakdown(),
    win_probability: {
      score: 0.68,
      base: 0.5,
      signal_sum: 0.18,
      reason_multiplier: 1,
      signals: [],
    },
    allowed_actions: [
      {
        action: "PROVIDE_EVIDENCE",
        allowed: true,
        reason: null,
        fee_usd: 0,
        paypal_link: null,
      },
    ],
    rationale: [
      { key: "k1", label: "Signal 1", detail: "Strong evidence on file" },
      { key: "k2", label: "Signal 2", detail: "Chain verified" },
    ],
    facts: {
      payer_id: "payer_789",
      chain_valid: true,
      chain_head: "hash_4",
      event_count: 4,
      completeness: 0.92,
      tos_version: "v2.4-2026-01",
      tos_hash: "abc",
      tos_accepted_at: "2026-11-06T03:00:00.000Z",
      first_seen: "2026-11-06T03:00:00.000Z",
      last_seen: "2026-11-06T03:05:00.000Z",
      ips: ["203.0.113.1"],
      devices: ["fp_abc"],
      deliveries: [],
      usage_units: 42000,
      usage_events: 4,
      ce3_matches: [],
      ce3_window_days: 7,
      signals: {},
    },
    actions: [],
    ...overrides,
  } as unknown as DisputeDetail;
}

function makeTimeline(): CustomerTimeline {
  return {
    payer_id: "payer_789",
    events: [
      {
        id: "evt_1",
        event_id: "evid_1",
        event_type: "TOS_ACCEPTED",
        paypal_payer_id: "payer_789",
        sequence: 1,
        client_ip: "203.0.113.1",
        device_fingerprint: "fp_abc",
        resource_id: null,
        resource_sha256: null,
        units_consumed: 0,
        prev_hash: "genesis",
        chain_hash: "hash_1",
        created_at: "2026-11-06T03:00:00.000Z",
      },
      {
        id: "evt_2",
        event_id: "evid_2",
        event_type: "SESSION_AUTH",
        paypal_payer_id: "payer_789",
        sequence: 2,
        client_ip: "203.0.113.1",
        device_fingerprint: "fp_abc",
        resource_id: null,
        resource_sha256: null,
        units_consumed: 0,
        prev_hash: "hash_1",
        chain_hash: "hash_2",
        created_at: "2026-11-06T03:01:00.000Z",
      },
    ],
    summary: {
      first_seen: "2026-11-06T03:00:00.000Z",
      last_seen: "2026-11-06T03:01:00.000Z",
      distinct_ips: 1,
      distinct_devices: 1,
      total_units: 42000,
      assets_delivered: 1,
      login_count: 15,
      tos_versions: ["v2.4-2026-01"],
    },
    chain: {
      payer_id: "payer_789",
      valid: true,
      event_count: 2,
      head_hash: "hash_2",
      broken_at_sequence: null,
      breaks: [],
      verified_at: "2026-11-06T03:06:00.000Z",
    },
  } as unknown as CustomerTimeline;
}

function makePolled<T>(data: T | null, overrides: Partial<PolledQuery<T>> = {}): PolledQuery<T> {
  return {
    data,
    error: null,
    loading: data === null,
    refreshing: false,
    updatedAt: Date.now(),
    refresh: vi.fn(),
    ...overrides,
  };
}

describe("CommandCenter", () => {
  it("shows empty state when no dispute is active", () => {
    render(
      <CommandCenter
        activeDisputeId={null}
        restoredFromQueue={false}
        flowDispute={null}
        fallbackEvents={null}
        caseQuery={makePolled<DisputeDetail>(null)}
        timeline={makePolled<CustomerTimeline>(null)}
        onCaseChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("No dispute on file")).toBeInTheDocument();
    expect(screen.getByText(/Run steps 1–3/)).toBeInTheDocument();
  });

  it("smoke renders with mock PolledQuery data", () => {
    const detail = makeDisputeDetail();
    render(
      <CommandCenter
        activeDisputeId="disp_001"
        restoredFromQueue={false}
        flowDispute={null}
        fallbackEvents={null}
        caseQuery={makePolled(detail)}
        timeline={makePolled(makeTimeline())}
        onCaseChanged={vi.fn()}
      />,
    );
    // Case summary hash is rendered via shortHash - check claim amount is visible
    expect(screen.getAllByText("$99.00").length).toBeGreaterThan(0);
    // Recommendation badge (appears in badge + action rail)
    expect(screen.getAllByText("Provide evidence").length).toBeGreaterThan(0);
    // Expected value section
    expect(screen.getByText("Expected value")).toBeInTheDocument();
    // Telemetry ledger renders
    expect(screen.getByText("Telemetry ledger")).toBeInTheDocument();
  });

  it("shows containment banner as active when subscription is not suspended", () => {
    const detail = makeDisputeDetail({ subscription_suspended: false });
    render(
      <CommandCenter
        activeDisputeId="disp_001"
        restoredFromQueue={false}
        flowDispute={null}
        fallbackEvents={null}
        caseQuery={makePolled(detail)}
        timeline={makePolled(makeTimeline())}
        onCaseChanged={vi.fn()}
      />,
    );
    expect(screen.getByText("Subscription active")).toBeInTheDocument();
    expect(screen.getByText(/containment state synced from the case record/)).toBeInTheDocument();
  });

  it("shows containment suspended banner when subscription_suspended is true", () => {
    const detail = makeDisputeDetail({ subscription_suspended: true });
    render(
      <CommandCenter
        activeDisputeId="disp_001"
        restoredFromQueue={false}
        flowDispute={null}
        fallbackEvents={null}
        caseQuery={makePolled(detail)}
        timeline={makePolled(makeTimeline())}
        onCaseChanged={vi.fn()}
      />,
    );
    // CommandCenter renders a neutral/emerald panel with "Subscription suspended" text when case record says suspended
    expect(screen.getByText("Subscription suspended")).toBeInTheDocument();
    // Ensure we do not show active text
    expect(screen.queryByText("Subscription active")).not.toBeInTheDocument();
  });

  it("shows containment suspended in Xms when flowDispute reports suspension", () => {
    const detail = makeDisputeDetail({ subscription_suspended: false });
    const flowDispute = {
      dispute: detail,
      webhook_event_id: "wh_999",
      triage_triggered: true,
      containment: {
        attempted: true,
        suspended: true,
        latency_ms: 42,
        subscription_id: "sub_456",
        error: null,
      },
    } as unknown as DisputeSimulationResponse;

    render(
      <CommandCenter
        activeDisputeId="disp_001"
        restoredFromQueue={false}
        flowDispute={flowDispute}
        fallbackEvents={null}
        caseQuery={makePolled(detail)}
        timeline={makePolled(makeTimeline())}
        onCaseChanged={vi.fn()}
      />,
    );
    expect(screen.getByText(/Subscription suspended in 42ms/)).toBeInTheDocument();
    // containment label is always present
    expect(screen.getByText("containment")).toBeInTheDocument();
  });

  it("surfaces loading state without crashing", () => {
    const loadingQuery = makePolled<DisputeDetail>(null, { loading: true, error: null });
    render(
      <CommandCenter
        activeDisputeId="disp_001"
        restoredFromQueue={false}
        flowDispute={null}
        fallbackEvents={null}
        caseQuery={loadingQuery}
        timeline={makePolled<CustomerTimeline>(null, { loading: true })}
        onCaseChanged={vi.fn()}
      />,
    );
    // Should show skeleton / busy region, not empty state
    expect(screen.queryByText("No dispute on file")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Loading case")).toBeInTheDocument();
  });
});
