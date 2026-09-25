// Whether a model may be run at all — the decision the credit guard's preflight
// (`checkCreditsWithProfile`) and the UGC quote share. What these pin:
//   1. The guard's outcomes, exactly (`toStrictEqual`: the error strings, and
//      whether a `watermark` key is present at all), for every payer — personal
//      free / payg / payg-on-web-free / pro, workspace, deployment — and the
//      order of the three refusals: disabled, then tier, then the free-tier
//      blocklist. These are the byte-identity proof for the refactor that moved
//      the blocklist into the shared helper.
//   2. The shared helpers themselves: the refusal, the gates a spend check
//      decides under, and whose profile it reads them from.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  function createChain(response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
    }
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(tableResponses.get(table) ?? null))
  return { mockFrom, tableResponses }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) },
}))
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))
vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => true,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))
vi.mock("../auto-recharge.js", () => ({ attemptAutoRecharge: vi.fn() }))

import { CreditsService, invalidateModelPricingCache, type CreditProfile } from "../credits.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const todayUTC = new Date().toISOString().slice(0, 10)

const WS_CTX: BillingContext = {
  payer: "workspace",
  userId: "user-123",
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

const DEP_CTX: BillingContext = {
  payer: "deployment",
  userId: "user-123",
  payerId: "payer-1",
  entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" },
}

function profile(over: Partial<CreditProfile> = {}): CreditProfile {
  return {
    tier: "free",
    subscription_tier: null,
    lifetime_topup_credits: 0,
    subscription_credits: 500,
    topup_credits: 0,
    daily_spent_credits: 0,
    last_daily_reset: todayUTC,
    app_credits_allowance: 0,
    ...over,
  } as CreditProfile
}
const FREE = profile()
const PAYG = profile({ lifetime_topup_credits: 500, topup_credits: 500 })
const PRO = profile({ tier: "pro", subscription_tier: "pro" })

function pricing(over: Partial<{ is_enabled: boolean; tier_restriction: string | null }> = {}): void {
  tableResponses.set("model_pricing", { data: { credit_cost: 5, is_enabled: true, tier_restriction: null, ...over }, error: null })
}

const check = (p: CreditProfile, model: string, surface: Parameters<typeof CreditsService.checkCreditsWithProfile>[5] = {}) =>
  CreditsService.checkCreditsWithProfile("user-123", p, model, false, undefined, surface)

const DISABLED = { allowed: false, error: "This model is currently disabled" }
const tierRefusal = (tier: string, watermark: boolean) => ({
  allowed: false,
  error: `This model requires ${tier} tier or higher. Please upgrade your plan.`,
  watermark,
})
const BLOCKED = {
  allowed: false,
  error: "This model requires a paid subscription. Upgrade to Basic or higher.",
  watermark: true,
}

beforeEach(() => {
  tableResponses.clear()
  mockFrom.mockClear()
  invalidateModelPricingCache()
})

describe("the guard's preflight — outcomes pinned exactly", () => {
  describe("personal free", () => {
    it("a disabled model: the admin switch, with no watermark key", async () => {
      pricing({ is_enabled: false })
      expect(await check(FREE, "flux")).toStrictEqual(DISABLED)
    })
    it("a model restricted above free: the tier refusal, watermarked", async () => {
      pricing({ tier_restriction: "basic" })
      expect(await check(FREE, "flux")).toStrictEqual(tierRefusal("basic", true))
    })
    it("a blocklisted model: the paid-subscription refusal, watermarked", async () => {
      pricing()
      expect(await check(FREE, "veo3.1")).toStrictEqual(BLOCKED)
      expect(await check(FREE, "gemini-omni-video:4k:8")).toStrictEqual(BLOCKED)
    })
    it("the order: disabled beats tier beats the blocklist", async () => {
      pricing({ is_enabled: false, tier_restriction: "basic" })
      expect(await check(FREE, "veo3.1")).toStrictEqual(DISABLED)
      invalidateModelPricingCache()
      pricing({ tier_restriction: "basic" })
      expect(await check(FREE, "veo3.1")).toStrictEqual(tierRefusal("basic", true))
    })
    it("an unblocked model passes", async () => {
      pricing()
      expect((await check(FREE, "flux")).allowed).toBe(true)
    })
  })

  describe("personal payg", () => {
    it("off a web-free surface: not free-tier work, so the blocklist does not apply — but basic-and-up still refuses", async () => {
      pricing()
      expect((await check(PAYG, "veo3.1")).allowed).toBe(true)
      invalidateModelPricingCache()
      pricing({ tier_restriction: "basic" })
      expect(await check(PAYG, "flux")).toStrictEqual(tierRefusal("basic", false))
    })
    it("on a web-free surface: free-tier semantics, the blocklist refuses", async () => {
      pricing()
      expect(await check(PAYG, "veo3.1", { webFreeMode: true })).toStrictEqual(BLOCKED)
    })
  })

  describe("personal pro", () => {
    it("the blocklist never applies; a business-only model is refused, unwatermarked", async () => {
      pricing()
      expect((await check(PRO, "veo3.1")).allowed).toBe(true)
      invalidateModelPricingCache()
      pricing({ tier_restriction: "business" })
      expect(await check(PRO, "flux")).toStrictEqual(tierRefusal("business", false))
    })
  })

  describe("workspace payer — the org grade decides", () => {
    it("a free member's class run may use a blocklisted and a business-only model", async () => {
      pricing()
      expect((await check(FREE, "veo3.1", { billingContext: WS_CTX })).allowed).toBe(true)
      invalidateModelPricingCache()
      pricing({ tier_restriction: "business" })
      expect((await check(FREE, "flux", { billingContext: WS_CTX })).allowed).toBe(true)
    })
    it("a disabled model is still refused, with no watermark key", async () => {
      pricing({ is_enabled: false })
      expect(await check(FREE, "flux", { billingContext: WS_CTX })).toStrictEqual(DISABLED)
    })
  })

  describe("deployment payer — the payer's grade decides", () => {
    it("the blocklist is off (never free-tier work), whatever the profile in hand", async () => {
      pricing()
      expect((await check(FREE, "veo3.1", { billingContext: DEP_CTX })).allowed).toBe(true)
    })
    it("a restriction at the payer's grade passes; one above it is refused, unwatermarked", async () => {
      pricing({ tier_restriction: "basic" })
      expect((await check(FREE, "flux", { billingContext: DEP_CTX })).allowed).toBe(true)
      invalidateModelPricingCache()
      pricing({ tier_restriction: "pro" })
      expect(await check(PRO, "flux", { billingContext: DEP_CTX })).toStrictEqual(tierRefusal("pro", false))
    })
  })
})

describe("the shared helpers", () => {
  it("modelAvailabilityRefusal: disabled, then tier, then the blocklist under free-tier semantics", async () => {
    const { modelAvailabilityRefusal } = await import("../model-availability.js")
    const open = { isEnabled: true, tierRestriction: null }
    const free = { tierForGates: "free", freeSemantics: true }
    const pro = { tierForGates: "pro", freeSemantics: false }
    expect(modelAvailabilityRefusal("flux", { isEnabled: false, tierRestriction: "pro" }, free)).toStrictEqual({
      reason: "disabled",
      error: "This model is currently disabled",
    })
    expect(modelAvailabilityRefusal("veo3.1", { isEnabled: true, tierRestriction: "basic" }, free)).toStrictEqual({
      reason: "tier",
      error: "This model requires basic tier or higher. Please upgrade your plan.",
    })
    expect(modelAvailabilityRefusal("veo3.1", open, free)).toStrictEqual({
      reason: "blocked",
      error: "This model requires a paid subscription. Upgrade to Basic or higher.",
    })
    expect(modelAvailabilityRefusal("veo3.1", open, pro)).toBeNull()
    // free tier gates without free semantics (a workspace grade can say so) — the blocklist is off
    expect(modelAvailabilityRefusal("veo3.1", open, { tierForGates: "free", freeSemantics: false })).toBeNull()
    expect(modelAvailabilityRefusal("flux", open, free)).toBeNull()
  })

  it("the blocklist is the stripe-config list, matched exactly", async () => {
    const { modelAvailabilityRefusal } = await import("../model-availability.js")
    const { FREE_TIER_RESTRICTIONS } = await import("../stripe-config.js")
    const free = { tierForGates: "free", freeSemantics: true }
    for (const id of FREE_TIER_RESTRICTIONS.blockedModels) {
      expect(modelAvailabilityRefusal(id, { isEnabled: true, tierRestriction: null }, free)?.reason).toBe("blocked")
    }
    expect(modelAvailabilityRefusal("veo3.1:1080p", { isEnabled: true, tierRestriction: null }, free)).toBeNull()
  })

  it("modelAvailabilityNeedsGates is false only where no gates can change the answer", async () => {
    const { modelAvailabilityNeedsGates, modelAvailabilityRefusal, TIER_ORDER } = await import("../model-availability.js")
    const allGates = TIER_ORDER.flatMap((tierForGates) => [true, false].map((freeSemantics) => ({ tierForGates, freeSemantics })))
    const rows = [true, false].flatMap((isEnabled) => [null, ...TIER_ORDER].map((tierRestriction) => ({ isEnabled, tierRestriction })))
    for (const id of ["flux", "veo3.1", "gemini-omni-flash:4k:vref"]) {
      for (const row of rows) {
        const answers = new Set(allGates.map((g) => JSON.stringify(modelAvailabilityRefusal(id, row, g))))
        if (!modelAvailabilityNeedsGates(id, row)) expect(answers.size, `${id} ${JSON.stringify(row)}`).toBe(1)
      }
    }
    expect(modelAvailabilityNeedsGates("flux", { isEnabled: true, tierRestriction: null })).toBe(false)
    expect(modelAvailabilityNeedsGates("veo3.1", { isEnabled: false, tierRestriction: null })).toBe(false)
    expect(modelAvailabilityNeedsGates("veo3.1", { isEnabled: true, tierRestriction: null })).toBe(true)
    expect(modelAvailabilityNeedsGates("flux", { isEnabled: true, tierRestriction: "pro" })).toBe(true)
  })

  it("spendGates: the preflight's derivation — payg rides free semantics only on a web-free surface; a context's grade wins", async () => {
    const { spendGates, effectiveTierOf } = await import("../org-entitlements.js")
    expect(effectiveTierOf(PAYG)).toBe("payg")
    expect(spendGates("payg", {})).toMatchObject({ tierForGates: "payg", freeSemantics: false })
    expect(spendGates("payg", { webFreeMode: true })).toMatchObject({ tierForGates: "free", freeSemantics: true })
    expect(spendGates("pro", { webFreeMode: true })).toMatchObject({ tierForGates: "pro", freeSemantics: false })
    expect(spendGates("free", { billingContext: WS_CTX })).toMatchObject({ tierForGates: "business", freeSemantics: false })
    expect(spendGates("free", { billingContext: DEP_CTX })).toMatchObject({ tierForGates: "basic", freeSemantics: false })
  })

  it("payerProfileId: a deployment context reads the payer's profile; every other payer the requester's", async () => {
    const { payerProfileId } = await import("../org-entitlements.js")
    expect(payerProfileId("user-123", DEP_CTX)).toBe("payer-1")
    expect(payerProfileId("user-123", WS_CTX)).toBe("user-123")
    expect(payerProfileId("user-123", { payer: "user", userId: "user-123" })).toBe("user-123")
    expect(payerProfileId("user-123", undefined)).toBe("user-123")
  })
})
