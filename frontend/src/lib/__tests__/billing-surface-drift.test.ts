import { describe, it, expect } from "vitest"
import { BILLING_SURFACE_DEFAULT } from "../billing-surface"

describe("billing surface frontend/backend contract", () => {
  it("the default mirrors the backend none projection", () => {
    expect(BILLING_SURFACE_DEFAULT).toEqual({
      contract: 2, providerId: "none", displayUnit: "usd",
      canReport: false, canQuote: false, canAccount: false, mountCostTab: false,
      deploymentPayer: false,
    })
  })
})
