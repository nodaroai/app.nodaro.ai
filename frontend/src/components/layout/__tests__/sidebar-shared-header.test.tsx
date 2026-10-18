import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { AppSidebar } from "../app-sidebar"
import { SidebarProvider } from "../sidebar-context"

/**
 * With the shared site header on, the sidebar keeps its navigation, its
 * collapse toggle and the version row, and leaves out what the header now
 * carries: the logo and its app menu, the credit card, the signed-in user with
 * sign-out, and the language and theme switches. (Off, it renders exactly as
 * before: sidebar-characterization.test.tsx.)
 */

vi.mock("@/lib/shared-header", () => ({ sharedHeaderActive: () => true, useSharedHeaderActive: () => true }))
vi.mock("@/lib/version", () => ({ APP_VERSION: "0.0.0-test" }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: { id: "u1", email: "ada@example.com" }, isAdmin: false, signOut: vi.fn() }) }))
vi.mock("@/hooks/queries/use-gallery-queries", () => ({ useGalleryReportCount: () => ({ data: 0 }) }))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({
  useUserCredits: () => ({
    data: { total: 1500, subscription: 1000, topup: 500, effectiveTier: "free", tier: "free", dailyLimit: 200, dailySpent: 50, periodEnd: null },
  }),
}))
vi.mock("@/ee/hooks/queries/use-deployment-billing", () => ({ useDeploymentPayerViewer: () => ({ isPayer: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: {} }) }))
vi.mock("@/hooks/use-update-check", () => ({ useUpdateCheck: () => null }))
vi.mock("@/lib/edition", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/edition")>()), hasCredits: () => true }))

function sidebar(collapsed: boolean) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/projects"]}>
        <SidebarProvider defaultCollapsed={collapsed}>
          <AppSidebar defaultCollapsed={collapsed} isMobileOpen />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("the sidebar under the shared header", () => {
  it.each([false, true])("collapsed=%s: no logo menu, credit card, user row, language or theme switch", (collapsed) => {
    sidebar(collapsed)
    expect(screen.queryByRole("button", { name: "Open a Nodaro app" })).toBeNull()
    expect(screen.queryByText("1,500")).toBeNull()
    expect(screen.queryByText(/^1\.5K$/)).toBeNull()
    expect(screen.queryByText("ada@example.com")).toBeNull()
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Toggle theme" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Pick language" })).toBeNull()
  })

  it.each([false, true])("collapsed=%s: keeps the navigation, the collapse toggle and the version", (collapsed) => {
    sidebar(collapsed)
    expect(screen.getAllByRole("link", { name: "Projects" }).length).toBeGreaterThan(0)
    expect(screen.getByRole("button", { name: collapsed ? "Expand sidebar" : "Collapse" })).toBeInTheDocument()
    expect(screen.getByText(collapsed ? "v0.0" : "v0.0.0-test")).toBeInTheDocument()
  })

  it("the phone drawer still has its close button", () => {
    sidebar(false)
    expect(screen.getByRole("button", { name: "Close sidebar" })).toBeInTheDocument()
  })
})
