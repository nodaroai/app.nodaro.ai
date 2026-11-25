import { defineConfig } from "vitest/config"
import { ciTestOptions } from "../../tools/vitest/ci-limits.mjs"

// Vitest's own defaults (node environment, the default include), plus the CI
// time limits and slow-test listing every suite shares (tools/vitest/ci-limits.mjs).
export default defineConfig({
  test: {
    ...ciTestOptions(),
  },
})
