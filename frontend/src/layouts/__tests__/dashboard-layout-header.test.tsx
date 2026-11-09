import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * DashboardLayout with and without the shared site header. Off: exactly
 * today's frame (sidebar beside the column, the app's own phone header on
 * non-editor pages). On: the header above the sidebar row — compact on editor
 * pages. Under the hosted header (Nodaro's own deployments) the app's own
 * phone bar comes back for its drawer button, without its logo (the header
 * has no slot to hold it); a white-label header keeps it in its own row and
 * the app's phone bar stays out.
 */

const gate = { mode: null as "default" | "white-label" | null, drawn: false }
const slotProps: { current: Record<string, unknown> | null } = { current: null }
const phoneBar: { current: Record<string, unknown> | null } = { current: null }
vi.mock("@/lib/shared-header", () => ({ useSharedHeaderMode: () => gate.mode, useSharedHeaderMounted: () => gate.drawn }))
vi.mock("@/components/layout/site-header-slot", () => ({
  SiteHeaderSlot: (props: Record<string, unknown>) => {
    slotProps.current = props
    return <div data-testid="site-header" data-compact={String(props.compact)} />
  },
}))
vi.mock("@/components/layout/app-sidebar", () => ({
  AppSidebar: ({ isMobileOpen }: { isMobileOpen: boolean }) => <aside data-testid="sidebar" data-open={String(isMobileOpen)} />,
  MobileHeader: (props: Record<string, unknown>) => {
    phoneBar.current = props
    return <header data-testid="app-phone-header" />
  },
  NAV_ITEMS: [],
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
          <Route path="/projects" element={<p>projects</p>} />
          <Route path="/projects/:id/workflows/:workflowId" element={<p>editor</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  gate.mode = null
  gate.drawn = false
  slotProps.current = null
  phoneBar.current = null
})

describe("DashboardLayout without the shared header", () => {
  it("is today's frame: sidebar beside the column, the app's phone header off the editor", () => {
    const { container } = at("/projects")
    expect(screen.queryByTestId("site-header")).toBeNull()
    expect(screen.getByTestId("app-phone-header")).toBeInTheDocument()
    expect(phoneBar.current?.showLogo).toBe(true)
    expect((container.querySelector("[data-testid=sidebar]")?.parentElement as HTMLElement).className).toBe("flex h-screen bg-background")
  })

  it("no phone header of its own on the editor, as before", () => {
    at("/projects/p1/workflows/w1")
    expect(screen.queryByTestId("app-phone-header")).toBeNull()
  })
})

describe("DashboardLayout with the hosted header (Nodaro's own deployments)", () => {
  it("the header sits above the sidebar row", () => {
    gate.mode = "default"
    const { container } = at("/projects")
    const header = screen.getByTestId("site-header")
    const frame = header.parentElement as HTMLElement
    expect(frame.className).toBe("flex h-screen flex-col bg-background")
    expect(frame.firstElementChild).toBe(header)
    expect(container.querySelector("[data-testid=sidebar]")?.parentElement?.className).toBe("flex min-h-0 flex-1")
    expect(header).toHaveAttribute("data-compact", "false")
  })

  it("the app's phone bar holds the drawer button off the editor, without a second logo", () => {
    gate.mode = "default"
    at("/projects")
    expect(screen.getByTestId("app-phone-header")).toBeInTheDocument()
    expect(phoneBar.current?.showLogo).toBe(false)
    act(() => (phoneBar.current?.onMenuClick as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "true")
  })

  it("compact on the editor, where the canvas keeps its height: no phone bar there", () => {
    gate.mode = "default"
    at("/projects/p1/workflows/w1")
    expect(screen.getByTestId("site-header")).toHaveAttribute("data-compact", "true")
    expect(screen.queryByTestId("app-phone-header")).toBeNull()
  })

  it("tells the header when the drawer is open, and a header overlay closes the drawer", () => {
    gate.mode = "default"
    at("/projects")
    expect(slotProps.current?.drawerOpen).toBe(false)
    act(() => (phoneBar.current?.onMenuClick as () => void)())
    expect(slotProps.current?.drawerOpen).toBe(true)
    act(() => (slotProps.current?.onHeaderOverlay as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false")
  })
})

describe("the skip link", () => {
  it("stays the app's while the hosted header is still loading", () => {
    gate.mode = "default"
    at("/projects")
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument()
  })

  it("is the hosted header's own once it has drawn (no second, identical stop)", () => {
    gate.mode = "default"
    gate.drawn = true
    at("/projects")
    expect(screen.queryByRole("link", { name: "Skip to content" })).toBeNull()
  })

  it("stays the app's under a white-label header, which draws none", () => {
    gate.mode = "white-label"
    gate.drawn = true
    at("/projects")
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument()
  })
})

describe("DashboardLayout with a white-label header (a deployment of its own)", () => {
  it("the header sits above the sidebar row, and the app's own phone header stays out", () => {
    gate.mode = "white-label"
    const { container } = at("/projects")
    const header = screen.getByTestId("site-header")
    expect((header.parentElement as HTMLElement).className).toBe("flex h-screen flex-col bg-background")
    expect(container.querySelector("[data-testid=sidebar]")?.parentElement?.className).toBe("flex min-h-0 flex-1")
    expect(screen.queryByTestId("app-phone-header")).toBeNull()
  })

  it("compact on the editor", () => {
    gate.mode = "white-label"
    at("/projects/p1/workflows/w1")
    expect(screen.getByTestId("site-header")).toHaveAttribute("data-compact", "true")
  })

  it("the header's menu button opens the sidebar drawer, and a header overlay closes it", () => {
    gate.mode = "white-label"
    at("/projects")
    act(() => (slotProps.current?.onOpenMenu as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "true")
    act(() => (slotProps.current?.onHeaderOverlay as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false")
  })
})
