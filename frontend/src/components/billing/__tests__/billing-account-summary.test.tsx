import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { BillingAccountSummary } from "../billing-account-summary"
import type { BillingAccount } from "@/lib/billing-surface"

const subset: BillingAccount = { plan: "pro", balance: 42, dailyAllowance: 100, unit: "credits" }

const rich: BillingAccount = {
  plan: "payg", balance: 1200, dailyAllowance: null, unit: "credits",
  periodStart: "2026-08-01T00:00:00.000Z", generations: 42,
  spent: { amount: 12.5, currency: "ILS" },
  payg: { enabled: true, reserve: 300, rate: { creditsPerUnit: 100, currency: "ILS" }, monthlyCap: { amount: 200, currency: "ILS" } },
  daily: { limit: 500, used: 120, remaining: 380, resetsAt: "2026-08-26T21:00:00.000Z" },
  reserveValue: { amount: 3, currency: "ILS" },
  byCategory: [
    { category: "image", count: 30, amount: 300, spent: { amount: 3, currency: "ILS" } },
    { category: "video", count: 12, amount: 900, spent: null },
  ],
}

describe("BillingAccountSummary", () => {
  it("renders the plan and balance for a subset-only account and omits rich sections", () => {
    render(<BillingAccountSummary account={subset} />)
    expect(screen.getByText("pro")).toBeInTheDocument()
    // Both equal cards headline the balance when there is no spend figure.
    expect(screen.getAllByText("42").length).toBeGreaterThan(0)
    // No PAYG / breakdown sections when the data is absent.
    expect(screen.queryByText("Breakdown")).not.toBeInTheDocument()
    expect(screen.queryByText("Reserve")).not.toBeInTheDocument()
  })

  it("renders PAYG money, daily cap and a category breakdown for a rich account", () => {
    render(<BillingAccountSummary account={rich} />)
    expect(screen.getByText("payg")).toBeInTheDocument()
    expect(screen.getByText("Breakdown")).toBeInTheDocument()
    expect(screen.getByText("Image")).toBeInTheDocument()
    expect(screen.getByText("Video")).toBeInTheDocument()
    // spent money is shown via Intl (contains the amount)
    expect(screen.getByText(/12\.5|12\.50/)).toBeInTheDocument()
  })

  it("shows a daily limit of 0 as blocked, never as 'no limit'", () => {
    const blocked: BillingAccount = { ...subset, daily: { limit: 0, used: 0, remaining: 0, resetsAt: "2026-08-26T21:00:00.000Z" } }
    render(<BillingAccountSummary account={blocked} />)
    expect(screen.getByText("Not included")).toBeInTheDocument()
    expect(screen.queryByText("No daily limit")).not.toBeInTheDocument()
  })

  it("renders the spend hero as an em-dash when generations and balance are both null, never 0", () => {
    // A spend-only PAYG authority reports what was spent but no generation count or balance.
    const spendOnly: BillingAccount = {
      plan: "payg", balance: null, dailyAllowance: null, unit: "credits",
      generations: null, spent: { amount: 12.5, currency: "ILS" },
    }
    render(<BillingAccountSummary account={spendOnly} />)
    expect(screen.getAllByText("—").length).toBeGreaterThan(0)
    expect(screen.queryByText("0")).toBeNull()
  })

  it("labels the plan pill with the localized 'Plan' label", () => {
    render(<BillingAccountSummary account={subset} />)
    expect(screen.getByText("pro")).toHaveAttribute("title", "Plan")
  })

  it("renders a null category amount as an em-dash, never 0", () => {
    const onlyNull: BillingAccount = {
      ...subset,
      byCategory: [{ category: "video", count: 3, amount: null, spent: null }],
    }
    render(<BillingAccountSummary account={onlyNull} />)
    expect(screen.getByText("—")).toBeInTheDocument()
  })
})
