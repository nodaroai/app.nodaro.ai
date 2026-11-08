import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * The cloud image deployments of their own run carries the shared header
 * (`VITE_SHARED_HEADER=white-label`). A deployment that does not ask for it
 * must render EXACTLY as on a build without it: the real layout, the real
 * sidebar, the real gate and the real header slot render here under both
 * builds, and the markup must be the same, byte for byte — no header, the
 * sidebar's own credit card, account row and phone header, no stylesheet of
 * the header's, and none of its cookies read or written. Only a deployment
 * whose profile says `header: "white-label"` gets the header.
 */

const shared = vi.hoisted(() => ({
  read: vi.fn(() => ({ prefs: { textScale: 0, contrast: false, invert: false, strong: false, spacing: false, links: false, headings: false, readableFont: false, bigCursor: false, stopMotion: false }, hiddenUntil: null })),
  save: vi.fn(),
  applySaved: vi.fn(),
  readLocale: vi.fn(() => "he"),
  saveLocale: vi.fn(),
  watchLocale: vi.fn(() => () => {}),
}))

// The header package's modules, as a build that carries it resolves them.
vi.mock("virtual:site-a11y", () => ({
  sharedAccessibility: { read: shared.read, save: shared.save, applySaved: shared.applySaved },
  a11yStylesheet: "/assets/a11y-test.css",
}))
vi.mock("virtual:site-locale", () => ({ readSavedLocale: shared.readLocale, saveLocale: shared.saveLocale, watchSavedLocale: shared.watchLocale }))
vi.mock("@/ee/shell/app-header", () => ({ default: () => <div data-testid="app-header" /> }))

// The signed-in app around the layout (as in the sidebar's characterization).
vi.mock("@/lib/version", () => ({ APP_VERSION: "0.0.0-test" }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "ada@example.com" }, loading: false, isAdmin: false, signOut: vi.fn() }) }))
vi.mock("@/hooks/queries/use-gallery-queries", () => ({ useGalleryReportCount: () => ({ data: 0 }) }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => ({
    data: { total: 1500, subscription: 1000, topup: 500, effectiveTier: "free", tier: "free", dailyLimit: 200, dailySpent: 50, periodEnd: null },
  }),
}))
vi.mock("@/ee/hooks/queries/use-deployment-billing", () => ({ useDeploymentPayerViewer: () => ({ isPayer: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: {} }) }))
vi.mock("@/hooks/use-update-check", () => ({ useUpdateCheck: () => null }))
vi.mock("@/components/layout/free-grant-banner-slot", () => ({ FreeGrantBannerSlot: () => null }))
vi.mock("@/components/layout/consent-gate-slot", () => ({ ConsentGateSlot: () => null }))
vi.mock("@/components/layout/welcome-offer-popup-slot", () => ({ WelcomeOfferPopupSlot: () => null }))
vi.mock("@/hooks/use-load-user-settings", () => ({ useLoadUserSettings: () => {} }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ useEmbedSessionHandoff: () => ({ awaitingHandoff: false }), isEmbedded: () => false }))
vi.mock("@/lib/surface-availability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-availability")>()),
  loadSurfaceAvailability: () => {},
  resetSurfaceAvailability: () => {},
}))
vi.mock("@/lib/scene3d-pro-availability", () => ({ loadScene3DProAvailability: () => {} }))
vi.mock("@/lib/edit-plan-modes", () => ({ watchEditPlanModes: () => () => {} }))
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api")>()), getAuthHeaders: async () => ({}) }))

/** A tenant's profile with no `header` key: its own brand, prepaid, no platform links. */
const TENANT = { brand: { productName: "Acme Studio", platformLinks: false }, billing: { selfServe: false } }

/** One build of the app (its flags are read when its modules load), on one deployment. */
async function page(flag: string, surface: unknown) {
  vi.resetModules()
  vi.stubEnv("VITE_EDITION", "cloud")
  vi.stubEnv("VITE_SHARED_HEADER", flag)
  window.__NODARO_RUNTIME__ = (surface ? { surface } : {}) as typeof window.__NODARO_RUNTIME__
  for (const fn of Object.values(shared)) fn.mockClear()
  const { default: DashboardLayout } = await import("../dashboard-layout")
  const { applySavedPreferences } = await import("@/lib/accessibility-preferences")
  const { useLocaleStore } = await import("@/lib/locale-store")
  // The entry module's boot, then a page.
  applySavedPreferences()
  const view = render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route element={<DashboardLayout />}>
            <Route path="/projects" element={<p>projects</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await screen.findByText("projects")
  // The sidebar draws after it has read its stored state (an effect).
  await act(async () => {})
  // A language the user picks, and the account's at sign-in.
  act(() => useLocaleStore.getState().setLocale("en"))
  // React numbers its generated ids in render order across the run: the same
  // markup, rendered second, carries later numbers. Compare them as one.
  const markup = view.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_id_")
  const stylesheet = document.head.querySelector("link[data-site-a11y]")
  const result = {
    markup,
    stylesheet: stylesheet?.getAttribute("href") ?? null,
    sharedReads: shared.read.mock.calls.length + shared.readLocale.mock.calls.length,
    sharedWrites: shared.save.mock.calls.length + shared.saveLocale.mock.calls.length + shared.applySaved.mock.calls.length,
  }
  return { ...result, view }
}

afterEach(() => {
  cleanup()
  for (const link of document.head.querySelectorAll("link[data-site-a11y]")) link.remove()
  delete window.__NODARO_RUNTIME__
  vi.unstubAllEnvs()
})

describe("the cloud image (header built in as white-label) on a deployment that does not ask for the header", () => {
  it.each([
    ["a tenant's profile without the key", TENANT],
    ["no surface profile at all", undefined],
  ])("%s renders exactly as on a build without the header", async (_label, surface) => {
    const without = await page("", surface)
    cleanup()
    const image = await page("white-label", surface)

    expect(image.markup).toBe(without.markup)
    expect(screen.queryByTestId("app-header")).toBeNull()
    // The app's own chrome: the sidebar (its card, the account row) and the phone header.
    expect(image.markup).toContain("<aside")
    expect(image.markup).toContain("ada@example.com")
    expect(screen.getAllByRole("button", { name: /open menu/i }).length).toBeGreaterThan(0)
    // Nothing of the header's: no stylesheet, no cookie read or written.
    expect(image.stylesheet).toBeNull()
    expect(image.sharedReads).toBe(0)
    expect(image.sharedWrites).toBe(0)
  })
})

describe("why the image is built as white-label, not as Nodaro's sites are", () => {
  it("control: with the Nodaro value (\"true\"), a deployment with no profile would get Nodaro's header", async () => {
    const without = await page("", undefined)
    cleanup()
    const nodaro = await page("true", undefined)
    expect(nodaro.markup).not.toBe(without.markup)
    act(() => {
      document.head.querySelector("link[data-site-a11y]")?.dispatchEvent(new Event("load"))
    })
    expect(await screen.findByTestId("app-header")).toBeInTheDocument()
  })
})

describe("a deployment that asks for its own header", () => {
  it("gets it, on the same image: the header, its stylesheet and the shared choices", async () => {
    const withKey = await page("white-label", { ...TENANT, header: "white-label" })
    // The header waits for its accessibility stylesheet before it mounts.
    expect(withKey.stylesheet).toBe("/assets/a11y-test.css")
    act(() => {
      document.head.querySelector("link[data-site-a11y]")?.dispatchEvent(new Event("load"))
    })
    expect(await screen.findByTestId("app-header")).toBeInTheDocument()
    expect(shared.applySaved).toHaveBeenCalledWith({ cookieDomain: null })
    expect(shared.saveLocale).toHaveBeenCalledWith("en", { cookieDomain: null })
  })
})
