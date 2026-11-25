import { defineConfig } from "vitest/config"
import { ciTestOptions } from "../../tools/vitest/ci-limits.mjs"

// Vitest's own defaults (node environment, the default include), plus the CI
// time limits and slow-test listing every suite shares (tools/vitest/ci-limits.mjs),
// and a setup file that gives Testing Library's waits the same CI factor.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    ...ciTestOptions(),
  },
})
