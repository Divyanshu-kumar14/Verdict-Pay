import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { Badge } from "../Badge";
import { TONE_BADGE, TONE_DOT } from "@/lib/vocab";

describe("Badge", () => {
  it("renders the label text", () => {
    render(<Badge>Inquiry</Badge>);
    expect(screen.getByText("Inquiry")).toBeInTheDocument();
  });

  it("defaults to the neutral pill", () => {
    const { container } = render(<Badge>Internal</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-pill-neutral");
    expect(el.className).toContain("text-pill-neutral-ink");
  });

  it("applies the positive pill for a resolved case", () => {
    const { container } = render(<Badge tone="positive">Resolved</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-pill-positive");
    expect(el.className).toContain("text-pill-positive-ink");
  });

  it("applies the warning pill for an inquiry stage", () => {
    const { container } = render(<Badge tone="warning">Inquiry</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-pill-warning");
    expect(el.className).toContain("text-pill-warning-ink");
  });

  it("applies the negative pill for an escalation stage", () => {
    const { container } = render(<Badge tone="negative">Chargeback</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-pill-negative");
    expect(el.className).toContain("text-pill-negative-ink");
  });

  it("applies the accent pill for the external channel", () => {
    const { container } = render(<Badge tone="accent">Card / bank</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("bg-pill-accent");
    expect(el.className).toContain("text-pill-accent-ink");
  });

  it("every tone renders its dealt pill classes and nothing else", () => {
    const tones = ["positive", "warning", "negative", "accent", "neutral"] as const;
    for (const tone of tones) {
      const { container } = render(<Badge tone={tone}>{tone}</Badge>);
      const el = container.firstChild as HTMLElement;
      for (const cls of TONE_BADGE[tone].split(" ")) {
        expect(el.className).toContain(cls);
      }
      // An opaque pill ground, never a hairline border or a hue utility.
      expect(el.className).not.toContain("border-");
      expect(el.className).not.toMatch(/bg-(positive|warning|negative|accent|muted)\b/);
    }
  });

  it("never renders uppercase or letter-spaced type", () => {
    const { container } = render(<Badge>Resolved</Badge>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).not.toContain("uppercase");
    expect(el.className).not.toContain("tracking-");
  });

  it("renders a dot when dot prop is true", () => {
    const { container } = render(
      <Badge tone="positive" dot>
        Live
      </Badge>,
    );
    const dot = container.querySelector("span.h-1\\.5.w-1\\.5");
    expect(dot).toBeInTheDocument();
    expect(dot?.className).toContain(TONE_DOT.positive);
    expect(dot).toHaveAttribute("aria-hidden");
  });

  it("does not render a dot by default", () => {
    const { container } = render(<Badge>Plain</Badge>);
    expect(container.querySelectorAll("span span")).toHaveLength(0);
  });

  it("forwards title attribute for accessibility", () => {
    render(<Badge title="Inquiry stage">Unique badge title</Badge>);
    const badge = screen.getByText("Unique badge title");
    expect(badge.closest("span")).toHaveAttribute("title", "Inquiry stage");
  });

  it("respects size variants", () => {
    const { container: sm } = render(<Badge size="sm">Small</Badge>);
    expect((sm.firstChild as HTMLElement).className).toContain("text-2xs");

    const { container: md } = render(<Badge size="md">Medium</Badge>);
    const mdClass = (md.firstChild as HTMLElement).className;
    expect(mdClass).toContain("text-xs");
    expect(mdClass).toContain("h-6");
  });
});
