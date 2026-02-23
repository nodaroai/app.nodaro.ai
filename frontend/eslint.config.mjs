import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
