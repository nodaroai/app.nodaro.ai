import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const useBillingSurface = vi.fn()
const useBillingAccount = vi.fn()
vi.mock("@/hooks/use-billing-surface", () => ({ useBillingSurface: () => useBillingSurface() }))
vi.mock("@/hooks/use-billing-account", () => ({ useBillingAccount: (e: boolean) => useBillingAccount(e) }))

import UsagePage from "../page"

describe("UsagePage", () => {
  beforeEach(() => { useBillingSurface.mockReset(); useBillingAccount.mockReset() })

  it("renders the rich summary when a provider answers", () => {
    useBillingSurface.mockReturnValue({ surface: { canAccount: true, displayUnit: "credits" }, isLoading: false })
    useBillingAccount.mockReturnValue({
      account: { plan: "payg", balance: 1200, dailyAllowance: null, unit: "credits", byCategory: [] },
      isLoading: false, isError: false,
    })
    render(<UsagePage />)
    expect(screen.getByText("payg")).toBeInTheDocument()
  })

  it("shows an unavailable state (never zeros) when the authority returns null", () => {
    useBillingSurface.mockReturnValue({ surface: { canAccount: true, displayUnit: "credits" }, isLoading: false })
    useBillingAccount.mockReturnValue({ account: null, isLoading: false, isError: false })
    render(<UsagePage />)
    expect(screen.getByText("Unavailable")).toBeInTheDocument()
  })

  it("does not query the account when the deployment has no account authority", () => {
    useBillingSurface.mockReturnValue({ surface: { canAccount: false, displayUnit: "usd" }, isLoading: false })
    useBillingAccount.mockReturnValue({ account: null, isLoading: false, isError: false })
    render(<UsagePage />)
    expect(useBillingAccount).toHaveBeenCalledWith(false)
  })
})
