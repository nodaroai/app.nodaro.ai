// The payer line a job counts in: from its billing context, or — for a child
// payload that carries none — from its jobs row.
import { describe, expect, it } from "vitest"
import { payloadBillingContext, type BillingContext } from "../../billing-context.js"
import { payerKeyOf, payerOfRow } from "../payer.js"

const workspaceCtx: BillingContext = {
  payer: "workspace",
  userId: "u1",
  workspaceId: "w1",
  orgId: "o1",
  memberCap: null,
  entitlements: {
    watermark: false,
    dailyCapCredits: null,
    parallelism: 12,
    tierForGates: "business",
    freeTierBlocklist: false,
    webFreeMode: false,
    appCreditsAllowance: false,
  },
}

describe("payerKeyOf", () => {
  it("a personal context is the user's own line", () => {
    expect(payerKeyOf({ payer: "user", userId: "u1" })).toBe("user:u1")
  })

  it("a degraded personal context is still the user's own line", () => {
    expect(payerKeyOf({ payer: "user", userId: "u1", degraded: true })).toBe("user:u1")
  })

  it("a workspace context is the workspace's line", () => {
    expect(payerKeyOf(workspaceCtx)).toBe("workspace:w1")
  })

  it("a deployment context is the payer account's line", () => {
    expect(payerKeyOf({
      payer: "deployment",
      userId: "u1",
      payerId: "p1",
      entitlements: { watermark: false, dailyCapCredits: null, parallelism: 12, tierForGates: "business" },
    })).toBe("deployment:p1")
  })

  it("an absent context (a payload without the field) is personal", () => {
    expect(payerKeyOf(payloadBillingContext({ userId: "u1" }))).toBe("user:u1")
  })
})

describe("payerOfRow", () => {
  it("payerOfRow maps a workspace row to the business-sized workspace line", () => {
    expect(payerOfRow({ user_id: "u1", workspace_id: "w1" })).toEqual({ payer: "workspace:w1", tier: "business" })
  })

  it("a row with no workspace is the personal line, its tier left to the caller", () => {
    expect(payerOfRow({ user_id: "u1", workspace_id: null })).toEqual({ payer: "user:u1", tier: null })
  })
})
