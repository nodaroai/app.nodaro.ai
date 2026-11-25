import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { useLocaleStore } from "@/lib/locale-store"
import type { SubscriptionInfo, UserBalance } from "@/lib/api"

/**
 * A scheduled cancellation drops the account to Free, which has no private
 * outputs: the server returns the setting to public then. The notice that
 * already announces the cancellation says so, for a person whose outputs are
 * private now, and only for them.
 */

vi.mock("@/lib/surface-selectors", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/surface-selectors")>()),
  surfaceBillingSelfServe: () => false,
}))

const { CurrentPlanCard, cancelResetsPrivateOutputs } = await import("../CurrentPlanCard")

const LINE = "After that, new outputs are public again. What you made while private stays private."

const balance = {
  total: 0,
  subscription: 0,
  topup: 0,
  dailySpent: 0,
  dailyLimit: null,
  monthlyAllocation: 0,
  tier: "pro",
  effectiveTier: "pro",
  features: {},
  periodEnd: "2026-12-01T00:00:00.000Z",
  appCreditsAllowance: 0,
} as UserBalance

const cancelling = {
  status: "active",
  cancel_at_period_end: true,
  cancel_at: null,
  current_period_end: "2026-12-01T00:00:00.000Z",
} as unknown as SubscriptionInfo

function planText(subscription: SubscriptionInfo | null, outputsPrivate?: boolean): string {
  const view = render(
    <MemoryRouter>
      <CurrentPlanCard
        balance={balance}
        subscription={subscription}
        subLoading={false}
        storageLimitBytes={undefined}
        onManageSubscription={() => {}}
        managePending={false}
        outputsPrivate={outputsPrivate}
      />
    </MemoryRouter>,
  )
  return view.container.textContent ?? ""
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "en" })
})
afterEach(() => cleanup())

describe("the scheduled-cancellation notice and private outputs", () => {
  it("tells a person whose outputs are private what happens to them", () => {
    const text = planText(cancelling, true)
    expect(text).toContain("You keep your plan and remaining credits until then.")
    expect(text).toContain(LINE)
  })

  it("says nothing about it to a person whose outputs are public", () => {
    expect(planText(cancelling, false)).not.toContain(LINE)
    expect(planText(cancelling)).not.toContain(LINE)
  })

  it("says nothing without a scheduled cancellation", () => {
    expect(planText(null, true)).not.toContain(LINE)
  })
})

describe("who is told", () => {
  it("only a private person on a plan that allows private outputs", () => {
    expect(cancelResetsPrivateOutputs({ publicOutputs: false, privateOutputsAllowed: true })).toBe(true)
    // Private on Basic from before the rule: the cancellation resets nothing.
    expect(cancelResetsPrivateOutputs({ publicOutputs: false, privateOutputsAllowed: false })).toBe(false)
    expect(cancelResetsPrivateOutputs({ publicOutputs: false })).toBe(false)
    expect(cancelResetsPrivateOutputs({ publicOutputs: true, privateOutputsAllowed: true })).toBe(false)
    expect(cancelResetsPrivateOutputs(undefined)).toBe(false)
  })
})
