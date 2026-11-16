import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import type { UserBalance } from "@/lib/api"

/**
 * The billing page for a free or pay-as-you-go account: its credits are a
 * one-time grant, whatever its balance. The Subscription bucket never reads
 * "resets monthly", "x of y left" or "N used this cycle", and the plan card
 * never calls the free plan's credits "per month". A paid plan keeps all of it.
 */

vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => false,
}))
vi.mock("../BuyPacksSection", () => ({ BuyPacksSection: () => null }))
vi.mock("@/ee/components/credits/AutoRechargeCard", () => ({ AutoRechargeCard: () => null }))

const { CreditBalanceCard } = await import("../CreditBalanceCard")
const { CurrentPlanCard } = await import("../CurrentPlanCard")

function balance(overrides: Partial<UserBalance>): UserBalance {
  return {
    total: 0,
    subscription: 0,
    topup: 0,
    dailySpent: 0,
    dailyLimit: null,
    monthlyAllocation: 0,
    tier: "free",
    effectiveTier: "free",
    features: {},
    periodEnd: null,
    appCreditsAllowance: 0,
    ...overrides,
  }
}

function bucketText(b: UserBalance): string {
  const view = render(<CreditBalanceCard balance={b} creditsLoading={false} transactions={[]} showAutoRecharge={false} />)
  return view.container.textContent ?? ""
}

function planText(b: UserBalance): string {
  const view = render(
    <MemoryRouter>
      <CurrentPlanCard balance={b} subscription={null} subLoading={false} storageLimitBytes={undefined} onManageSubscription={() => {}} managePending={false} />
    </MemoryRouter>,
  )
  return view.container.textContent ?? ""
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" })
})
afterEach(() => cleanup())

describe("the Subscription bucket on the free tiers", () => {
  it.each([
    ["a free account holding the 300 grant", balance({ total: 300, subscription: 300, monthlyAllocation: 300 })],
    ["a free account holding an earlier 1,500 grant", balance({ total: 1500, subscription: 1500, monthlyAllocation: 300 })],
    ["a free account that spent part of it", balance({ total: 120, subscription: 120, monthlyAllocation: 300 })],
    ["a pay-as-you-go account", balance({ total: 900, subscription: 100, topup: 800, monthlyAllocation: 0, effectiveTier: "payg" })],
  ])("%s: a one-time grant — no 'resets monthly', no 'x of y', no 'used this cycle'", (_label, b) => {
    const text = bucketText(b)
    expect(text).toMatch(/one-time grant/i)
    expect(text).not.toMatch(/resets monthly/i)
    expect(text).not.toMatch(/of [\d,]+ left/i)
    expect(text).not.toMatch(/[\d,]+ used this cycle/i)
    expect(text).toMatch(/No monthly allocation/)
  })

  it("a paid plan still reads its monthly allocation", () => {
    const text = bucketText(balance({ total: 3000, subscription: 3000, monthlyAllocation: 4500, tier: "basic", effectiveTier: "basic" }))
    expect(text).toMatch(/resets monthly/i)
    expect(text).toMatch(/of 4,500 left/)
    expect(text).toMatch(/1,500 used this cycle/)
  })
})

describe("the plan card's credits line", () => {
  it.each([
    ["a free account holding the 300 grant", balance({ total: 300, subscription: 300, monthlyAllocation: 300 })],
    ["a free account holding an earlier 1,500", balance({ total: 1500, subscription: 1500, monthlyAllocation: 300 })],
    ["a former subscriber who never had a grant", balance({ total: 0, subscription: 0, monthlyAllocation: 300 })],
    ["a pay-as-you-go account", balance({ total: 800, topup: 800, monthlyAllocation: 0, effectiveTier: "payg" })],
  ])("%s: 'One-time grant' with no figure — never 'per month', never a number that reads as its own", (_label, b) => {
    const text = planText(b)
    expect(text).toMatch(/CreditsOne-time grant/)
    expect(text).not.toMatch(/Credits \/ month/)
    expect(text).not.toMatch(/\b300\b|1,500/)
  })

  it("a paid plan: credits per month, with its figure", () => {
    const text = planText(balance({ monthlyAllocation: 4500, tier: "basic", effectiveTier: "basic" }))
    expect(text).toMatch(/Credits \/ month4,500/)
    expect(text).not.toMatch(/One-time grant/)
  })
})
