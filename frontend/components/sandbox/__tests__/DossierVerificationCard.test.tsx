import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DossierVerificationCard } from "../DossierVerificationCard";
import type { DossierVerification } from "@/lib/types";

const verification: DossierVerification = {
  dispute_id: "PP-D-TEST-ABCD1234",
  verified: true,
  expected_sha256: "abc123",
  actual_sha256: "abc123",
  verified_at: "2026-11-06T00:00:00Z",
  checks: {
    chain_valid: true,
    snapshot_present: true,
    hash_matches: true,
    size_matches: true,
  },
  detail: "All checks pass",
};

describe("DossierVerificationCard", () => {
  it("renders empty state when verification is null", () => {
    render(<DossierVerificationCard verification={null} />);
    expect(screen.getByText(/Run the dossier step/)).toBeInTheDocument();
  });

  it("renders verified state with check badges", () => {
    render(<DossierVerificationCard verification={verification} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
    expect(screen.getByText("Chain valid")).toBeInTheDocument();
    expect(screen.getByText("Snapshot present")).toBeInTheDocument();
    expect(screen.getByText("Hash matches")).toBeInTheDocument();
    expect(screen.getByText("Size matches")).toBeInTheDocument();
    expect(screen.getByText("All checks pass")).toBeInTheDocument();
  });

  it("renders failed state when verified is false", () => {
    render(
      <DossierVerificationCard
        verification={{ ...verification, verified: false }}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("calls onReverify when Re-verify is clicked", () => {
    const onReverify = vi.fn();
    render(
      <DossierVerificationCard
        verification={verification}
        onReverify={onReverify}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Re-verify/ }));
    expect(onReverify).toHaveBeenCalledTimes(1);
  });

  it("disables Re-verify when disabled=true", () => {
    render(
      <DossierVerificationCard
        verification={verification}
        onReverify={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByRole("button", { name: /Re-verify/ })).toBeDisabled();
  });
});
