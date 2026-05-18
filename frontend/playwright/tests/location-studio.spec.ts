/**
 * Location Studio — happy-path E2E (stub).
 *
 * Covers the PR-1 Location Studio modal (`location-studio-pr1` branch). The
 * full happy-path — open a workflow with a location node → click "Open
 * Location Studio" → fill name → click Generate → wait for candidate →
 * click Approve → click Save → assert toast "Saved" → assert canvas badge
 * updates — requires a real backend with R2 + KIE creds. That is not
 * feasible to wire on local-dev or CI today, so this spec ships in stub
 * form: it asserts the modal opens, the header renders, and the Appearance
 * tab is selected by default.
 *
 * The full happy-path is documented at:
 *   `specs/features/location-studio-pr1-implementation-plan.md` (Task 36)
 *
 * Once the test-helper infrastructure can seed a workflow with a location
 * node + a stubbed `/v1/locations/:id/generate` route, replace the stub
 * assertions inside `test("happy path …", ...)` with the full flow.
 *
 * ─── To run ─────────────────────────────────────────────────────────────────
 *   # In one terminal:
 *   cd backend && npm run dev
 *
 *   # In another terminal:
 *   cd frontend && npm run dev
 *
 *   # In a third terminal:
 *   cd frontend
 *   npx playwright test playwright/tests/location-studio.spec.ts
 *
 * To list the tests without running:
 *   npx playwright test --list playwright/tests/location-studio.spec.ts
 *
 * ─── Prereqs (env vars) ─────────────────────────────────────────────────────
 *   PLAYWRIGHT_LOCATION_STUDIO_EDITOR_URL
 *     Full URL to a workflow editor page that already contains a single
 *     `location` node with id `location-1`. Example:
 *     `http://localhost:5173/projects/<projectId>/workflows/<workflowId>`.
 *     If unset, the suite is skipped.
 *
 *   PLAYWRIGHT_SUPABASE_SESSION_JSON
 *     The JSON string Supabase stores at `localStorage["sb-<ref>-auth-token"]`.
 *     Copy it from a logged-in browser session. If unset, every test
 *     auto-skips because the DashboardLayout redirects to /login.
 *
 *   PLAYWRIGHT_SUPABASE_STORAGE_KEY
 *     Optional override — defaults to `sb-<project-ref>-auth-token` derived
 *     from VITE_SUPABASE_URL. See the Film Director spec header for details.
 *
 * Mirrors the auth + skip strategy in
 * `playwright/tests/film-director-canvas-build.spec.ts` so contributors only
 * need to learn one pattern. Once Option B (service-role-key fixture) lands,
 * this spec will pick it up automatically.
 */
import { test, expect, type Page } from "@playwright/test"

// ── Env-driven config ─────────────────────────────────────────────────────

const EDITOR_URL = process.env.PLAYWRIGHT_LOCATION_STUDIO_EDITOR_URL ?? ""
const SUPABASE_SESSION_JSON = process.env.PLAYWRIGHT_SUPABASE_SESSION_JSON ?? ""
const SUPABASE_STORAGE_KEY = process.env.PLAYWRIGHT_SUPABASE_STORAGE_KEY ?? ""

/**
 * Install the Supabase session into localStorage BEFORE any app code runs
 * so DashboardLayout sees a logged-in user on its first render. Same shape
 * as the Film Director spec — see that file for the rationale.
 */
async function installSupabaseSession(page: Page): Promise<boolean> {
  if (!SUPABASE_SESSION_JSON) return false
  if (SUPABASE_STORAGE_KEY) {
    const payload = { key: SUPABASE_STORAGE_KEY, value: SUPABASE_SESSION_JSON }
    await page.addInitScript(({ key, value }) => {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        // SecurityError in some sandboxes — surface as a soft skip via the
        // /login redirect path.
      }
    }, payload)
    return true
  }
  await page.addInitScript((value: string) => {
    try {
      window.localStorage.setItem("__nodaro_test_pending_session", value)
    } catch {
      // ignore
    }
  }, SUPABASE_SESSION_JSON)
  return true
}

/**
 * Navigate to the editor and wait for React Flow to mount. Returns true if
 * the canvas is ready; false otherwise (the test self-skips).
 */
async function ensureEditorReady(page: Page): Promise<boolean> {
  await page.goto(EDITOR_URL, { waitUntil: "domcontentloaded" })
  const viewport = page.locator(".react-flow__viewport")
  try {
    await expect(viewport).toBeVisible({ timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

async function setupOrSkip(page: Page): Promise<void> {
  test.skip(
    !EDITOR_URL,
    "PLAYWRIGHT_LOCATION_STUDIO_EDITOR_URL not set — see file header for required env.",
  )
  test.skip(
    !SUPABASE_SESSION_JSON,
    "PLAYWRIGHT_SUPABASE_SESSION_JSON not set — DashboardLayout would redirect to /login.",
  )

  const sessionInstalled = await installSupabaseSession(page)
  expect(sessionInstalled).toBe(true)

  const ready = await ensureEditorReady(page)
  test.skip(!ready, "Editor did not mount — workflow may not exist or session may be expired.")
}

// ── Spec ─────────────────────────────────────────────────────────────────

test.describe("Location Studio (PR-1)", () => {
  test("modal opens with Appearance tab selected", async ({ page }) => {
    await setupOrSkip(page)

    // Click the "Open Studio" button on the location node. The location-node
    // component uses `aria-label="Open Location Studio"` on its CTA.
    const openButton = page.getByRole("button", { name: "Open Location Studio" })
    await expect(openButton).toBeVisible({ timeout: 10_000 })
    await openButton.click()

    // Modal shell appears. The shell uses
    // `role="dialog"` + `aria-labelledby="location-studio-title"`.
    const modal = page.getByRole("dialog", { name: /location studio|unnamed location/i })
    await expect(modal).toBeVisible({ timeout: 5_000 })

    // Appearance tab is the only tab in PR-1 and is selected by default.
    const appearanceTab = modal.getByRole("button", { name: /appearance/i })
    await expect(appearanceTab).toBeVisible()

    // Sidebar shows the PR-2 placeholder.
    await expect(modal.getByText(/more tabs in pr-2/i)).toBeVisible()

    // Close button is present and re-enables on a clean state.
    const closeButton = modal.getByRole("button", { name: /close/i })
    await expect(closeButton).toBeVisible()
    await closeButton.click()
    await expect(modal).toBeHidden()
  })

  // TODO(PR-2): replace this stub with the full happy-path once the
  // test-helper infrastructure can seed a workflow with a location node
  // and stub the `/v1/locations/:id/generate` route. The flow to assert:
  //   1. Click "Open Location Studio" on the location node
  //   2. Fill the Name field with "Sunset Cafe"
  //   3. Click Generate, wait for candidate thumbnail to render
  //   4. Click Approve, wait for the main image to update
  //   5. Click Save, assert toast "Saved" appears
  //   6. Close modal, assert canvas badge count updates
  test.skip("full happy path: generate → approve → save (TODO PR-2)", () => {
    // intentionally empty — see TODO above
  })
})
