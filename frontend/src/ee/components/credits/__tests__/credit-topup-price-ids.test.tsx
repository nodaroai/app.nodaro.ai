import { describe, it, expect, vi, beforeEach } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { TOPUP_PACKAGES } from "@/lib/pricing-data"

/**
 * A credit pack checks out only the price this deployment lists
 * (GET /v1/billing/plans). A pack the list names without a price, or a list
 * that is not here, says purchasing is unavailable, and never sends the display
 * table's live price id (which a deployment on Stripe's test mode cannot sell).
 */

const { mockStartCheckout, mockPlans } = vi.hoisted(() => ({
  mockStartCheckout: vi.fn(),
  mockPlans: { value: { data: undefined as unknown, isLoading: false } },
}))

vi.mock("@/lib/checkout", () => ({ startCheckout: mockStartCheckout, startLoadCheckout: vi.fn() }))
vi.mock("@/ee/hooks/queries/use-billing-queries", () => ({ useBillingPlans: () => mockPlans.value }))

import { CreditTopup } from "../CreditTopup"

const pack10 = TOPUP_PACKAGES.find((pkg) => pkg.credits === 3300)!
const LISTED = {
  data: [],
  topUps: TOPUP_PACKAGES.map((pkg) => ({
    id: `topup-${pkg.price}`,
    credits: pkg.credits,
    price: { amount: pkg.price, currency: "USD" },
    priceId: `price_Test${pkg.credits}`,
  })),
  topUpRange: { min: 5, max: 500, currency: "USD" },
}

function packButton(): HTMLButtonElement {
  return screen.getAllByRole("button").find((button) => button.textContent?.includes(`$${pack10.price}`)) as HTMLButtonElement
}

beforeEach(() => {
  mockStartCheckout.mockReset()
})

describe("CreditTopup: the price a pack checks out", () => {
  it("is the one the deployment lists", () => {
    mockPlans.value = { data: LISTED, isLoading: false }
    render(<CreditTopup />)
    fireEvent.click(packButton())
    expect(mockStartCheckout).toHaveBeenCalledWith({ priceId: "price_Test3300", mode: "payment" })
  })

  it("a pack listed without a price is unavailable, and never checks out the table's live id", () => {
    mockPlans.value = { data: { ...LISTED, topUps: LISTED.topUps.map((pack) => ({ ...pack, priceId: null })) }, isLoading: false }
    render(<CreditTopup />)
    expect(packButton().disabled).toBe(true)
    fireEvent.click(packButton())
    expect(mockStartCheckout).not.toHaveBeenCalled()
    expect(screen.getByText("Purchasing isn't available right now. Try again in a moment.")).toBeTruthy()
  })

  it("without the list (it could not be read), the same: unavailable, no live id sent", () => {
    mockPlans.value = { data: undefined, isLoading: false }
    render(<CreditTopup />)
    fireEvent.click(packButton())
    expect(mockStartCheckout).not.toHaveBeenCalled()
  })
})
