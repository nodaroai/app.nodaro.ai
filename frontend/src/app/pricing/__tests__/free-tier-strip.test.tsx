import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The pricing page's free-tier strip is a promise of free credits of one's own
 * ("try everything with 1,500 free credits, no credit card"). The page can be
 * reached on a deployment that sells nothing (its route is gated on
 * `nav.hide`, not on `billing.selfServe`), so the strip goes there and under
 * a deployment payer; the paid plans are not this test's business.
 */

const billing = vi.hoisted(() => ({ surface: {} as { deploymentPayer?: boolean } }))
const session = vi.hoisted(() => ({ user: null as { id: string } | null }))

vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: session.user, loading: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: billing.surface, isLoading: false }) }))
vi.mock("@/ee/hooks/queries/use-billing-queries", () => ({
  useSubscription: () => ({ data: undefined, isLoading: false }),
  useChangePlanMutation: () => ({ mutateAsync: vi.fn() }),
}))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ useUserCredits: () => ({ data: undefined }) }))
vi.mock("@/lib/checkout", () => ({ openStripePage: vi.fn(), startCheckout: vi.fn(), startLoadCheckout: vi.fn() }))
vi.mock("../topup-section", () => ({ TopupSection: () => null }))

import PricingPage from "../page"

function pricingPage() {
  return render(
    <MemoryRouter>
      <PricingPage />
    </MemoryRouter>,
  )
}

const STRIP = /FREE TIER/

beforeEach(() => {
  billing.surface = {}
  session.user = null
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("the pricing page's free-tier strip", () => {
  it("is shown to a guest on a deployment that sells (Nodaro)", () => {
    pricingPage()
    expect(screen.getByText(STRIP)).toBeTruthy()
    expect(document.body.textContent).toContain("1,500 free credits")
  })

  it("is gone where the deployment sells nothing, and the plans stay", () => {
    window.__NODARO_RUNTIME__ = { surface: { billing: { costTab: "inherit", sidebarCard: "inherit", selfServe: false } } }
    pricingPage()
    expect(screen.queryByText(STRIP)).toBeNull()
    expect(document.body.textContent).not.toContain("free credits")
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0)
  })

  it("is gone under a deployment payer", () => {
    billing.surface = { deploymentPayer: true }
    pricingPage()
    expect(screen.queryByText(STRIP)).toBeNull()
    expect(document.body.textContent).not.toContain("free credits")
  })
})
