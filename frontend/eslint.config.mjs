import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "pnpm-lock.yaml", ".qa/**"],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSNonNullExpression",
          message: "Do not silence the compiler with non-null assertions; narrow the type instead.",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  /* scripts/ holds standalone Node CLIs, not app code: their whole job is to
     print a report to stdout, so console is the interface, not debug residue. */
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];

export default eslintConfig;
