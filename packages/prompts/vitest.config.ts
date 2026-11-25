import { defineConfig } from "vitest/config"
import { ciTestOptions } from "../../tools/vitest/ci-limits.mjs"

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    // CI-only time limits and slow-test listing (tools/vitest/ci-limits.mjs).
    ...ciTestOptions(),
    coverage: {
      provider: "v8",
      reporters: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: ["src/__tests__/**", "src/index.ts", "src/entries/**"],
    },
  },
})
