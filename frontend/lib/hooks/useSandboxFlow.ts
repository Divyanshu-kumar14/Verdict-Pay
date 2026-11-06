"use client";

/**
 * The judge flow state machine: checkout -> usage -> dispute.
 *
 * Each step is disabled until the previous step succeeds, every call is logged
 * with a timestamp and measured latency, and a reset aborts in-flight work and
 * clears local state so the command center can re-read truth from the API.
 */

import { useCallback, useRef, useState } from "react";

import { api, toApiError, type ApiError } from "../api";
import { DEMO_BUYER_CLAIM } from "../constants";
import { parseContainment } from "../containment";
import { formatCompactInteger, formatLatency, formatPercent, formatUsd, shortHash } from "../format";
import type { CheckoutResponse, DisputeSimulationResponse, UsageResponse } from "../types";
import { CHANNEL_META, REASON_META, RECOMMENDATION_META, STAGE_META } from "../vocab";

export type StepStatus = "idle" | "running" | "success" | "error";
export type LogLevel = "info" | "ok" | "warn" | "error";

export type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  text: string;
};

export type SandboxFlowState = {
  checkoutStatus: StepStatus;
  usageStatus: StepStatus;
  disputeStatus: StepStatus;
  checkout: CheckoutResponse | null;
  usage: UsageResponse | null;
  dispute: DisputeSimulationResponse | null;
  logs: LogEntry[];
  error: ApiError | null;
};

const INITIAL_STATE: SandboxFlowState = {
  checkoutStatus: "idle",
  usageStatus: "idle",
  disputeStatus: "idle",
  checkout: null,
  usage: null,
  dispute: null,
  logs: [],
  error: null,
};

const DEMO_BUYER_EMAIL = "demo.buyer@aurora.test";
const DEMO_EXPORT_NAME = "q3_financial_model.xlsx";

export type SandboxFlow = {
  state: SandboxFlowState;
  runCheckout: () => Promise<void>;
  runUsage: () => Promise<void>;
  runDispute: () => Promise<void>;
  reset: () => void;
  dismissError: () => void;
};

export function useSandboxFlow(): SandboxFlow {
  const [state, setState] = useState<SandboxFlowState>(INITIAL_STATE);
  const logIdRef = useRef(0);
  const busyRef = useRef(false);
  const attemptRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const appendLog = useCallback((level: LogLevel, text: string) => {
    logIdRef.current += 1;
    const entry: LogEntry = { id: logIdRef.current, at: Date.now(), level, text };
    setState((prev) => ({ ...prev, logs: [...prev.logs, entry] }));
  }, []);

  const errorLine = useCallback((apiError: ApiError): string => {
    const requestId = apiError.requestId ? ` · req ${apiError.requestId}` : "";
    return `${apiError.code} — ${apiError.message}${requestId}`;
  }, []);

  const startAttempt = (): { attempt: number; signal: AbortSignal } => {
    attemptRef.current += 1;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return { attempt: attemptRef.current, signal: controller.signal };
  };

  const runCheckout = useCallback(async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    const { attempt, signal } = startAttempt();

    setState((prev) => ({
      ...prev,
      checkoutStatus: "running",
      usageStatus: "idle",
      disputeStatus: "idle",
      usage: null,
      dispute: null,
      error: null,
    }));
    appendLog("info", "POST /api/v1/sandbox/checkout · plan=pro · ToS v2.4-2026-01");

    const started = performance.now();
    try {
      const result = await api.sandboxCheckout(
        { plan: "pro", email: DEMO_BUYER_EMAIL },
        signal,
      );
      if (attempt !== attemptRef.current) return;
      const latency = Math.round(performance.now() - started);
      setState((prev) => ({ ...prev, checkout: result, checkoutStatus: "success" }));
      appendLog(
        "ok",
        `order ${result.order_id} · payer ${result.payer_id} · ${formatUsd(result.amount_usd)} ${result.currency} · ${formatLatency(latency)}`,
      );
      if (result.subscription_id) {
        appendLog("ok", `subscription ${result.subscription_id} bound to order`);
      }
    } catch (caught) {
      if (attempt !== attemptRef.current) return;
      const apiError = toApiError(caught);
      setState((prev) => ({ ...prev, checkoutStatus: "error", error: apiError }));
      appendLog("error", `checkout failed · ${errorLine(apiError)}`);
    } finally {
      if (attempt === attemptRef.current) busyRef.current = false;
    }
  }, [appendLog, errorLine]);

  const runUsage = useCallback(async (): Promise<void> => {
    const checkout = state.checkout;
    if (!checkout || busyRef.current || state.checkoutStatus !== "success") return;
    busyRef.current = true;
    const { attempt, signal } = startAttempt();

    setState((prev) => ({
      ...prev,
      usageStatus: "running",
      disputeStatus: "idle",
      dispute: null,
      error: null,
    }));
    appendLog(
      "info",
      "POST /api/sdk/usage · @verdictpay/sdk server-side · 15 logins · 42,000 tokens · ZIP export",
    );

    const started = performance.now();
    const input = {
      payer_id: checkout.payer_id,
      order_id: checkout.order_id,
      ...(checkout.subscription_id ? { subscription_id: checkout.subscription_id } : {}),
      logins: 15,
      tokens: 42_000,
      export_name: DEMO_EXPORT_NAME,
    };
    try {
      let result: UsageResponse;
      try {
        result = await api.sdkUsage(input, signal);
      } catch (caught) {
        if (attempt !== attemptRef.current || signal.aborted) return;
        const sdkError = toApiError(caught);
        appendLog(
          "warn",
          `SDK route unavailable — ${errorLine(sdkError)} · falling back to /api/v1/sandbox/usage`,
        );
        result = await api.sandboxUsage(input, signal);
      }
      if (attempt !== attemptRef.current) return;
      const latency = Math.round(performance.now() - started);
      setState((prev) => ({ ...prev, usage: result, usageStatus: "success" }));
      appendLog(
        "ok",
        `${result.events.length} telemetry events chained · head ${shortHash(result.chain.head_hash)} · chain ${result.chain.valid ? "valid" : "broken"} · ${formatLatency(latency)}`,
      );
      const totals = Object.entries(result.totals)
        .map(([key, value]) => `${key}=${formatCompactInteger(value)}`)
        .join(" · ");
      if (totals.length > 0) appendLog("info", `totals · ${totals}`);
    } catch (caught) {
      if (attempt !== attemptRef.current || signal.aborted) return;
      const apiError = toApiError(caught);
      setState((prev) => ({ ...prev, usageStatus: "error", error: apiError }));
      appendLog("error", `usage ingest failed · ${errorLine(apiError)}`);
    } finally {
      if (attempt === attemptRef.current) busyRef.current = false;
    }
  }, [appendLog, errorLine, state.checkout, state.checkoutStatus]);

  const runDispute = useCallback(async (): Promise<void> => {
    const checkout = state.checkout;
    if (!checkout || busyRef.current || state.usageStatus !== "success") return;
    busyRef.current = true;
    const { attempt, signal } = startAttempt();

    setState((prev) => ({ ...prev, disputeStatus: "running", error: null }));
    appendLog(
      "info",
      "POST /api/v1/sandbox/dispute · " +
        REASON_META.MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED.short +
        " · " +
        STAGE_META.INQUIRY.short +
        " · " +
        CHANNEL_META.INTERNAL.short,
    );

    const started = performance.now();
    try {
      const result = await api.sandboxDispute(
        {
          payer_id: checkout.payer_id,
          order_id: checkout.order_id,
          reason_code: "MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED",
          stage: "INQUIRY",
          channel: "INTERNAL",
          claim_text: DEMO_BUYER_CLAIM,
        },
        signal,
      );
      if (attempt !== attemptRef.current) return;
      const latency = Math.round(performance.now() - started);
      setState((prev) => ({ ...prev, dispute: result, disputeStatus: "success" }));
      appendLog(
        "ok",
        `${STAGE_META.INQUIRY.short} ${result.dispute.dispute_id} opened · webhook ${result.webhook_event_id} · ${formatLatency(latency)}`,
      );
      appendLog(
        "info",
        `triage ${result.triage_triggered ? "triggered" : "not triggered"} · ${RECOMMENDATION_META[result.dispute.recommended_action].label} · p(win) ${formatPercent(result.dispute.p_win)}`,
      );
      const containment = parseContainment(result.containment);
      if (containment.suspended) {
        appendLog(
          "ok",
          `containment · subscription ${containment.subscription_id ?? "—"} suspended in ${formatLatency(containment.latency_ms)}`,
        );
      } else if (!containment.attempted) {
        appendLog("info", "containment · skipped (no subscription attached)");
      } else if (containment.error) {
        appendLog("error", `containment · failed — ${containment.error}`);
      }
    } catch (caught) {
      if (attempt !== attemptRef.current) return;
      const apiError = toApiError(caught);
      setState((prev) => ({ ...prev, disputeStatus: "error", error: apiError }));
      appendLog("error", `dispute simulation failed · ${errorLine(apiError)}`);
    } finally {
      if (attempt === attemptRef.current) busyRef.current = false;
    }
  }, [appendLog, errorLine, state.checkout, state.usageStatus]);

  const reset = useCallback(() => {
    attemptRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    busyRef.current = false;
    logIdRef.current += 1;
    const entry: LogEntry = {
      id: logIdRef.current,
      at: Date.now(),
      level: "info",
      text: "sandbox reset · local flow cleared · merchant state reloading from the API",
    };
    setState({ ...INITIAL_STATE, logs: [entry] });
  }, []);

  const dismissError = useCallback(() => {
    setState((prev) => ({ ...prev, error: null }));
  }, []);

  return { state, runCheckout, runUsage, runDispute, reset, dismissError };
}
