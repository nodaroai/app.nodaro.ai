// @test-watches frontend/src/globals.css
import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { Link, MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * WCAG 2.4.1 Bypass Blocks: the first Tab stop on every signed-in page skips
 * the sidebar and the header to the page's content. WCAG 2.4.2: the page names
 * itself in the title. And the "reduce motion" setting is honoured site-wide.
 */

vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => false, useSharedHeaderActive: () => false }))
vi.mock("@/components/layout/site-header-slot", () => ({ SiteHeaderSlot: () => null }))
vi.mock("@/components/layout/app-sidebar", () => ({
  AppSidebar: () => (
    <aside>
      <a href="/projects">sidebar link</a>
    </aside>
  ),
  MobileHeader: () => null,
  NAV_ITEMS: [{ href: "/projects", label: "nav.projects" }],
}))
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

function at(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/projects" element={<Link to="/login">leave</Link>} />
          <Route path="/projects/:id/workflows/:workflowId" element={<p>editor</p>} />
        </Route>
        <Route path="/login" element={<p>sign in</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(cleanup)

describe("DashboardLayout accessibility foundations", () => {
  it("puts a skip link first, pointing at the page's main region", () => {
    const { container } = at("/projects")
    const skip = screen.getByRole("link", { name: "Skip to content" })
    expect(skip).toHaveAttribute("href", "#main")
    expect(container.querySelector("a")).toBe(skip)
    const main = screen.getByRole("main")
    expect(main.id).toBe("main")
    expect(main.tabIndex).toBe(-1)
  })

  it("moves focus to the main region without touching the address", () => {
    at("/projects")
    fireEvent.click(screen.getByRole("link", { name: "Skip to content" }))
    expect(document.activeElement).toBe(screen.getByRole("main"))
  })

  it("is in the editor too: the canvas takes Tab only once it was clicked", () => {
    at("/projects/p1/workflows/w1")
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main")
  })

  it("names the page in the title", () => {
    at("/projects")
    expect(document.title).toBe("Projects | Nodaro")
  })

  it("gives the brand back when leaving the signed-in area", () => {
    at("/projects")
    fireEvent.click(screen.getByRole("link", { name: "leave" }))
    expect(screen.getByText("sign in")).toBeInTheDocument()
    expect(document.title).toBe("Nodaro")
  })
})

describe("reduce motion", () => {
  it("globals.css stops animations and transitions under prefers-reduced-motion", () => {
    const css = readFileSync(resolve(__dirname, "../../globals.css"), "utf8")
    const start = css.indexOf("@media (prefers-reduced-motion: reduce)")
    expect(start).not.toBe(-1)
    const block = css.slice(start)
    expect(block).toMatch(/\*,\s*\*::before,\s*\*::after\s*\{/)
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/)
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/)
    expect(block).toMatch(/scroll-behavior:\s*auto !important/)
  })
})
