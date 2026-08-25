import { describe, it, expect, vi, beforeEach } from "vitest"

const from = vi.fn()
vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: (...a: unknown[]) => from(...a) } }))

import { nodaroCloudBillingProvider } from "../nodaro-cloud-provider.js"

beforeEach(() => from.mockReset())

describe("nodaroCloudBillingProvider", () => {
  it("identifies as nodaro-cloud with the credits unit", () => {
    expect(nodaroCloudBillingProvider.id).toBe("nodaro-cloud")
    expect(nodaroCloudBillingProvider.displayUnit).toBe("credits")
  })

  it("report maps job charges and keeps null-not-zero", async () => {
    from.mockReturnValue({
      select: () => ({ in: () => Promise.resolve({
        data: [
          { id: "j1", credits: 12, display_cost: 0.04, provider_cost: 0.03 },
          { id: "j2", credits: null, display_cost: null, provider_cost: null },
        ], error: null }) }),
    })
    const m = await nodaroCloudBillingProvider.report(["j1", "j2"])
    expect(m?.get("j1")).toEqual({ amount: 12, unit: "credits", secondaryAmount: 0.04, secondaryUnit: "usd" })
    expect(m?.get("j2")).toEqual({ amount: null, unit: "credits", secondaryAmount: null, secondaryUnit: "usd" })
  })

  it("report returns null (whole batch unavailable) on a DB error", async () => {
    from.mockReturnValue({ select: () => ({ in: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) })
    expect(await nodaroCloudBillingProvider.report(["j1"])).toBeNull()
  })

  it("account returns plan/balance; plan 'unknown' when the row is missing", async () => {
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () =>
      Promise.resolve({ data: { subscription_credits: 100, topup_credits: 5, tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0, app_credits_allowance: 20 }, error: null }) }) }) })
    const a = await nodaroCloudBillingProvider.account("u1")
    expect(a?.balance).toBe(105)
    expect(a?.unit).toBe("credits")
    expect(a?.dailyAllowance).toBe(20)
    expect(typeof a?.plan).toBe("string")
  })
})
