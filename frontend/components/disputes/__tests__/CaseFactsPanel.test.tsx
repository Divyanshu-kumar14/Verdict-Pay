import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CaseFactsPanel } from "../CaseFactsPanel";
import type { CaseFacts } from "@/lib/types";

const baseFacts: CaseFacts = {
  payer_id: "YRZ829104KLA",
  chain_valid: true,
  chain_head: "ab4521cd" + "0".repeat(56),
  event_count: 3,
  completeness: 1,
  tos_version: "v2.4-2026-01",
  tos_hash: "sha256:abc",
  tos_accepted_at: "2026-01-15T00:00:00Z",
  first_seen: "2026-01-10T00:00:00Z",
  last_seen: "2026-11-01T00:00:00Z",
  ips: ["203.0.113.42"],
  devices: ["fp_89a7c6d5e4f3"],
  deliveries: [],
  usage_units: 42000,
  usage_events: 4,
  login_count: 15,
  buyer_claim_text: null,
  response_due_date: "2026-11-11T00:00:00Z",
  ce3_matches: [],
  ce3_window_days: 120,
  ce3_proof: null,
  payment_rail: "PAYPAL_WALLET",
  external_reason_code: null,
  signals: {},
};

function makeFacts(ce3: CaseFacts["ce3_proof"] | null): CaseFacts {
  return { ...baseFacts, ce3_proof: ce3 };
}

const verifiedProof: CaseFacts["ce3_proof"] = {
  eligible: true,
  verified: true,
  veto_code: null,
  matched_prior_orders: ["ORD-1"],
  shared_anchors: ["ip_hash"],
  window_seconds: [10000000],
  sha256_manifest: "abc",
};

const failedProof: CaseFacts["ce3_proof"] = {
  eligible: false,
  verified: false,
  veto_code: "VETO_CE3_WINDOW_OUT_OF_RANGE",
  matched_prior_orders: [],
  shared_anchors: [],
  window_seconds: [],
  sha256_manifest: null,
};

const notEligibleProof: CaseFacts["ce3_proof"] = {
  eligible: false,
  verified: false,
  veto_code: null,
  matched_prior_orders: [],
  shared_anchors: [],
  window_seconds: [],
  sha256_manifest: null,
};

describe("CaseFactsPanel CE 3.0 badge states", () => {
  it("shows CE 3.0 verified when verified=true", () => {
    render(<CaseFactsPanel facts={makeFacts(verifiedProof)} />);
    expect(screen.getByText("CE 3.0 verified")).toBeInTheDocument();
  });

  it("shows CE 3.0 check failed when verified=false with veto_code", () => {
    render(<CaseFactsPanel facts={makeFacts(failedProof)} />);
    expect(screen.getByText("CE 3.0 check failed")).toBeInTheDocument();
    expect(screen.getByText("VETO_CE3_WINDOW_OUT_OF_RANGE")).toBeInTheDocument();
  });

  it("shows CE 3.0 not eligible when not eligible and no veto_code", () => {
    render(<CaseFactsPanel facts={makeFacts(notEligibleProof)} />);
    expect(screen.getByText("CE 3.0 not eligible")).toBeInTheDocument();
  });

  it("shows no CE 3.0 badge when ce3_proof is null", () => {
    render(<CaseFactsPanel facts={makeFacts(null)} />);
    expect(screen.queryByText(/CE 3.0/)).not.toBeInTheDocument();
  });
});
