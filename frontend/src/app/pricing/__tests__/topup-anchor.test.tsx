import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The not-enough-credits dialog's "Buy Credits" opens the pricing page at its
 * top-up section. The page is built by script, so the browser's own jump to a
 * `#fragment` finds nothing to jump to: the page brings the section into view
 * itself.
 */

vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: null, loading: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: {}, isLoading: false }) }))
const plans = vi.hoisted(() => ({ pending: false }))
vi.mock("@/ee/hooks/queries/use-billing-queries", () => ({
  useSubscription: () => ({ data: undefined, isLoading: false }),
  useChangePlanMutation: () => ({ mutateAsync: vi.fn() }),
  useBillingPlans: () => ({ data: undefined, isPending: plans.pending }),
}))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ useUserCredits: () => ({ data: undefined }) }))
vi.mock("@/lib/checkout", () => ({ openStripePage: vi.fn(), startCheckout: vi.fn(), startLoadCheckout: vi.fn() }))
vi.mock("../topup-section", () => ({ TopupSection: () => null }))

import PricingPage from "../page"
import { TOPUP_SECTION_ID, TOPUP_SECTION_PATH } from "../topup-anchor"

const scrolledTo: Element[] = []
const original = Element.prototype.scrollIntoView

beforeEach(() => {
  plans.pending = false
  scrolledTo.length = 0
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolledTo.push(this)
  }
})
afterEach(() => {
  Element.prototype.scrollIntoView = original
})

function pricingPageAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <PricingPage />
    </MemoryRouter>,
  )
}

describe("the pricing page's top-up section", () => {
  it("is the address the buy-credits link names", () => {
    expect(TOPUP_SECTION_PATH).toBe(`/pricing#${TOPUP_SECTION_ID}`)
  })

  it("is brought into view when the page opens at it", () => {
    pricingPageAt(TOPUP_SECTION_PATH)
    const section = document.getElementById(TOPUP_SECTION_ID)
    expect(section).not.toBeNull()
    expect(scrolledTo).toEqual([section])
  })

  it("is brought into view again once the plans above it have loaded and taken their room", () => {
    plans.pending = true
    const page = pricingPageAt(TOPUP_SECTION_PATH)
    expect(scrolledTo.length).toBe(1)
    plans.pending = false
    page.rerender(
      <MemoryRouter initialEntries={[TOPUP_SECTION_PATH]}>
        <PricingPage />
      </MemoryRouter>,
    )
    expect(scrolledTo.length).toBe(2)
  })

  it("leaves the page at its top otherwise", () => {
    pricingPageAt("/pricing")
    expect(document.getElementById(TOPUP_SECTION_ID)).not.toBeNull()
    expect(scrolledTo).toEqual([])
  })
})
