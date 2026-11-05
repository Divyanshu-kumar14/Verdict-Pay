import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ErrorBanner } from "../ErrorBanner";
import { ApiError } from "@/lib/api";

describe("ErrorBanner", () => {
  const baseError = new ApiError({
    code: "http_500",
    message: "Upstream PayPal error",
    requestId: "req_abc123",
    status: 500,
  });

  it("shows ApiError message and code", () => {
    render(<ErrorBanner error={baseError} />);
    expect(screen.getByText("Upstream PayPal error")).toBeInTheDocument();
    expect(screen.getByText("http_500")).toBeInTheDocument();
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
  });

  it("shows request_id when present", () => {
    render(<ErrorBanner error={baseError} />);
    expect(screen.getByText(/request_id/)).toBeInTheDocument();
    expect(screen.getByText("req_abc123")).toBeInTheDocument();
  });

  it("hides request_id row when missing", () => {
    const err = new ApiError({ code: "network_error", message: "Offline", status: null });
    render(<ErrorBanner error={err} />);
    expect(screen.queryByText(/request_id/)).not.toBeInTheDocument();
  });

  it("renders context helper text", () => {
    render(<ErrorBanner error={baseError} context="Could not load case." />);
    expect(screen.getByText("Could not load case.")).toBeInTheDocument();
  });

  it("renders retry and dismiss actions and fires callbacks", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(<ErrorBanner error={baseError} onRetry={onRetry} onDismiss={onDismiss} />);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("has role alert for accessibility", () => {
    render(<ErrorBanner error={baseError} />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows up to three detail rows", () => {
    const err = new ApiError({
      code: "validation_error",
      message: "Bad request",
      details: [
        { field: "payer_id", message: "missing", code: "missing" },
        { field: "order_id", message: "invalid", code: "invalid" },
        { field: "plan", message: "unknown", code: "unknown" },
        { field: "extra", message: "should be hidden", code: "hidden" },
      ],
    });
    render(<ErrorBanner error={err} />);
    expect(screen.getByText(/payer_id/)).toBeInTheDocument();
    expect(screen.getByText(/invalid/)).toBeInTheDocument();
    expect(screen.queryByText("should be hidden")).not.toBeInTheDocument();
  });
});
