import "@testing-library/jest-dom/vitest";

// Mock Next.js Link to plain anchor for tests
// (avoids Next router dependency)
import { vi } from "vitest";
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => {
    const React = require("react");
    return React.createElement("a", { href, ...props }, children);
  },
}));

// Silence Next.js warnings about missing request context
// Provide window.matchMedia stub for components that may use it
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Ensure fetch is available (jsdom has it, but allow mocking)
if (!globalThis.fetch) {
  // @ts-ignore
  globalThis.fetch = vi.fn();
}
