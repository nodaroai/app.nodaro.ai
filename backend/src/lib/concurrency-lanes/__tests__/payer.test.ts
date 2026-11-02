// The payer line a job counts in: from its billing context, or — for a child
// payload that carries none — from its jobs row.
import { describe, expect, it } from "vitest"
import { payloadBillingContext, type BillingContext } from "../../billing-context.js"
import { lineOfBillingContext, payerKeyOf, payerOfRow } from "../payer.js"

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

describe("lineOfBillingContext", () => {
  const deployment = (tierForGates: string | undefined): BillingContext => ({
    payer: "deployment",
    userId: "u1",
    payerId: "p1",
    entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates } as never,
  })

  it.each([
    ["no context (no billing service): the personal line, tier read from the account", undefined, { payer: "user:u1", tier: null }],
    ["a personal context: the personal line, tier read from the account", { payer: "user", userId: "u1" } as BillingContext, { payer: "user:u1", tier: null }],
    ["a degraded personal context: still the personal line", { payer: "user", userId: "u1", degraded: true } as BillingContext, { payer: "user:u1", tier: null }],
    ["a workspace context: its line, at its entitlement grade", workspaceCtx, { payer: "workspace:w1", tier: "business" }],
    ["a deployment context: the payer's line, at the payer's grade", deployment("standard"), { payer: "deployment:p1", tier: "standard" }],
    ["a deployment context with no grade: the payer's line, tier left to the sizer", deployment(undefined), { payer: "deployment:p1", tier: null }],
  ])("%s", (_name, ctx, expected) => {
    expect(lineOfBillingContext("u1", ctx)).toEqual({ userId: "u1", ...expected })
  })
})
