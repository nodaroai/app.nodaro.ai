import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { MemoryRouter } from "react-router-dom"
import { AppSidebar, MobileHeader } from "../app-sidebar"
import { SidebarProvider } from "../sidebar-context"

/**
 * Characterization of the sidebar and the phone header as they render with no
 * shared header (every build today, and every build with the flag off): the
 * markup must stay exactly this through the split into smaller files. Signed in,
 * with a balance, so the credit card, the user row and the footer all render.
 */

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
          <AppSidebar defaultCollapsed={collapsed} />
        </SidebarProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe("the sidebar without a shared header (characterization)", () => {
  it.each([false, true])("collapsed=%s renders as before", (collapsed) => {
    const { container } = sidebar(collapsed)
    expect(container.innerHTML).toMatchSnapshot()
  })

  it("the phone header renders as before", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/projects/p1"]}>
        <MobileHeader onMenuClick={() => {}} />
      </MemoryRouter>,
    )
    expect(container.innerHTML).toMatchSnapshot()
  })
})
