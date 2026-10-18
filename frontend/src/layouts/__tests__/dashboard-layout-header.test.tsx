import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"

/**
 * DashboardLayout with and without the shared site header. Off: exactly
 * today's frame (sidebar beside the column, the app's own phone header on
 * non-editor pages). On: the header above the sidebar row — compact on editor
 * pages — and no second phone header; its menu button opens the drawer.
 */

const gate = { on: false }
const slotProps: { current: Record<string, unknown> | null } = { current: null }
vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on }))
vi.mock("@/components/layout/site-header-slot", () => ({
  SiteHeaderSlot: (props: Record<string, unknown>) => {
    slotProps.current = props
    return <div data-testid="site-header" data-compact={String(props.compact)} />
  },
}))
vi.mock("@/components/layout/app-sidebar", () => ({
  AppSidebar: ({ isMobileOpen }: { isMobileOpen: boolean }) => <aside data-testid="sidebar" data-open={String(isMobileOpen)} />,
  MobileHeader: () => <header data-testid="app-phone-header" />,
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
  gate.on = false
  slotProps.current = null
})

describe("DashboardLayout without the shared header", () => {
  it("is today's frame: sidebar beside the column, the app's phone header off the editor", () => {
    const { container } = at("/projects")
    expect(screen.queryByTestId("site-header")).toBeNull()
    expect(screen.getByTestId("app-phone-header")).toBeInTheDocument()
    expect((container.querySelector("[data-testid=sidebar]")?.parentElement as HTMLElement).className).toBe("flex h-screen bg-background")
  })

  it("no phone header of its own on the editor, as before", () => {
    at("/projects/p1/workflows/w1")
    expect(screen.queryByTestId("app-phone-header")).toBeNull()
  })
})

describe("DashboardLayout with the shared header", () => {
  it("the header sits above the sidebar row, and the app's own phone header is gone", () => {
    gate.on = true
    const { container } = at("/projects")
    const header = screen.getByTestId("site-header")
    const frame = header.parentElement as HTMLElement
    expect(frame.className).toBe("flex h-screen flex-col bg-background")
    expect(frame.firstElementChild).toBe(header)
    expect(container.querySelector("[data-testid=sidebar]")?.parentElement?.className).toBe("flex min-h-0 flex-1")
    expect(screen.queryByTestId("app-phone-header")).toBeNull()
    expect(header).toHaveAttribute("data-compact", "false")
  })

  it("compact on the editor", () => {
    gate.on = true
    at("/projects/p1/workflows/w1")
    expect(screen.getByTestId("site-header")).toHaveAttribute("data-compact", "true")
  })

  it("the header's menu button opens the sidebar drawer, and a header overlay closes it", () => {
    gate.on = true
    at("/projects")
    act(() => (slotProps.current?.onOpenMenu as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "true")
    act(() => (slotProps.current?.onHeaderOverlay as () => void)())
    expect(screen.getByTestId("sidebar")).toHaveAttribute("data-open", "false")
  })
})
