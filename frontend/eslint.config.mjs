import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  {
    ignores: [".next/**", "node_modules/**", "next-env.d.ts", "pnpm-lock.yaml"],
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
    },
  },
];

export default eslintConfig;
