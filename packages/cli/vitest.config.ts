import { defineConfig } from "vitest/config"
import { ciTestOptions } from "../../tools/vitest/ci-limits.mjs"

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // CI-only time limits and slow-test listing (tools/vitest/ci-limits.mjs).
    ...ciTestOptions(),
  },
})
