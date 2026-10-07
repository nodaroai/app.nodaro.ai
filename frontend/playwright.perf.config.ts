/**
 * The real-browser performance budgets (playwright/perf/), separate from the
 * E2E config beside it (playwright.config.ts), which runs against a dev server
 * someone has already started. These build their own page in production mode
 * and serve it with `vite preview`, so they need nothing running:
 *
 *   cd frontend && npm run test:perf
 *
 * CI runs them on every PR touching the review inspector or its model
 * (.github/workflows/review-cut-budget.yml, decided 2026-10-07), in
 * Playwright's bundled Chromium on a shared runner, with
 * PERF_BUDGET_ALLOWANCE=2: a regression tripwire at twice the budget. It is
 * not a required check. A manual run asserts the budget itself.
 */
import { defineConfig, devices } from "@playwright/test"

const PORT = 4317

export default defineConfig({
  testDir: "./playwright/perf",
  testMatch: /\.perf\.spec\.ts$/,
  timeout: 120_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One at a time: a budget measured beside another test is the other test's noise.
  workers: 1,
  // On CI, the list reporter too: it prints the measured median to the job log.
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
  },
  webServer: {
    command: `vite build -c playwright/perf/vite.config.ts --logLevel error && vite preview -c playwright/perf/vite.config.ts --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/review-cut.html`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
  // The full Chromium in its new headless mode (not the trimmed headless
  // shell), or an installed browser: PERF_BROWSER_CHANNEL=chrome uses the
  // machine's Google Chrome.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: process.env.PERF_BROWSER_CHANNEL ?? "chromium" } }],
})
