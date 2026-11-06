import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for the judge-facing E2E layer.
 *
 * Two suites live here, deliberately separate from the Vitest HTTP contract suite
 * (`npm run test:e2e`, which talks to the API with no browser):
 *
 *   1. `e2e/playwright/api/*.spec.ts`   — the 20 judge scenarios asserted against the
 *      REAL demo stack over HTTP, via Playwright's `request` fixture. Fast, no browser.
 *   2. `e2e/playwright/browser/*.spec.ts` — what only a browser can prove: the demo
 *      journey renders and advances, layout does not overflow, and the console stays
 *      clean at every judge viewport.
 *
 * Browser resolution: this repo uses the system Chromium (the same binary
 * `scripts/responsive-audit.mjs` uses) instead of the Playwright-managed build, because
 * the managed download is not present in this environment and the demo must run offline.
 * Override with PW_EXECUTABLE.
 *
 * Both suites require the live demo stack:
 *   backend  → uvicorn on 127.0.0.1:8000  (PAYPAL_MODE=simulator)
 *   frontend → next start on 127.0.0.1:3000
 * A missing stack fails loudly with remediation steps (see e2e/support.ts), never skips.
 */
const EXECUTABLE = process.env.PW_EXECUTABLE ?? "/usr/bin/chromium";
const WEB_BASE = (process.env.AUDIT_BASE ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

export default defineConfig({
  testDir: "./e2e/playwright",
  // The demo writes real rows to one database; parallel files would interleave them.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: ".qa/playwright/results.json" }],
    ["html", { outputFolder: ".qa/playwright/report", open: "never" }],
  ],
  outputDir: ".qa/playwright/artifacts",
  use: {
    baseURL: WEB_BASE,
    launchOptions: { executablePath: EXECUTABLE, args: ["--no-sandbox"] },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // No implicit timeout on actions; individual assertions own their patience.
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
  },
  projects: [
    {
      name: "api",
      testMatch: /e2e\/playwright\/api\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: EXECUTABLE } },
    },
    {
      name: "browser",
      testMatch: /e2e\/playwright\/browser\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: { executablePath: EXECUTABLE, args: ["--no-sandbox"] },
      },
    },
  ],
});
