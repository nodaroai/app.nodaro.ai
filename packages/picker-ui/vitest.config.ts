import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    environment: "jsdom",
    // globals is load-bearing: @testing-library/react's auto-cleanup registers
    // via the global afterEach — without it renders accumulate across tests
    // ("Found multiple elements" on every 2nd test in a file).
    globals: true,
    include: ["src/**/__tests__/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
})
