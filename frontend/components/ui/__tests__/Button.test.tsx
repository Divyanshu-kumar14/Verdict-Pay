import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Button } from "../Button";

describe("Button", () => {
  it("renders children and calls click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Pay Now</Button>);
    expect(screen.getByRole("button", { name: "Pay Now" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pay Now" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire click when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Disabled
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Disabled" });
    expect(btn).toBeDisabled();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows loading spinner and disables interaction", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Loading
      </Button>,
    );
    const btn = screen.getByRole("button", { name: "Loading" });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-busy", "true");
    // spinner is aria-hidden span with animate-spin
    const spinner = btn.querySelector("span.animate-spin");
    expect(spinner).toBeInTheDocument();
    // click should not fire
    const user = userEvent.setup();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("hides trailing icon while loading", () => {
    render(
      <Button loading trailingIcon={<span data-testid="trailing">→</span>}>
        Go
      </Button>,
    );
    expect(screen.queryByTestId("trailing")).not.toBeInTheDocument();
  });

  it("renders trailing icon when not loading", () => {
    render(
      <Button trailingIcon={<span data-testid="trailing">→</span>}>Go</Button>,
    );
    expect(screen.getByTestId("trailing")).toBeInTheDocument();
  });

  it("renders leading icon when not loading", () => {
    render(<Button icon={<span data-testid="leading">+</span>}>Star</Button>);
    expect(screen.getByTestId("leading")).toBeInTheDocument();
  });
});
