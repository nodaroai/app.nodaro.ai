/**
 * Location Studio Motion — atmosphere motion happy-path E2E (skipped stub).
 *
 * Covers PR-2 of the Location Studio (`feat/location-studio-pr2`). The full
 * atmosphere-motion happy path is:
 *   1. Open a workflow with a location node that already has an approved
 *      main image (i.e. `data.sourceImageUrl` is set and non-empty).
 *   2. Click the location node's "Open Location Studio" CTA to open the
 *      modal.
 *   3. Click the "Motion" tab in the modal sidebar.
 *   4. Pick one of the 8 motion preset chips (default: "slow dolly-in").
 *   5. Wait for the worker to upload the i2v result, append the row to
 *      `atmosphere_motions`, and surface the new card via the canvas
 *      refresh round-trip.
 *   6. Assert that a `[data-testid="motion-card-0"]` `<video>` card is
 *      rendered with a non-empty `src` attribute.
 *
 * ─── Why this ships as `test.skip` ─────────────────────────────────────────
 *
 * Unlike the PR-1 Appearance-tab stub, this spec needs MORE than a logged-in
 * session and a workflow URL — it needs a workflow whose `location` node has
 * an APPROVED main image. That state is created by clicking "Approve" on a
 * candidate inside the modal, which calls `POST /v1/locations/:id/
 * approve-main-image`, which in turn requires:
 *   - A real backend reachable from Playwright,
 *   - R2 credentials so the worker can persist the candidate,
 *   - KIE credentials so the candidate was generated in the first place,
 *   - A `locations` row whose `main_image_url` is non-empty.
 *
 * On local dev this is *technically* possible (operator manually approves a
 * main image, then captures the editor URL of that workflow into
 * `PLAYWRIGHT_LOCATION_STUDIO_MOTION_EDITOR_URL`). In CI it is not — the
 * fixture would need to mint R2 + KIE creds and seed a `locations` row.
 *
 * Until the fixture story lands (see PR-1 README `Option B`), this spec
 * keeps the full happy-path body but wraps it in `test.skip` so the test
 * file ships and is discoverable by `npx playwright test --list`. A future
 * infrastructure pass that can seed an approved main image flips the
 * `test.skip` → `test` and the assertions run untouched.
 *
 * ─── To run (once approved-main-image fixture is wired) ─────────────────────
 *   # In one terminal:
 *   cd backend && npm run dev
 *
 *   # In another terminal:
 *   cd frontend && npm run dev
 *
 *   # In a third terminal:
 *   cd frontend
 *   export PLAYWRIGHT_SUPABASE_SESSION_JSON='<paste-json>'
 *   export PLAYWRIGHT_LOCATION_STUDIO_MOTION_EDITOR_URL='http://localhost:5173/projects/<projectId>/workflows/<workflowId>'
 *   npx playwright test playwright/tests/location-studio-motion.spec.ts
 *
 * To list discovered tests without running:
 *   npx playwright test --list playwright/tests/location-studio-motion.spec.ts
 *
 * Mirrors the auth + skip strategy in
 * `playwright/tests/location-studio.spec.ts` and
 * `playwright/tests/film-director-canvas-build.spec.ts` so contributors only
 * need to learn one pattern.
 */
import { test, expect, type Page } from "@playwright/test"

// ── Env-driven config ─────────────────────────────────────────────────────

const EDITOR_URL =
  process.env.PLAYWRIGHT_LOCATION_STUDIO_MOTION_EDITOR_URL ?? ""
const SUPABASE_SESSION_JSON = process.env.PLAYWRIGHT_SUPABASE_SESSION_JSON ?? ""
const SUPABASE_STORAGE_KEY = process.env.PLAYWRIGHT_SUPABASE_STORAGE_KEY ?? ""

/**
 * Install the Supabase session into localStorage BEFORE any app code runs so
 * DashboardLayout sees a logged-in user on its first render. Same shape as
 * the PR-1 Location Studio + Film Director specs — see those for rationale.
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
    "PLAYWRIGHT_LOCATION_STUDIO_MOTION_EDITOR_URL not set — see file header for required env.",
  )
  test.skip(
    !SUPABASE_SESSION_JSON,
    "PLAYWRIGHT_SUPABASE_SESSION_JSON not set — DashboardLayout would redirect to /login.",
  )

  const sessionInstalled = await installSupabaseSession(page)
  expect(sessionInstalled).toBe(true)

  const ready = await ensureEditorReady(page)
  test.skip(
    !ready,
    "Editor did not mount — workflow may not exist or session may be expired.",
  )
}

// ── Spec ─────────────────────────────────────────────────────────────────

test.describe("Location Studio Motion (PR-2)", () => {
  // TODO(infra): Flip `test.skip` → `test` once the Playwright fixture can
  // seed a workflow whose `location` node has an approved main image (i.e.
  // `data.sourceImageUrl` is non-empty + the matching `locations.main_image_url`
  // row exists). The assertions below are intentionally complete so the
  // infrastructure pass only needs to wire the seed step — not rewrite the
  // test body.
  //
  // Why we can't seed it today:
  //   - Approve-main-image POSTs to `/v1/locations/:id/approve-main-image`,
  //     which requires a real backend + R2 + an existing candidate generated
  //     via KIE. None of those are available to Playwright on local-dev or
  //     CI without manual operator action.
  //   - PR-1 deferred the same problem (see `location-studio.spec.ts`
  //     `test.skip("full happy path: generate → approve → save (TODO PR-2)")`).
  //
  // Option A (manual operator) for one-off local-dev verification:
  //   1. Log into local frontend, open a workflow with a location node.
  //   2. Open Location Studio, generate a main image, click Approve.
  //   3. Save the workflow so `data.sourceImageUrl` persists.
  //   4. Export `PLAYWRIGHT_LOCATION_STUDIO_MOTION_EDITOR_URL` to that
  //      workflow's editor URL and re-enable this test.
  //
  // Option B (CI fixture) for headless runs:
  //   - Mint a service-role Supabase JWT (see PR-1 README §"Option B").
  //   - Add a fixture that INSERTs a `locations` row with `main_image_url`
  //     pre-populated to a public test image (e.g. a fixed R2 URL), then
  //     PATCHes the workflow JSON so the location node carries
  //     `data.sourceImageUrl` + `data.locationDbId`.
  test.skip("atmosphere motion happy path: open studio → Motion tab → preset → video card", async ({
    page,
  }) => {
    await setupOrSkip(page)

    // Step 1-2: open the Location Studio modal. The location node uses
    // `aria-label="Open Location Studio"` on its CTA.
    const openButton = page.getByRole("button", {
      name: "Open Location Studio",
    })
    await expect(openButton).toBeVisible({ timeout: 10_000 })
    await openButton.click()

    const modal = page.getByRole("dialog", {
      name: /location studio|unnamed location/i,
    })
    await expect(modal).toBeVisible({ timeout: 5_000 })

    // Step 3: switch to the Motion tab. `TabButton` rolls up to a `<button>`
    // with the label text "Motion" (preceded by the 🎬 emoji icon in a
    // sibling span, so accessible name match needs to allow optional emoji).
    const motionTab = modal.getByRole("button", { name: /motion/i })
    await expect(motionTab).toBeVisible()
    await motionTab.click()

    // The tab content header confirms we're on the Motion tab.
    await expect(
      modal.getByRole("heading", { name: /atmosphere motion clips/i }),
    ).toBeVisible({ timeout: 5_000 })

    // Sanity: the "Approve a main image first" banner must NOT be visible —
    // if it is, the fixture didn't seed an approved main image and the test
    // would silently no-op. Fail loudly so the fixture bug is obvious.
    const banner = modal.getByText(/approve a main image first/i)
    await expect(banner).toBeHidden()

    // Step 4: click the first motion preset chip — "slow dolly-in". The
    // preset chip is a `<button>` whose accessible name is the preset
    // string (or its localized variant; we match the English source).
    const preset = modal.getByRole("button", { name: /slow dolly-in/i })
    await expect(preset).toBeEnabled()
    await preset.click()

    // Step 5: wait for the worker to complete + auto-attach. The in-flight
    // placeholder card shows "Generating <name>…" while the job is running;
    // on completion the placeholder drops and a `[data-testid=motion-card-0]`
    // appears. Worker round-trip can be slow (i2v generation + R2 upload),
    // so the wait is generous.
    const motionCard = modal.locator('[data-testid="motion-card-0"]')
    await expect(motionCard).toBeVisible({ timeout: 120_000 })

    // Step 6: verify the video card has a non-empty src — confirms the URL
    // landed in `data.atmosphereMotions[0]`.
    const video = motionCard.locator("video")
    await expect(video).toHaveAttribute("src", /\S/)
  })
})
