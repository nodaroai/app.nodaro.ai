import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

/**
 * The Get Credits dialog's purchases take their Stripe price from the
 * deployment's list (GET /v1/billing/plans). The list is asked for only while
 * the dialog is open: it is mounted, closed, on every published app and
 * presentation. While the list is loading, unreadable or names no price, the
 * buttons are disabled and say so; none of them shows as loading.
 */

const { mockUseBillingPlans, mockStartCheckout } = vi.hoisted(() => ({
  mockUseBillingPlans: vi.fn(),
  mockStartCheckout: vi.fn(),
}))

vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => true,
}))
vi.mock("@/ee/hooks/queries/use-billing-queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ee/hooks/queries/use-billing-queries")>()),
  useBillingPlans: (...args: unknown[]) => mockUseBillingPlans(...args),
}))
vi.mock("@/lib/checkout", () => ({ startCheckout: mockStartCheckout }))

import { GetCreditsModal } from "../GetCreditsModal"

beforeEach(() => {
  mockUseBillingPlans.mockReset()
  mockStartCheckout.mockReset()
})

describe("GetCreditsModal and the deployment's price list", () => {
  it("asks for the list only while it is open", () => {
    mockUseBillingPlans.mockReturnValue({ data: undefined, isLoading: false })
    const { rerender } = render(<GetCreditsModal open={false} onClose={() => {}} tier="free" balance={0} required={10} />)
    expect(mockUseBillingPlans).toHaveBeenLastCalledWith({ when: false })
    rerender(<GetCreditsModal open onClose={() => {}} tier="free" balance={0} required={10} />)
    expect(mockUseBillingPlans).toHaveBeenLastCalledWith({ when: true })
  })

  it("with no price listed, nothing shows as loading: the purchases are disabled and say why", () => {
    mockUseBillingPlans.mockReturnValue({ data: undefined, isLoading: false })
    render(<GetCreditsModal open onClose={() => {}} tier="free" balance={0} required={10} />)
    expect(document.body.querySelector(".animate-spin")).toBeNull()
    const subscribe = screen.getAllByRole("button", { name: "Subscribe" }) as HTMLButtonElement[]
    expect(subscribe.length).toBeGreaterThan(0)
    for (const button of subscribe) expect(button.disabled).toBe(true)
    expect(screen.getAllByText("Purchasing isn't available right now. Try again in a moment.").length).toBeGreaterThan(0)
  })
})
