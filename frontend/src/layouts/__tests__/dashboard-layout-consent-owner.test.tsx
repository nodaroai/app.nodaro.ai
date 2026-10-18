import { useEffect, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router-dom"
import { CONSENT_REQUIRED_EVENT, dispatchConsentRequired } from "@/lib/consent-required-event"

/**
 * One owner for the welcome offer and the consent ask. A create refused with
 * `consent_required` dispatches one window event; the app's popup listens for
 * it, and so does the shared header's dialog (always mounted while signed in).
 * With the header on, the layout leaves the app's popup out, so the event opens
 * exactly ONE dialog — the header's. Off, the app's popup is the one, as today.
 * Both stand-ins below listen exactly the way the real ones do.
 */

function useConsentAsk(): boolean {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const ask = () => setOpen(true)
    window.addEventListener(CONSENT_REQUIRED_EVENT, ask)
    return () => window.removeEventListener(CONSENT_REQUIRED_EVENT, ask)
  }, [])
  return open
}

function AppPopupStandIn() {
  return useConsentAsk() ? <div role="dialog" data-owner="app" /> : null
}

function HeaderStandIn() {
  return useConsentAsk() ? <div role="dialog" data-owner="header" /> : null
}

const gate = { on: false }
vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on }))
// The real slot renders the header only when the gate is open.
vi.mock("@/components/layout/site-header-slot", () => ({ SiteHeaderSlot: () => (gate.on ? <HeaderStandIn /> : null) }))
vi.mock("@/components/layout/welcome-offer-popup-slot", () => ({ WelcomeOfferPopupSlot: () => <AppPopupStandIn /> }))
vi.mock("@/components/layout/app-sidebar", () => ({ AppSidebar: () => <aside />, MobileHeader: () => <header /> }))
vi.mock("@/components/layout/free-grant-banner-slot", () => ({ FreeGrantBannerSlot: () => null }))
vi.mock("@/components/layout/consent-gate-slot", () => ({ ConsentGateSlot: () => null }))
vi.mock("@/hooks/use-load-user-settings", () => ({ useLoadUserSettings: () => {} }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1" }, loading: false }) }))
vi.mock("@/hooks/use-embed-session-handoff", () => ({ useEmbedSessionHandoff: () => ({ awaitingHandoff: false }), isEmbedded: () => false }))
vi.mock("@/lib/surface-availability", () => ({ loadSurfaceAvailability: () => {}, resetSurfaceAvailability: () => {} }))
vi.mock("@/lib/scene3d-pro-availability", () => ({ loadScene3DProAvailability: () => {} }))
vi.mock("@/lib/edit-plan-modes", () => ({ watchEditPlanModes: () => () => {} }))
vi.mock("@/lib/api", () => ({ getAuthHeaders: async () => ({}) }))

const { default: DashboardLayout } = await import("../dashboard-layout")

function mount() {
  render(
    <MemoryRouter initialEntries={["/projects"]}>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/projects" element={<p>projects</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => {
  cleanup()
  gate.on = false
})

describe("a create refused for missing consent", () => {
  it("with the shared header: exactly one dialog, the header's", () => {
    gate.on = true
    mount()
    act(() => dispatchConsentRequired())
    const dialogs = screen.getAllByRole("dialog")
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toHaveAttribute("data-owner", "header")
  })

  it("without it: the app's own popup, as today", () => {
    mount()
    act(() => dispatchConsentRequired())
    const dialogs = screen.getAllByRole("dialog")
    expect(dialogs).toHaveLength(1)
    expect(dialogs[0]).toHaveAttribute("data-owner", "app")
  })
})
