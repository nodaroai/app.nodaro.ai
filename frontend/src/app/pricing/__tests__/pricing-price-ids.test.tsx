import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"

/**
 * The pricing page's paid plans check out the price the deployment lists
 * (GET /v1/billing/plans), which answers whoever checkout lets through. On a
 * deployment that does not sell to its users, a signed-in visitor still asks
 * (its billing account may buy); a refusal says what the server said. The
 * `?plan=` checkout waits for a settled answer: a cached failure that is being
 * fetched again does not use it up.
 */

const session = vi.hoisted(() => ({ user: null as { id: string } | null }))
const plansState = vi.hoisted(() => ({ value: { data: undefined, isPending: false, isLoading: false, isFetching: false, error: null } as Record<string, unknown> }))
const { mockUseBillingPlans, mockStartCheckout, mockToastError } = vi.hoisted(() => ({
  mockUseBillingPlans: vi.fn(),
  mockStartCheckout: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock("@/lib/edition", async (orig) => ({ ...(await orig<typeof import("@/lib/edition")>()), hasCredits: () => true }))
vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: session.user, loading: false }) }))
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => ({ surface: {}, isLoading: false }) }))
vi.mock("@/ee/hooks/queries/use-billing-queries", () => ({
  useSubscription: () => ({ data: undefined, isLoading: false }),
  useChangePlanMutation: () => ({ mutateAsync: vi.fn() }),
  useBillingPlans: (...args: unknown[]) => {
    mockUseBillingPlans(...args)
    return plansState.value
  },
}))
vi.mock("@/ee/hooks/queries/use-credits-queries", () => ({ useUserCredits: () => ({ data: undefined }) }))
vi.mock("@/lib/checkout", () => ({ openStripePage: vi.fn(), startCheckout: mockStartCheckout, startLoadCheckout: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: mockToastError, success: vi.fn(), info: vi.fn() } }))
vi.mock("../topup-section", () => ({ TopupSection: () => null }))

import { BillingPlansError } from "@/lib/api"
import PricingPage from "../page"

const NOT_SELLING = { surface: { billing: { costTab: "inherit" as const, sidebarCard: "inherit" as const, selfServe: false } } }
const LISTED = {
  data: [
    {
      id: "basic",
      name: "Basic",
      prices: {
        monthly: { amount: 12, currency: "USD", priceId: "price_TestBasicM", credits: null },
        yearly: { amount: 120, currency: "USD", priceId: "price_TestBasicY", perMonth: 10, credits: null },
      },
      signupCredits: null,
      parallelism: 2,
      storageBytes: 1,
    },
  ],
  topUps: [],
  topUpRange: { min: 5, max: 500, currency: "USD" },
}

function pricingPage(path = "/pricing") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PricingPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  session.user = null
  plansState.value = { data: undefined, isPending: false, isLoading: false, isFetching: false, error: null }
  mockUseBillingPlans.mockReset()
  mockStartCheckout.mockReset()
  mockToastError.mockReset()
})

afterEach(() => {
  delete window.__NODARO_RUNTIME__
})

describe("the pricing page and the deployment's price list", () => {
  it("on a deployment that does not sell to its users, a signed-in visitor still asks (its billing account may buy)", () => {
    window.__NODARO_RUNTIME__ = NOT_SELLING
    session.user = { id: "u1" }
    pricingPage()
    expect(mockUseBillingPlans).toHaveBeenLastCalledWith({ when: true })
  })

  it("a guest there does not ask", () => {
    window.__NODARO_RUNTIME__ = NOT_SELLING
    pricingPage()
    expect(mockUseBillingPlans).toHaveBeenLastCalledWith({ when: false })
  })

  it("a refusal shows the server's own words, not a retry hint", () => {
    window.__NODARO_RUNTIME__ = NOT_SELLING
    session.user = { id: "u1" }
    plansState.value = {
      data: undefined,
      isPending: false,
      isLoading: false,
      isFetching: false,
      error: new BillingPlansError(403, "self_serve_disabled", "This deployment does not sell credits to its users."),
    }
    pricingPage()
    expect(screen.getAllByText("This deployment does not sell credits to its users.").length).toBeGreaterThan(0)
    expect(screen.queryByText("Purchasing isn't available right now. Try again in a moment.")).toBeNull()
  })

  it("the ?plan= checkout is not used up by a cached failure being fetched again: it opens once the list arrives", () => {
    session.user = { id: "u1" }
    plansState.value = { data: undefined, isPending: false, isLoading: false, isFetching: true, error: new BillingPlansError(503) }
    const { rerender } = pricingPage("/pricing?plan=basic")
    expect(mockToastError).not.toHaveBeenCalled()
    expect(mockStartCheckout).not.toHaveBeenCalled()
    plansState.value = { data: LISTED, isPending: false, isLoading: false, isFetching: false, error: null }
    rerender(
      <MemoryRouter initialEntries={["/pricing?plan=basic"]}>
        <PricingPage />
      </MemoryRouter>,
    )
    expect(mockStartCheckout).toHaveBeenCalledWith({ priceId: "price_TestBasicY", mode: "subscription" })
  })
})
