import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // A hook after an early return changes the hook count between renders and
    // crashes the page (React #310) — the Users page did, on staging, 2026-10-13.
    // Lint is where that is caught, not the browser; `rules-of-hooks.test.ts`
    // runs this one rule in CI, since the full lint is not a CI job yet.
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
    },
  },
  {
    rules: {
      // ESLint 10 promoted this to recommended — disable for now, enable incrementally
      "no-useless-assignment": "off",
    },
  },
  globalIgnores([
    "dist/**",
    "build/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
