import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { useSandboxFlow } from "../useSandboxFlow";

// We render a small harness that exposes the hook state to the DOM
function Harness() {
  const { state, runCheckout, runUsage, runDispute, runDossier, reset, dismissError } = useSandboxFlow();
  return (
    <div>
      <div data-testid="dossierStatus">{state.dossierStatus}</div>
      <div data-testid="dossierVerify">
        {state.dossierVerify ? (state.dossierVerify.verified ? "verified" : "failed") : "none"}
      </div>
      <button onClick={() => void runDossier()}>dossier</button>
      <div data-testid="checkoutStatus">{state.checkoutStatus}</div>
      <div data-testid="usageStatus">{state.usageStatus}</div>
      <div data-testid="disputeStatus">{state.disputeStatus}</div>
      <div data-testid="orderId">{state.checkout?.order_id ?? "none"}</div>
      <div data-testid="payerId">{state.checkout?.payer_id ?? "none"}</div>
      <div data-testid="eventsCount">{String(state.usage?.events.length ?? 0)}</div>
      <div data-testid="disputeStage">{state.dispute?.dispute.stage ?? "none"}</div>
      <div data-testid="disputeId">{state.dispute?.dispute.dispute_id ?? "none"}</div>
      <div data-testid="errorCode">{state.error?.code ?? "no-error"}</div>
      <div data-testid="errorMessage">{state.error?.message ?? ""}</div>
      <div data-testid="requestId">{state.error?.requestId ?? "no-req"}</div>
      <div data-testid="logs">{state.logs.map((l) => l.text).join("|")}</div>

      <button onClick={() => void runCheckout()}>checkout</button>
      <button onClick={() => void runUsage()}>usage</button>
      <button onClick={() => void runDispute()}>dispute</button>
      <button onClick={() => reset()}>reset</button>
      <button onClick={() => dismissError()}>dismiss</button>

      {/* Error banner representation - mirrors real UI */}
      {state.error ? (
        <div role="alert" data-testid="error-banner">
          <span>{state.error.code}</span>
          <span>{state.error.message}</span>
          {state.error.requestId ? <span>{state.error.requestId}</span> : null}
          <button onClick={() => dismissError()}>Dismiss</button>
        </div>
      ) : null}
    </div>
  );
}

// Helpers to create mock fetch responses
function jsonResponse(body: unknown, opts: { status?: number; requestId?: string } = {}) {
  const status = opts.status ?? 200;
  const ok = status >= 200 && status < 300;
  const requestId = opts.requestId ?? "req_test_123";
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    headers: {
      get: (name: string) => {
        if (name.toLowerCase() === "x-request-id") return requestId;
        if (name.toLowerCase() === "content-type") return "application/json";
        return null;
      },
    },
    json: async () => body,
  } as unknown as Response;
}

function errorEnvelope(code: string, message: string, requestId = "req_err_1") {
  return {
    error: {
      code,
      message,
      request_id: requestId,
      details: [],
    },
  };
}

// Fixtures matching zod schemas (money as string is allowed via coercion)
const checkoutFixture = {
  order_id: "ord_123",
  run_id: "run_test_1",
  subscription_id: "sub_456",
  payer_id: "payer_789",
  // Creating an order is not a payment: the fixture must not claim APPROVED.
  status: "CREATED",
  amount_usd: "99.00",
  currency: "USD",
  approval_url: "https://paypal.com/approve/ord_123",
  created_at: "2026-11-06T03:00:00.000Z",
  gateway_mode: "PAYPAL_SANDBOX",
  sandbox: true,
  lifecycle_stage: "CREATED",
  provenance: "paypal_sandbox",
  paypal_debug_id: null,
};

function makeEvent(seq: number, type: string) {
  return {
    id: `evt_${seq}`,
    event_id: `evid_${seq}`,
    event_type: type,
    paypal_payer_id: "payer_789",
    sequence: seq,
    client_ip: "203.0.113.1",
    device_fingerprint: "fp_abc",
    resource_id: seq === 3 ? "res_1" : null,
    resource_sha256: seq === 3 ? "hash123" : null,
    units_consumed: seq === 4 ? 42000 : seq === 2 ? 15 : 0,
    prev_hash: seq === 1 ? "genesis" : `hash_${seq - 1}`,
    chain_hash: `hash_${seq}`,
    created_at: "2026-11-06T03:05:00.000Z",
  };
}

const usageFixture = {
  chain: {
    payer_id: "payer_789",
    valid: true,
    event_count: 4,
    head_hash: "hash_4",
    broken_at_sequence: null,
    breaks: [],
    verified_at: "2026-11-06T03:06:00.000Z",
  },
  events: [
    makeEvent(1, "TOS_ACCEPTED"),
    makeEvent(2, "SESSION_AUTH"),
    makeEvent(3, "ASSET_DELIVERED"),
    makeEvent(4, "USAGE_METERED"),
  ],
  totals: { logins: 15, tokens: 42000, exports: 1 },
};

const disputeFixture = {
  dispute: {
    dispute_id: "disp_001",
    payer_id: "payer_789",
    order_id: "ord_123",
    subscription_id: "sub_456",
    reason_code: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
    stage: "INQUIRY",
    channel: "INTERNAL",
    status: "OPEN",
    currency: "USD",
    amount_usd: "99.00",
    p_win: 0.68,
    ev_fight_usd: "-12.00",
    ev_settle_usd: "-99.00",
    ev_offer_usd: "-45.00",
    telemetry_completeness: 0.92,
    recommended_action: "PROVIDE_EVIDENCE",
    subscription_suspended: false,
    dossier_available: true,
    seller_response_due_date: "2026-11-20T23:59:00.000Z",
    created_at: "2026-11-06T03:07:00.000Z",
    updated_at: "2026-11-06T03:07:00.000Z",
  },
  webhook_event_id: "wh_999",
  triage_triggered: true,
  containment: {
    attempted: true,
    suspended: true,
    latency_ms: 42,
    subscription_id: "sub_456",
    error: null,
  },
};

describe("useSandboxFlow", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-06T03:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("starts in idle state with no ids", () => {
    render(<Harness />);
    expect(screen.getByTestId("checkoutStatus").textContent).toBe("idle");
    expect(screen.getByTestId("usageStatus").textContent).toBe("idle");
    expect(screen.getByTestId("disputeStatus").textContent).toBe("idle");
    expect(screen.getByTestId("orderId").textContent).toBe("none");
    expect(screen.getByTestId("payerId").textContent).toBe("none");
    expect(screen.getByTestId("errorCode").textContent).toBe("no-error");
  });

  it("checkout success populates order and payer ids", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) {
        return jsonResponse(checkoutFixture);
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await user.click(screen.getByText("checkout"));

    // Advance timers to let async work settle (performance.now uses real timers, but fetch microtasks need flushing)
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => {
      expect(screen.getByTestId("checkoutStatus").textContent).toBe("success");
    });
    expect(screen.getByTestId("orderId").textContent).toBe("ord_123");
    expect(screen.getByTestId("payerId").textContent).toBe("payer_789");
    // logs contain success line
    expect(screen.getByTestId("logs").textContent).toContain("ord_123");
    expect(screen.getByTestId("errorCode").textContent).toBe("no-error");

    vi.unstubAllGlobals();
  });

  it("usage step after checkout triggers 4 chained events", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) return jsonResponse(checkoutFixture);
      // sdkUsage first - let it succeed directly to avoid fallback complexity
      if (url.includes("/api/sdk/usage")) return jsonResponse(usageFixture);
      if (url.includes("/sandbox/usage")) return jsonResponse(usageFixture);
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await user.click(screen.getByText("checkout"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("checkoutStatus").textContent).toBe("success"));

    await user.click(screen.getByText("usage"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(screen.getByTestId("usageStatus").textContent).toBe("success"));
    expect(screen.getByTestId("eventsCount").textContent).toBe("4");
    expect(screen.getByTestId("logs").textContent).toContain("4 telemetry events chained");
    expect(screen.getByTestId("logs").textContent).toContain("head");

    vi.unstubAllGlobals();
  });

  it("usage falls back to /api/v1/sandbox/usage when /api/sdk/usage is unavailable", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) return jsonResponse(checkoutFixture);
      if (url.includes("/api/sdk/usage")) {
        // simulate SDK route failure -> error envelope
        return jsonResponse(errorEnvelope("route_not_found", "SDK route not available"), {
          status: 404,
        });
      }
      if (url.includes("/sandbox/usage")) return jsonResponse(usageFixture);
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.click(screen.getByText("checkout"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("checkoutStatus").textContent).toBe("success"));

    await user.click(screen.getByText("usage"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("usageStatus").textContent).toBe("success"));
    expect(screen.getByTestId("eventsCount").textContent).toBe("4");

    vi.unstubAllGlobals();
  });

  it("dispute step creates a case with INQUIRY stage", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) return jsonResponse(checkoutFixture);
      if (url.includes("/api/sdk/usage") || url.includes("/sandbox/usage")) return jsonResponse(usageFixture);
      if (url.includes("/api/v1/disputes")) {
        return jsonResponse({
          data: [disputeFixture.dispute],
          meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await user.click(screen.getByText("checkout"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("checkoutStatus").textContent).toBe("success"));

    await user.click(screen.getByText("usage"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("usageStatus").textContent).toBe("success"));

    await user.click(screen.getByText("dispute"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(screen.getByTestId("disputeStatus").textContent).toBe("success"));
    expect(screen.getByTestId("disputeStage").textContent).toBe("INQUIRY");
    expect(screen.getByTestId("disputeId").textContent).toBe("disp_001");
    // The step log reads in sentence case, not in the enum the API speaks.
    expect(screen.getByTestId("logs").textContent).toContain("via PayPal webhook");

    vi.unstubAllGlobals();
  });

  it("error path shows error banner with message and request_id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) {
        return jsonResponse(errorEnvelope("http_500", "Upstream PayPal error", "req_abc123"), {
          status: 500,
          requestId: "req_abc123",
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);

    await user.click(screen.getByText("checkout"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });

    await waitFor(() => expect(screen.getByTestId("checkoutStatus").textContent).toBe("error"));
    expect(screen.getByTestId("errorCode").textContent).toBe("http_500");
    expect(screen.getByTestId("errorMessage").textContent).toBe("Upstream PayPal error");
    expect(screen.getByTestId("requestId").textContent).toBe("req_abc123");

    // error banner is visible to user
    expect(screen.getByTestId("error-banner")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getAllByText("http_500").length).toBeGreaterThan(0);
    expect(screen.getAllByText("req_abc123").length).toBeGreaterThan(0);

    // dismiss clears error
    await user.click(screen.getByText("Dismiss"));
    await waitFor(() => expect(screen.queryByTestId("error-banner")).not.toBeInTheDocument());
    expect(screen.getByTestId("errorCode").textContent).toBe("no-error");

    vi.unstubAllGlobals();
  });

  const manifestFixture = {
    dispute_id: "disp_001",
    run_id: "run_test_1",
    filename: "dossier.pdf",
    sha256: "a".repeat(64),
    size_bytes: 1234,
    generated_at: "2026-11-06T03:08:00.000Z",
    chain_head: "hash_4",
    chain_valid: true,
    event_count: 4,
    narrative_source: "template",
    snapshot_hash: "b".repeat(64),
    download_url: "/api/v1/disputes/disp_001/dossier",
  };

  function verifyFixture(verified: boolean) {
    return {
      dispute_id: "disp_001",
      verified,
      expected_sha256: "a".repeat(64),
      actual_sha256: verified ? "a".repeat(64) : "c".repeat(64),
      verified_at: "2026-11-06T03:09:00.000Z",
      detail: verified ? "match" : "mismatch",
      checks: { bytes_match: verified },
    };
  }

  async function reachDossier(verified: boolean) {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) return jsonResponse(checkoutFixture);
      if (url.includes("/api/sdk/usage") || url.includes("/sandbox/usage")) return jsonResponse(usageFixture);
      if (url.includes("/dossier/manifest")) return jsonResponse(manifestFixture);
      if (url.includes("/dossier/verify")) return jsonResponse(verifyFixture(verified));
      if (url.includes("/api/v1/disputes")) {
        return jsonResponse({
          data: [disputeFixture.dispute],
          meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
        });
      }
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    for (const [label, testId] of [
      ["checkout", "checkoutStatus"],
      ["usage", "usageStatus"],
      ["dispute", "disputeStatus"],
    ] as const) {
      await user.click(screen.getByText(label));
      await act(async () => {
        vi.advanceTimersByTime(100);
        await vi.runAllTimersAsync();
      });
      await waitFor(() => expect(screen.getByTestId(testId).textContent).toBe("success"));
    }
    await user.click(screen.getByText("dossier"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
  }

  it("runDossier: verified=true moves dossierStatus to success with no error", async () => {
    await reachDossier(true);
    await waitFor(() => expect(screen.getByTestId("dossierStatus").textContent).toBe("success"));
    expect(screen.getByTestId("dossierVerify").textContent).toBe("verified");
    expect(screen.getByTestId("errorCode").textContent).toBe("no-error");
    vi.unstubAllGlobals();
  });

  it("runDossier: verified=false surfaces dossier_verification_failed, not unknown_error", async () => {
    await reachDossier(false);
    await waitFor(() => expect(screen.getByTestId("dossierStatus").textContent).toBe("error"));
    expect(screen.getByTestId("dossierVerify").textContent).toBe("failed");
    expect(screen.getByTestId("errorCode").textContent).toBe("dossier_verification_failed");
    expect(screen.getByTestId("errorCode").textContent).not.toBe("unknown_error");
    expect(screen.getByTestId("errorMessage").textContent).toBe(
      "Dossier verification FAILED: re-rendered bytes differ from the frozen snapshot.",
    );
    vi.unstubAllGlobals();
  });

  it("reset clears ids and returns to idle", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/sandbox/checkout")) return jsonResponse(checkoutFixture);
      return jsonResponse({}, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<Harness />);
    await user.click(screen.getByText("checkout"));
    await act(async () => {
      vi.advanceTimersByTime(100);
      await vi.runAllTimersAsync();
    });
    await waitFor(() => expect(screen.getByTestId("orderId").textContent).toBe("ord_123"));

    await user.click(screen.getByText("reset"));
    expect(screen.getByTestId("checkoutStatus").textContent).toBe("idle");
    expect(screen.getByTestId("orderId").textContent).toBe("none");
    expect(screen.getByTestId("logs").textContent).toContain("sandbox reset");

    vi.unstubAllGlobals();
  });
});
