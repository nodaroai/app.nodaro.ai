import { describe, it, expect, vi, beforeEach } from "vitest"
import type { BillingContext } from "@/lib/billing-context.js"

/**
 * An agent's Render final is checked against the payer's balance BEFORE its
 * execution row exists (decided 2026-10-06): otherwise the first node of the
 * run set is charged and the render then fails at its own reservation, and
 * the user pays for a run that cannot finish. The check is balance-only —
 * model availability, daily caps and allowances stay with each node's own
 * preflight in the executor.
 */

const h = vi.hoisted(() => ({
  profile: null as Record<string, unknown> | null,
  profileId: undefined as string | undefined,
  credits: true,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => {
      const chain = {
        select: () => chain,
        eq: (_col: string, id: string) => {
          h.profileId = id
          return chain
        },
        single: async () => (h.profile ? { data: h.profile, error: null } : { data: null, error: { code: "PGRST116" } }),
      }
      return chain
    }),
    rpc: vi.fn(),
  },
}))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/config.js")>()),
  hasCredits: () => h.credits,
}))

import { checkRunSetCredits } from "../credits.js"

const PERSONAL = {
  tier: "basic",
  subscription_tier: "basic",
  lifetime_topup_credits: 0,
  subscription_credits: 40,
  topup_credits: 10,
}

const WORKSPACE: BillingContext = {
  payer: "workspace",
  userId: "u1",
  workspaceId: "ws-1",
  orgId: "org-1",
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

const DEPLOYMENT: BillingContext = {
  payer: "deployment",
  userId: "u1",
  payerId: "operator",
  entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" },
}

beforeEach(() => {
  h.profile = { ...PERSONAL }
  h.profileId = undefined
  h.credits = true
})

describe("checkRunSetCredits", () => {
  it("a personal payer short of the run is refused, with what it needs and what it has", async () => {
    const check = await checkRunSetCredits("u1", 530, { billingContext: { payer: "user", userId: "u1" } })
    expect(check).toMatchObject({ sufficient: false, required: 530, available: 50 })
    expect(check.message).toContain("530")
    expect(h.profileId).toBe("u1")
  })

  it("a personal payer who can cover it passes", async () => {
    expect(await checkRunSetCredits("u1", 50, {})).toMatchObject({ sufficient: true, required: 50, available: 50 })
  })

  it("the consumer surface spends a pay-as-you-go account's free pool only", async () => {
    h.profile = { ...PERSONAL, tier: "free", subscription_tier: null, lifetime_topup_credits: 500, subscription_credits: 20, topup_credits: 500 }
    expect(await checkRunSetCredits("u1", 100, { webFreeMode: true })).toMatchObject({ sufficient: false, available: 20 })
    expect(await checkRunSetCredits("u1", 100, { webFreeMode: false })).toMatchObject({ sufficient: true, available: 520 })
  })

  it("a workspace payer is not refused on a personal balance: the budget's headroom is the reservation's", async () => {
    h.profile = { ...PERSONAL, subscription_credits: 0, topup_credits: 0 }
    expect(await checkRunSetCredits("u1", 530, { billingContext: WORKSPACE })).toEqual({
      sufficient: true,
      required: 530,
      available: null,
    })
  })

  it("a deployment payer is checked on the operator's pool, and that pool is never shown", async () => {
    const check = await checkRunSetCredits("u1", 530, { billingContext: DEPLOYMENT })
    expect(h.profileId).toBe("operator")
    expect(check).toMatchObject({ sufficient: false, required: 530, available: null })
    expect(check.message).toBe("This deployment is out of credits. Contact your administrator.")
  })

  it("without a credit system nothing is refused", async () => {
    h.credits = false
    expect(await checkRunSetCredits("u1", 530, {})).toEqual({ sufficient: true, required: 530, available: null })
  })

  it("a payer profile that cannot be read throws rather than letting the run through", async () => {
    h.profile = null
    await expect(checkRunSetCredits("u1", 530, {})).rejects.toThrow()
  })
})
