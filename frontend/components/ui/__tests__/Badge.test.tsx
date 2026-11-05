import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Badge } from "../Badge";

describe("Badge", () => {
  it("renders the label text", () => {
    render(<Badge>INQUIRY</Badge>);
    expect(screen.getByText("INQUIRY")).toBeInTheDocument();
  });

  it("applies emerald tone classes for success stages", () => {
    const { container } = render(<Badge tone="emerald">RESOLVED</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-emerald");
    expect(el.className).toContain("bg-emerald");
  });

  it("applies amber tone classes for inquiry stages", () => {
    const { container } = render(<Badge tone="amber">INQUIRY</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-amber");
    expect(el.className).toContain("bg-amber");
  });

  it("applies rose tone for escalation stages", () => {
    const { container } = render(<Badge tone="rose">CHARGEBACK</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-rose");
    expect(el.className).toContain("bg-rose");
  });

  it("applies sky tone for external channel", () => {
    const { container } = render(<Badge tone="sky">EXTERNAL</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-sky");
    expect(el.className).toContain("bg-sky");
  });

  it("applies neutral tone for internal channel fallback", () => {
    const { container } = render(<Badge tone="neutral">INTERNAL</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("border-white/10");
  });

  it("renders a dot when dot prop is true", () => {
    const { container } = render(
      <Badge tone="emerald" dot>
        Live
      </Badge>,
    );
    // dot is a span with h-1 w-1 rounded-full
    const dot = container.querySelector("span.h-1.w-1");
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain("bg-emerald");
  });

  it("does not render a dot by default", () => {
    const { container } = render(<Badge>Plain</Badge>);
    const dot = container.querySelector("span.h-1.w-1");
    expect(dot).not.toBeInTheDocument();
  });

  it("forwards title attribute for accessibility", () => {
    render(<Badge title="Inquiry stage">UNIQUE_BADGE_TITLE_TEST</Badge>);
    const badge = screen.getByText("UNIQUE_BADGE_TITLE_TEST");
    expect(badge.closest("span")).toHaveAttribute("title", "Inquiry stage");
  });

  it("respects size variants", () => {
    const { container: xs } = render(<Badge size="xs">XS</Badge>);
    expect((xs.firstChild as HTMLElement).className).toContain("px-1.5");

    const { container: sm } = render(<Badge size="sm">SM</Badge>);
    expect((sm.firstChild as HTMLElement).className).toContain("px-2");
  });
});
