import { describe, it, expect, vi, beforeEach } from "vitest"

// checkCredits matrix {free, payg, basic} × {watermark, blocked model,
// tierRestriction} — design 2026-07-05 §9. The payg row is the point:
// clean output, premium models unlocked, but an admin "basic and up"
// tier_restriction still excludes payg (TIER_ORDER ranks it below basic).

const { mockFrom, mockRpc, tableResponses } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  let lastMatchedResponse: { data: unknown; error: unknown } | null = null

  function createChain() {
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() =>
        Promise.resolve(lastMatchedResponse ?? { data: null, error: { code: "PGRST116" } })
      ),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => {
    lastMatchedResponse = tableResponses.get(table) ?? null
    return createChain()
  })

  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  return { mockFrom, mockRpc, tableResponses }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
  calculateDisplayCost: vi.fn((c: number) => c),
}))

vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual, hasCredits: () => true }
})

vi.mock("@/ee/lib/free-video-config.js", () => ({
  getFreeVideoLimits: vi.fn().mockResolvedValue({ enabled: true, maxSeconds: 4 }),
}))

import { CreditsService, type CreditProfile } from "../credits.js"

const FREE: CreditProfile = {
  tier: "free",
  subscription_tier: null,
  lifetime_topup_credits: 0,
  subscription_credits: 1500,
  topup_credits: 0,
  daily_spent_credits: 0,
  last_daily_reset: new Date().toISOString(),
}

const PAYG: CreditProfile = {
  ...FREE,
  lifetime_topup_credits: 3300,
  subscription_credits: 0,
  topup_credits: 3300,
}

const BASIC: CreditProfile = {
  ...FREE,
  tier: "basic",
  subscription_credits: 4500,
}

function mockPricing(row: Record<string, unknown> | null) {
  tableResponses.set(
    "model_pricing",
    row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } }
  )
}

beforeEach(() => {
  tableResponses.clear()
  tableResponses.set("tier_config", {
    data: { daily_credit_limit: null, monthly_credits: 0, features: {} },
    error: null,
  })
})

describe("checkCredits matrix — watermark", () => {
  it("free is watermarked; payg and basic are clean", async () => {
    mockPricing({ credit_cost: 10, is_enabled: true, tier_restriction: null })
    const free = await CreditsService.checkCreditsWithProfile("u1", FREE, "flux")
    const payg = await CreditsService.checkCreditsWithProfile("u2", PAYG, "flux")
    const basic = await CreditsService.checkCreditsWithProfile("u3", BASIC, "flux")
    expect(free.watermark).toBe(true)
    expect(payg.watermark).toBe(false)
    expect(basic.watermark).toBe(false)
  })
})

describe("checkCredits matrix — free-tier blocked models", () => {
  it("veo3 is blocked for free, allowed for payg and basic", async () => {
    mockPricing({ credit_cost: 250, is_enabled: true, tier_restriction: null })
    const free = await CreditsService.checkCreditsWithProfile("u1", FREE, "veo3")
    const payg = await CreditsService.checkCreditsWithProfile("u2", PAYG, "veo3")
    const basic = await CreditsService.checkCreditsWithProfile("u3", BASIC, "veo3")
    expect(free.allowed).toBe(false)
    expect(payg.allowed).toBe(true)
    expect(basic.allowed).toBe(true)
  })
})

describe("checkCredits matrix — admin tier_restriction", () => {
  it("a 'basic and up' restriction blocks free AND payg, allows basic", async () => {
    // Distinct model id — getModelPricing caches per model across calls.
    mockPricing({ credit_cost: 10, is_enabled: true, tier_restriction: "basic" })
    const free = await CreditsService.checkCreditsWithProfile("u1", FREE, "flux-restricted")
    const payg = await CreditsService.checkCreditsWithProfile("u2", PAYG, "flux-restricted")
    const basic = await CreditsService.checkCreditsWithProfile("u3", BASIC, "flux-restricted")
    expect(free.allowed).toBe(false)
    expect(payg.allowed).toBe(false)
    expect(basic.allowed).toBe(true)
  })
})

describe("checkCredits — the free-credit video limits", () => {
  it("free credits may not run Kling, a long clip or a high resolution; payg and basic may", async () => {
    mockPricing({ credit_cost: 100, is_enabled: true, tier_restriction: null })
    const kling = { video: { provider: "kling-3.0", duration: 7, resolution: "1080P" } }
    expect((await CreditsService.checkCreditsWithProfile("u1", FREE, "kling-3.0:10s", false, undefined, kling)).allowed).toBe(false)
    expect((await CreditsService.checkCreditsWithProfile("u2", PAYG, "kling-3.0:10s", false, undefined, kling)).allowed).toBe(true)
    expect((await CreditsService.checkCreditsWithProfile("u3", BASIC, "kling-3.0:10s", false, undefined, kling)).allowed).toBe(true)
  })

  it("anyone who ever bought credits is not limited, even spending its free pool on the web app", async () => {
    mockPricing({ credit_cost: 100, is_enabled: true, tier_restriction: null })
    const r = await CreditsService.checkCreditsWithProfile("u2", { ...PAYG, subscription_credits: 1500 }, "kling-3.0:10s:web", false, undefined, { webFreeMode: true, video: { provider: "kling-3.0", duration: 5 } })
    expect(r.allowed).toBe(true)
  })

  it("video upscaling is refused on free credits, also when the request names no provider (Topaz by default)", async () => {
    mockPricing({ credit_cost: 100, is_enabled: true, tier_restriction: null })
    expect((await CreditsService.checkCreditsWithProfile("u1", FREE, "topaz-video")).allowed).toBe(false)
    expect((await CreditsService.checkCreditsWithProfile("u1", FREE, "veo-4k")).allowed).toBe(false)
    expect((await CreditsService.checkCreditsWithProfile("u2", PAYG, "topaz-video")).allowed).toBe(true)
  })

  it("the default 4-second lowest-resolution run passes on free credits", async () => {
    mockPricing({ credit_cost: 100, is_enabled: true, tier_restriction: null })
    const r = await CreditsService.checkCreditsWithProfile("u1", FREE, "seedance-2-fast:4s:480p", false, undefined, { video: { provider: "seedance-2-fast", duration: 4, resolution: "480p" } })
    expect(r.allowed).toBe(true)
  })
})
