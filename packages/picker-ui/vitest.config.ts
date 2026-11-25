import { defineConfig } from "vitest/config"
import { ciTestOptions } from "../../tools/vitest/ci-limits.mjs"

export default defineConfig({
  test: {
    environment: "jsdom",
    // globals is load-bearing: @testing-library/react's auto-cleanup registers
    // via the global afterEach — without it renders accumulate across tests
    // ("Found multiple elements" on every 2nd test in a file).
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
    // CI-only time limits and slow-test listing (tools/vitest/ci-limits.mjs).
    ...ciTestOptions(),
  },
})
