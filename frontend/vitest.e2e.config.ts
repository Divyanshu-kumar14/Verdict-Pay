import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    testTimeout: 20000,
    /* These suites share one live API, and the judge flow writes to it: opening a dispute
       moves the trailing-90-day volume window that triage divides by. Run the files in
       parallel and the determinism check can see ratio_before change between its two calls
       and fail for a reason that has nothing to do with determinism. Serial is also what a
       single seeded stack expects. */
    fileParallelism: false,
  },
});
