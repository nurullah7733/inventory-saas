import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import spacingRule from "./scripts/eslint-spacing-rule.mjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["app/**/*.tsx", "components/**/*.tsx"],
    plugins: { "ui-theme": { rules: { "named-spacing": spacingRule } } },
    rules: { "ui-theme/named-spacing": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Emitted by `prisma contract emit` — never hand-edited, so not linted.
    "prisma/contract.d.ts",
    // Framework-rendered migration packages.
    "migrations/**",
    // Vendored agent-skill copies — tooling, not application code.
    ".agents/**",
    ".claude/**",
    ".cursor/**",
    ".devin/**",
  ]),
]);

export default eslintConfig;
