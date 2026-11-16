import { describe, it, expect } from "vitest"
import { isOneTimeGrantTier, subscriptionAllocation } from "../subscription-allocation"

/**
 * The Subscription bucket states an allocation ("x of y left", "resets
 * monthly", "used this cycle") only for a paid plan. A free or pay-as-you-go
 * account's credits are a one-time grant, whatever its balance — never "300
 * of 300", never "1,500 of 300".
 */
describe("subscriptionAllocation", () => {
  it("a free account never has an allocation, whatever its balance", () => {
    expect(subscriptionAllocation({ effectiveTier: "free", monthlyAllocation: 300 })).toBe(0)
  })

  it("pay-as-you-go never has one either", () => {
    expect(subscriptionAllocation({ effectiveTier: "payg", monthlyAllocation: 0 })).toBe(0)
  })

  it("a paid plan's monthly allocation is left as it is", () => {
    expect(subscriptionAllocation({ effectiveTier: "basic", monthlyAllocation: 4500 })).toBe(4500)
    expect(subscriptionAllocation({ effectiveTier: "pro", monthlyAllocation: 23000 })).toBe(23000)
  })

  it("no balance yet: 0", () => {
    expect(subscriptionAllocation(undefined)).toBe(0)
  })

  it("the one-time-grant tiers are free and pay-as-you-go", () => {
    expect(isOneTimeGrantTier("free")).toBe(true)
    expect(isOneTimeGrantTier("payg")).toBe(true)
    expect(isOneTimeGrantTier("basic")).toBe(false)
    expect(isOneTimeGrantTier(undefined)).toBe(false)
  })
})
