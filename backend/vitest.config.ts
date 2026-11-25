import { configDefaults, defineConfig } from "vitest/config"
import path from "path"
import mediaE2e from "./src/test/media-e2e-files.json"
import { ciTestOptions } from "../tools/vitest/ci-limits.mjs"

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    // The real-media e2e files listed there run in the Media E2E job
    // (vitest.media-e2e.config.ts, `npm run test:media-e2e`), not here.
    exclude: [...configDefaults.exclude, ...mediaE2e.files],
    setupFiles: ["./src/test/setup.ts"],
    // CI-only time limits and slow-test listing (tools/vitest/ci-limits.mjs).
    ...ciTestOptions(),
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/server.ts",
        "src/app.ts",
        "src/worker.ts",
        "src/render-worker.ts",
        "src/orchestrator.ts",
        "src/scripts/**",
        "src/test/**",
        "src/**/*.test.ts",
        "src/**/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
