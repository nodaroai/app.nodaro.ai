import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // New in eslint 10 — disable for now, enable incrementally
      "no-unassigned-vars": "off",
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  globalIgnores([
    "dist/**",
    "build/**",
    "node_modules/**",
  ]),
]);

export default eslintConfig;
