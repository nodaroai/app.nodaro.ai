import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { ContinueTab } from "../continue-tab"

/**
 * The "Nodaro apps" band (Studio, Voice Changer Pro, Person) follows the shared
 * site header like the sidebar's logo and credits do: the header's worlds row
 * already links every product, so with it on the home screen leaves the band
 * out, and the theme switch the band's title carried moves to "Jump back in".
 * With it off the band renders as before.
 */

const gate = vi.hoisted(() => ({ on: false }))

vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => gate.on, useSharedHeaderActive: () => gate.on }))
vi.mock("@/components/dashboard/flagship-apps", () => ({ FlagshipApps: () => <div data-testid="flagship-apps" /> }))
vi.mock("@/components/dashboard/my-workflows-view", () => ({ MyWorkflowsView: () => null }))
vi.mock("@/components/dashboard/projects-grid-view", () => ({ ProjectsGridView: () => null }))
vi.mock("@/components/dashboard/studio-workflows-view", () => ({ StudioWorkflowsView: () => null }))
vi.mock("../import-json-button", () => ({ ImportJsonButton: () => null }))
vi.mock("../welcome-offer-banner-slot", () => ({ WelcomeOfferBannerSlot: () => null }))
vi.mock("../home-section", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../home-section")>()),
  ThemeSwitch: () => <div data-testid="theme-switch" />,
}))
vi.mock("@/hooks/use-projects-store", () => ({ useProjectsStore: () => vi.fn() }))

function continueTab() {
  return render(
    <MemoryRouter>
      <ContinueTab
        isAdmin={false}
        viewAll={false}
        onViewAllChange={() => {}}
        adminUsers={[]}
        onCreateWorkflow={() => {}}
        isCreating={false}
        onMoveWorkflow={() => {}}
      />
    </MemoryRouter>,
  )
}

describe("ContinueTab: the Nodaro apps band and the shared header", () => {
  it("shows the band when the shared header is off", () => {
    gate.on = false
    continueTab()
    expect(screen.getByTestId("flagship-apps")).toBeInTheDocument()
    expect(screen.getAllByTestId("theme-switch")).toHaveLength(1)
  })

  it("leaves the band out when the shared header is on, and keeps the theme switch", () => {
    gate.on = true
    continueTab()
    expect(screen.queryByTestId("flagship-apps")).not.toBeInTheDocument()
    expect(screen.getAllByTestId("theme-switch")).toHaveLength(1)
  })
})
