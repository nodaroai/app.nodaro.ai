import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * The shared header failing (its chunk does not load, or it throws) must not
 * take the signed-in app down with it — nor leave it without sign-out, credits,
 * language and theme, which the sidebar dropped for the header. The real gate
 * and slot run here; the header module itself throws.
 */

vi.stubEnv("VITE_SHARED_HEADER", "true")
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/edition")>()), hasSharedHeader: () => true }))
vi.mock("@/ee/shell/app-header", () => ({
  default: () => {
    throw new Error("the header failed")
  },
}))
vi.mock("@/components/layout/app-sidebar", async () => {
  const { useSharedHeaderActive } = await import("@/lib/shared-header")
  return {
    AppSidebar: () => <aside data-testid="sidebar" data-shared-header={String(useSharedHeaderActive())} />,
    MobileHeader: () => <header data-testid="app-phone-header" />,
    NAV_ITEMS: [],
  }
})
vi.mock("@/components/layout/free-grant-banner-slot", () => ({ FreeGrantBannerSlot: () => null }))
vi.mock("@/components/layout/consent-gate-slot", () => ({ ConsentGateSlot: () => null }))
vi.mock("@/components/layout/welcome-offer-popup-slot", () => ({ WelcomeOfferPopupSlot: () => null }))
vi.mock("@/hooks/use-load-user-settings", () => ({ useLoadUserSettings: () => {} }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ useEmbedSessionHandoff: () => ({ awaitingHandoff: false }), isEmbedded: () => false }))
vi.mock("@/lib/surface-availability", () => ({ loadSurfaceAvailability: () => {}, resetSurfaceAvailability: () => {} }))
vi.mock("@/lib/scene3d-pro-availability", () => ({ loadScene3DProAvailability: () => {} }))
vi.mock("@/lib/edit-plan-modes", () => ({ watchEditPlanModes: () => () => {} }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))

const { default: DashboardLayout } = await import("../dashboard-layout")
const { resetSharedHeaderFailureForTests, sharedHeaderActive } = await import("@/lib/shared-header")

afterEach(() => {
  cleanup()
  resetSharedHeaderFailureForTests()
})

describe("when the shared header fails", () => {
  it("the page keeps working with today's chrome — not the route's error view", async () => {
    // React reports the caught error; the boundary is the point of the test.
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(sharedHeaderActive()).toBe(true)
    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route element={<DashboardLayout />} errorElement={<p>route error view</p>}>
            <Route path="/projects" element={<p>projects</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(await screen.findByTestId("app-phone-header")).toBeInTheDocument()
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-shared-header", "false")
    expect(screen.getByText("projects")).toBeInTheDocument()
    expect(screen.queryByText("route error view")).toBeNull()
    expect(sharedHeaderActive()).toBe(false)
  })
})
