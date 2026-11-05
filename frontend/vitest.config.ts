import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: false,
    include: [
      "lib/__tests__/**/*.test.ts",
      "lib/__tests__/**/*.test.tsx",
      "components/ui/__tests__/**/*.test.tsx",
      "lib/hooks/__tests__/**/*.test.tsx",
      "components/sandbox/__tests__/**/*.test.tsx",
    ],
  },
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
