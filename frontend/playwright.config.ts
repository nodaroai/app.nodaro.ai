/**
 * Playwright configuration for the Nodaro frontend.
 *
 * This is the FIRST Playwright config in the repo — bootstrapped as part of
 * Task D4 of the Film Director skill (`specs/features/2026-05-14-nodaro-film-
 * director-implementation-plan.md`). Keep it minimal: tests under
 * `playwright/tests/`, single chromium project, default to the Vite dev
 * server URL.
 *
 * The dev server is NOT auto-started here — these tests are designed to run
 * against an already-running `npm run dev` (frontend) + `npm run dev`
 * (backend) pair. See the file headers in each spec under
 * `playwright/tests/` for the exact prereqs.
 *
 * To run any spec:
 *   cd frontend
 *   npx playwright test playwright/tests/<file>.spec.ts
 *
 * To list discovered tests without running:
 *   npx playwright test --list
 */
import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./playwright/tests",
  // Each animation test sets its own page-level expects with explicit
  // timeouts; keep the global cap generous so CI flake doesn't kill us
  // before the per-expect poll budget completes.
  timeout: 60_000,
  expect: {
    // Default budget for `expect(...).toHaveCSS()` polling. Individual
    // assertions can override with `{ timeout: N }`.
    timeout: 5_000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    // Animation tests need a real browser frame loop; Playwright's headless
    // mode still runs the rAF/transition pipeline, so we don't need to force
    // headed mode here. The CI runner uses xvfb; locally everything works.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
})
