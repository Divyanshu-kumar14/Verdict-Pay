import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { EmptyState } from "../EmptyState";

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="No disputes" description="Run the sandbox to create one." />);
    expect(screen.getByText("No disputes")).toBeInTheDocument();
    expect(screen.getByText("Run the sandbox to create one.")).toBeInTheDocument();
  });

  it("renders action slot when provided", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <EmptyState
        title="No disputes"
        description="Create one to get started."
        action={<button onClick={onClick}>Create dispute</button>}
      />,
    );
    const btn = screen.getByRole("button", { name: "Create dispute" });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not render action area when no action is given", () => {
    const { container } = render(
      <EmptyState title="Empty" description="Nothing here yet." />,
    );
    expect(container.querySelector("button")).not.toBeInTheDocument();
  });

  it("renders icon when provided", () => {
    render(
      <EmptyState
        icon={<span data-testid="empty-icon">I</span>}
        title="Empty"
        description="No data"
      />,
    );
    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
  });

  it("applies custom className to container", () => {
    const { container } = render(
      <EmptyState title="T" description="D" className="custom-empty" />,
    );
    expect(container.firstChild).toHaveClass("custom-empty");
  });
});
