// @test-units-by-name names no node type: it reads a user's balance and app-run eligibility under a deployment payer
/**
 * Plan entitlements under a deployment payer (decided 2026-11-08).
 *
 * Every user on a payer deployment is stored on the free tier while the payer
 * account holds the plan. A covered user's plan is the payer account's grade
 * (`payerCoverage`, lib/deployment-payer.ts). It gets that grade's terms: no
 * free-tier semantics, no app-credit allowance and no daily cap, exactly as at
 * the spend sites (`applyOrgEntitlements`). Billing is unchanged.
 *
 * What these pin, for the two CreditsService answers that read a user's own row:
 *  - `getBalance`: the PLAN fields report the payer's grade (stored form in
 *    `tier`, grade in `effectiveTier`, the grade's `features`, no daily cap).
 *    The FIGURES stay the user's own: balance, allocation and period. A payg
 *    payer reads as `free` / `payg`.
 *  - `checkAppRunEligibility`: allowed under any payer, its own grade free
 *    included, with no query.
 *  - Without a payer both are exactly as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => {
  const TODAY = new Date().toISOString().slice(0, 10)
  const state = {
    /** The requester's own profile row: stored free, as every user under a payer is. */
    profile: {
      subscription_credits: 0,
      topup_credits: 0,
      tier: "free",
      subscription_tier: "free",
      lifetime_topup_credits: 0,
      daily_spent_credits: 7,
      last_daily_reset: TODAY,
      current_period_end: null,
      app_credits_allowance: 0,
    } as Record<string, unknown>,
    /** Each `tier_config` row, by tier. */
    tierConfig: {
      free: { daily_credit_limit: 50, monthly_credits: 0, features: { watermark: true } },
      business: { daily_credit_limit: 5000, monthly_credits: 20000, features: { private_outputs: true } },
      payg: { daily_credit_limit: null, monthly_credits: 0, features: { payg: true } },
    } as Record<string, unknown>,
    tables: [] as string[],
  }
  const from = vi.fn((table: string) => {
    state.tables.push(table)
    let tier: string | undefined
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "order", "limit", "update", "upsert", "in", "neq"]) chain[m] = () => chain
    chain.eq = (col: string, val: unknown) => {
      if (col === "tier") tier = String(val)
      return chain
    }
    const answer = () =>
      table === "tier_config"
        ? { data: state.tierConfig[tier ?? ""] ?? null, error: null }
        : table === "profiles"
          ? { data: state.profile, error: null }
          : { data: null, error: { code: "PGRST116" } }
    chain.single = async () => answer()
    chain.maybeSingle = async () => answer()
    chain.then = (resolve: (v: unknown) => void) => resolve({ data: null, error: null })
    return chain
  })
  return { state, from }
})

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: h.from, rpc: vi.fn(async () => ({ data: null, error: null })), auth: { getUser: vi.fn() } } }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }) }))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

import { CreditsService } from "../credits.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "@/lib/deployment-payer.js"

const PAYER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const USER = "00000000-0000-4000-8000-000000000001"

beforeEach(() => {
  h.state.tables.length = 0
  h.from.mockClear()
  h.state.profile = { ...h.state.profile, tier: "free", subscription_tier: "free", lifetime_topup_credits: 0, topup_credits: 0, app_credits_allowance: 0 }
})
afterEach(() => __resetDeploymentPayerForTests())

describe("getBalance under a deployment payer", () => {
  it("the plan fields report the payer's grade; the figures stay the user's own", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "business" })
    const balance = await CreditsService.getBalance(USER)
    expect(balance.tier).toBe("business")
    expect(balance.effectiveTier).toBe("business")
    expect(balance.features).toEqual({ private_outputs: true })
    // Deployment work is never day-capped (applyOrgEntitlements' deployment branch).
    expect(balance.dailyLimit).toBeNull()
    // The user's own figures, never the payer's plan figures.
    expect(balance.total).toBe(0)
    expect(balance.dailySpent).toBe(7)
    expect(balance.monthlyAllocation).toBe(0)
    expect(balance.periodEnd).toBeNull()
  })

  it("a payg payer reads as free in `tier` (payg is never stored) and payg in `effectiveTier`", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "payg" })
    const balance = await CreditsService.getBalance(USER)
    expect(balance.tier).toBe("free")
    expect(balance.effectiveTier).toBe("payg")
    expect(balance.features).toEqual({ payg: true })
    expect(balance.dailyLimit).toBeNull()
  })

  it("a free payer reads as free, with no daily cap either (free semantics are off under any payer)", async () => {
    __setDeploymentPayerForTests(PAYER, { tierForGates: "free" })
    const balance = await CreditsService.getBalance(USER)
    expect(balance.tier).toBe("free")
    expect(balance.effectiveTier).toBe("free")
    expect(balance.dailyLimit).toBeNull()
  })

  it("without a payer, the user's own tier, features and daily limit, as before", async () => {
    const free = await CreditsService.getBalance(USER)
    expect(free.tier).toBe("free")
    expect(free.effectiveTier).toBe("free")
    expect(free.features).toEqual({ watermark: true })
    // A business-plan user keeps the plan's daily limit: the null above is the payer's override.
    h.state.profile = { ...h.state.profile, tier: "business", subscription_tier: "business" }
    const business = await CreditsService.getBalance(USER)
    expect(business.effectiveTier).toBe("business")
    expect(business.dailyLimit).toBe(5000)
  })
})

describe("checkAppRunEligibility under a deployment payer", () => {
  it("allowed, with no query, on a paid payer and on a free one", async () => {
    for (const tierForGates of ["business", "free"]) {
      __setDeploymentPayerForTests(PAYER, { tierForGates })
      h.state.tables.length = 0
      expect(await CreditsService.checkAppRunEligibility(USER)).toEqual({ allowed: true })
      expect(h.state.tables).toEqual([])
    }
  })

  it("without a payer, a free user with no app credits is refused, as before", async () => {
    const result = await CreditsService.checkAppRunEligibility(USER)
    expect(result.allowed).toBe(false)
    expect(result.error).toContain("app credits")
  })
})
