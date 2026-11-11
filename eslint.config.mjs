import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // CommonJS scripts (*.cjs) load modules with require() by definition.
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output and caches (the Worker bundle alone is ~17 MB and exhausts ESLint's heap).
    ".open-next/**",
    ".wrangler/**",
    ".cache/**",
    // Generated: the PDF fonts as base64 data URLs (scripts/generate-pdf-font-data.mjs).
    "src/server/pdf/font-data.generated.ts",
  ]),
]);

export default eslintConfig;
