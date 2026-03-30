import { describe, it, expect, vi, beforeEach } from "vitest"
import { TIER_STORAGE_LIMITS } from "../stripe-config.js"

// ---------------------------------------------------------------------------
// Mocks — must use vi.hoisted() for variables referenced inside vi.mock()
// ---------------------------------------------------------------------------

const { mockFrom, mockRpc, tableResponses, getLastMatchedResponse, setLastMatchedResponse, mockHasCreditsRef } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  let lastMatchedResponse: { data: unknown; error: unknown } | null = null
  const mockHasCreditsRef = { value: true }

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

  return {
    mockFrom,
    mockRpc,
    tableResponses,
    getLastMatchedResponse: () => lastMatchedResponse,
    setLastMatchedResponse: (v: { data: unknown; error: unknown } | null) => { lastMatchedResponse = v },
    mockHasCreditsRef,
  }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: mockFrom,
    auth: { getUser: vi.fn() },
    rpc: mockRpc,
  },
}))

vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: vi.fn().mockResolvedValue({ ai_provider: "kie", cost_markup_percent: 0 }),
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud" },
  hasCredits: () => mockHasCreditsRef.value,
  isCloud: () => true,
  isCommunity: () => false,
  isBusiness: () => false,
  hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Import module under test (after mocks are registered)
// ---------------------------------------------------------------------------

import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import type { CreditProfile, StorageProfile } from "../credits.js"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Register a mock response for a supabase table query. */
function mockTable(table: string, data: unknown, error: unknown = null) {
  tableResponses.set(table, { data, error })
}

/** Clear all table mock responses and caches between tests. */
function resetMocks() {
  tableResponses.clear()
  setLastMatchedResponse(null)
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockHasCreditsRef.value = true
  invalidateModelPricingCache()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreditsService", () => {
  beforeEach(() => {
    resetMocks()
  })

  // ════════════════════════════════════════════════════════════════════════
  // estimateWorkflowCredits (pure static — no DB)
  // ════════════════════════════════════════════════════════════════════════

  describe("estimateWorkflowCredits", () => {
    it("returns 0 for an empty array", () => {
      expect(CreditsService.estimateWorkflowCredits([])).toBe(0)
    })

    it("returns correct cost for a known node type (generate-image)", () => {
      expect(CreditsService.estimateWorkflowCredits([{ type: "generate-image" }])).toBe(2)
    })

    it("returns correct cost for veo3", () => {
      expect(CreditsService.estimateWorkflowCredits([{ type: "veo3" }])).toBe(79)
    })

    it("returns 0 for an unknown node type", () => {
      expect(CreditsService.estimateWorkflowCredits([{ type: "totally-unknown" }])).toBe(0)
    })

    it("sums costs for mixed node types", () => {
      const nodes = [
        { type: "generate-image" },   // 2
        { type: "veo3" },             // 79
        { type: "text-to-speech" },   // 4
        { type: "ffmpeg" },           // 1
      ]
      expect(CreditsService.estimateWorkflowCredits(nodes)).toBe(86)
    })

    it("returns correct cost for FFmpeg nodes", () => {
      const nodes = [
        { type: "adjust-volume" },   // 1
        { type: "trim-video" },      // 1
        { type: "speed-ramp" },      // 2
        { type: "combine-videos" },  // 3
      ]
      expect(CreditsService.estimateWorkflowCredits(nodes)).toBe(7)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // checkStorageLimitWithProfile (sync — uses hasCredits)
  // ════════════════════════════════════════════════════════════════════════

  describe("checkStorageLimitWithProfile", () => {
    it("always allows when hasCredits() returns false", () => {
      mockHasCreditsRef.value = false
      const profile: StorageProfile = {
        tier: "free",
        storage_used_bytes: 999_999_999_999,
        storage_limit_bytes: 1,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.allowed).toBe(true)
      expect(result.limitBytes).toBe(Number.MAX_SAFE_INTEGER)
    })

    it("returns not allowed when used >= limit", () => {
      const limitBytes = 10 * 1024 * 1024 * 1024 // 10 GB
      const profile: StorageProfile = {
        tier: "basic",
        storage_used_bytes: limitBytes,
        storage_limit_bytes: limitBytes,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("Storage limit reached")
      expect(result.error).toContain("GB")
      expect(result.usedBytes).toBe(limitBytes)
      expect(result.limitBytes).toBe(limitBytes)
    })

    it("returns allowed when used < limit", () => {
      const profile: StorageProfile = {
        tier: "pro",
        storage_used_bytes: 1_000_000,
        storage_limit_bytes: 50 * 1024 * 1024 * 1024,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.allowed).toBe(true)
      expect(result.usedBytes).toBe(1_000_000)
    })

    it("falls back to tier limit when DB has the stale 524288000 default", () => {
      const profile: StorageProfile = {
        tier: "standard",
        storage_used_bytes: 0,
        storage_limit_bytes: 524288000, // stale 500MB default
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.allowed).toBe(true)
      // Should use tier limit (25 GB), not the stale 500MB
      expect(result.limitBytes).toBe(TIER_STORAGE_LIMITS.standard)
    })

    it("falls back to tier limit when storage_limit_bytes is 0", () => {
      const profile: StorageProfile = {
        tier: "basic",
        storage_used_bytes: 0,
        storage_limit_bytes: 0,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.limitBytes).toBe(TIER_STORAGE_LIMITS.basic)
    })

    it("falls back to tier limit when storage_limit_bytes is null", () => {
      const profile: StorageProfile = {
        tier: "pro",
        storage_used_bytes: 0,
        storage_limit_bytes: null,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.limitBytes).toBe(TIER_STORAGE_LIMITS.pro)
    })

    it("uses free tier limit when tier is null", () => {
      const profile: StorageProfile = {
        tier: null,
        storage_used_bytes: 0,
        storage_limit_bytes: null,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.limitBytes).toBe(TIER_STORAGE_LIMITS.free)
    })

    it("uses the DB limit when it is valid (not 0 and not 524288000)", () => {
      const customLimit = 15 * 1024 * 1024 * 1024 // 15 GB custom admin override
      const profile: StorageProfile = {
        tier: "basic",
        storage_used_bytes: 0,
        storage_limit_bytes: customLimit,
      }
      const result = CreditsService.checkStorageLimitWithProfile(profile)
      expect(result.limitBytes).toBe(customLimit)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // checkCreditsWithProfile (async — uses supabase mocks)
  // ════════════════════════════════════════════════════════════════════════

  describe("checkCreditsWithProfile", () => {
    const userId = "user-123"

    const paidProfile: CreditProfile = {
      tier: "pro",
      subscription_credits: 100,
      topup_credits: 50,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
    }

    const freeProfile: CreditProfile = {
      tier: "free",
      subscription_credits: 30,
      topup_credits: 10,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString(),
    }

    it("allows with 999999 balance when hasCredits() returns false", async () => {
      mockHasCreditsRef.value = false
      const result = await CreditsService.checkCreditsWithProfile(userId, freeProfile, "flux")
      expect(result.allowed).toBe(true)
      expect(result.balance).toBe(999999)
      expect(result.watermark).toBe(false)
    })

    it("returns not allowed when model is disabled", async () => {
      mockTable("model_pricing", {
        credit_cost: 5,
        is_enabled: false,
        tier_restriction: null,
      })

      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "disabled-model")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("disabled")
    })

    it("returns not allowed when tier restriction blocks lower tier", async () => {
      mockTable("model_pricing", {
        credit_cost: 10,
        is_enabled: true,
        tier_restriction: "pro",
      })

      const basicProfile: CreditProfile = {
        tier: "basic",
        subscription_credits: 100,
        topup_credits: 50,
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString(),
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, basicProfile, "premium-model")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("pro tier or higher")
    })

    it("returns not allowed for free-tier blocked models (veo3)", async () => {
      // model_pricing returns no row -> falls back to static costs
      mockTable("model_pricing", null, { code: "PGRST116" })

      const result = await CreditsService.checkCreditsWithProfile(userId, freeProfile, "veo3")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("paid subscription")
      expect(result.watermark).toBe(true)
    })

    it("returns not allowed when balance is insufficient", async () => {
      mockTable("model_pricing", {
        credit_cost: 200,
        is_enabled: true,
        tier_restriction: null,
      })

      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "expensive-model")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("Insufficient credits")
      expect(result.balance).toBe(150) // 100 + 50
      expect(result.required).toBe(200)
    })

    it("returns not allowed when free tier daily cap is exceeded", async () => {
      mockTable("model_pricing", {
        credit_cost: 1,
        is_enabled: true,
        tier_restriction: null,
      })

      const dailyCapProfile: CreditProfile = {
        tier: "free",
        subscription_credits: 50,
        topup_credits: 10,
        daily_spent_credits: 30, // already at cap of 30
        last_daily_reset: new Date().toISOString(), // today, so no reset
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, dailyCapProfile, "flux")
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("Daily credit limit reached")
      expect(result.dailyLimit).toBe(30)
      expect(result.dailySpent).toBe(30)
      expect(result.watermark).toBe(true)
    })

    it("allows paid tier with sufficient balance and no daily limit", async () => {
      mockTable("model_pricing", {
        credit_cost: 5,
        is_enabled: true,
        tier_restriction: null,
      })
      // tier_config returns no daily limit
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 530,
        features: {},
      })

      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "flux")
      expect(result.allowed).toBe(true)
      expect(result.balance).toBe(150) // 100 + 50
      expect(result.required).toBe(5)
      expect(result.watermark).toBe(false)
    })

    it("sets watermark=true for free tier", async () => {
      mockTable("model_pricing", {
        credit_cost: 1,
        is_enabled: true,
        tier_restriction: null,
      })

      const lowSpendFreeProfile: CreditProfile = {
        tier: "free",
        subscription_credits: 30,
        topup_credits: 10,
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString(),
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, lowSpendFreeProfile, "flux")
      expect(result.allowed).toBe(true)
      expect(result.watermark).toBe(true)
    })

    it("sets watermark=false for paid tier", async () => {
      mockTable("model_pricing", {
        credit_cost: 1,
        is_enabled: true,
        tier_restriction: null,
      })
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 95,
        features: {},
      })

      const basicProfile: CreditProfile = {
        tier: "basic",
        subscription_credits: 50,
        topup_credits: 10,
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString(),
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, basicProfile, "flux")
      expect(result.allowed).toBe(true)
      expect(result.watermark).toBe(false)
    })

    it("falls back to static credit cost when model_pricing has no row", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 530,
        features: {},
      })

      // "flux" has STATIC_CREDIT_COSTS["flux"] = 2
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "flux")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(2)
    })

    it("falls back to static cost for ideogram-v3 (2 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "ideogram-v3")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(2)
    })

    it("falls back to static cost for ideogram-v3:TURBO (1 credit)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "ideogram-v3:TURBO")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(1)
    })

    it("falls back to static cost for ideogram-v3:QUALITY (3 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "ideogram-v3:QUALITY")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(3)
    })

    it("falls back to static cost for kling-3.0-motion (38 credits, 10s default)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "kling-3.0-motion")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(38)
    })

    it("falls back to static cost for kling-3.0-motion:1080p (63 credits, 10s default)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "kling-3.0-motion:1080p")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(63)
    })

    it("falls back to static cost for topaz-image-upscale:4K (7 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "topaz-image-upscale:4K")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(7)
    })

    it("falls back to static cost for topaz-image-upscale:8K (13 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "topaz-image-upscale:8K")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(13)
    })

    it("falls back to static cost for suno-mashup (4 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-mashup")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(4)
    })

    it("falls back to static cost for suno-replace-section (2 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-replace-section")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(2)
    })

    it("falls back to static cost for suno-style-boost (1 credit)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-style-boost")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(1)
    })

    it("falls back to static cost for suno-add-instrumental (4 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-add-instrumental")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(4)
    })

    it("falls back to static cost for suno-add-vocals (4 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-add-vocals")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(4)
    })

    it("falls back to static cost for suno-convert-wav (1 credit)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-convert-wav")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(1)
    })

    it("falls back to static cost for suno-upload-extend (4 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "suno-upload-extend")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(4)
    })

    it("falls back to static cost for speech-to-video (4 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "speech-to-video")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(4)
    })

    it("falls back to static cost for speech-to-video:580p (6 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "speech-to-video:580p")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(6)
    })

    it("falls back to static cost for speech-to-video:720p (8 credits)", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "speech-to-video:720p")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(8)
    })

    it("uses subscription_tier when tier is missing", async () => {
      mockTable("model_pricing", {
        credit_cost: 1,
        is_enabled: true,
        tier_restriction: null,
      })
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 235,
        features: {},
      })

      const legacyProfile: CreditProfile = {
        tier: null,
        subscription_tier: "standard",
        subscription_credits: 100,
        topup_credits: 50,
        daily_spent_credits: 0,
        last_daily_reset: new Date().toISOString(),
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, legacyProfile as CreditProfile, "flux")
      expect(result.allowed).toBe(true)
      // Not free tier -> no watermark
      expect(result.watermark).toBe(false)
    })

    it("allows tier that meets the tier restriction", async () => {
      mockTable("model_pricing", {
        credit_cost: 5,
        is_enabled: true,
        tier_restriction: "standard",
      })
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 530,
        features: {},
      })

      // pro >= standard, so should be allowed
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "restricted-model")
      expect(result.allowed).toBe(true)
    })

    it("handles null credit columns gracefully", async () => {
      mockTable("model_pricing", {
        credit_cost: 0,
        is_enabled: true,
        tier_restriction: null,
      })
      mockTable("tier_config", {
        daily_credit_limit: null,
        monthly_credits: 530,
        features: {},
      })

      const nullProfile: CreditProfile = {
        tier: "pro",
        subscription_credits: null,
        topup_credits: null,
        daily_spent_credits: null,
        last_daily_reset: null,
      }

      const result = await CreditsService.checkCreditsWithProfile(userId, nullProfile, "free-model")
      expect(result.allowed).toBe(true)
      expect(result.balance).toBe(0)
    })

    it("blocks free tier on app run when no app credits allowance", async () => {
      mockTable("model_pricing", { credit_cost: 2, is_enabled: true, tier_restriction: null })
      const freeAppProfile: CreditProfile = {
        tier: "free", subscription_credits: 30, topup_credits: 0,
        daily_spent_credits: 0, last_daily_reset: new Date().toISOString(),
        app_credits_allowance: 0,
      }
      const result = await CreditsService.checkCreditsWithProfile(userId, freeAppProfile, "flux", true)
      expect(result.allowed).toBe(false)
      expect(result.error).toContain("Insufficient app credits")
      expect(result.appCreditsAllowance).toBe(0)
    })

    it("allows free tier app run when app credits allowance is sufficient", async () => {
      mockTable("model_pricing", { credit_cost: 2, is_enabled: true, tier_restriction: null })
      const freeAppProfile: CreditProfile = {
        tier: "free", subscription_credits: 30, topup_credits: 0,
        daily_spent_credits: 0, last_daily_reset: new Date().toISOString(),
        app_credits_allowance: 10,
      }
      const result = await CreditsService.checkCreditsWithProfile(userId, freeAppProfile, "flux", true)
      expect(result.allowed).toBe(true)
      expect(result.watermark).toBe(true)
    })

    it("skips app allowance check for free tier with topup credits", async () => {
      mockTable("model_pricing", { credit_cost: 2, is_enabled: true, tier_restriction: null })
      const freeWithTopup: CreditProfile = {
        tier: "free", subscription_credits: 10, topup_credits: 20,
        daily_spent_credits: 0, last_daily_reset: new Date().toISOString(),
        app_credits_allowance: 0,
      }
      const result = await CreditsService.checkCreditsWithProfile(userId, freeWithTopup, "flux", true)
      expect(result.allowed).toBe(true)
    })

    it("allows paid tier even with high daily spend (no daily cap for paid)", async () => {
      mockTable("model_pricing", { credit_cost: 10, is_enabled: true, tier_restriction: null })
      const paidDailyProfile: CreditProfile = {
        tier: "pro", subscription_credits: 500, topup_credits: 100,
        daily_spent_credits: 45, last_daily_reset: new Date().toISOString(),
      }
      const result = await CreditsService.checkCreditsWithProfile(userId, paidDailyProfile, "model")
      expect(result.allowed).toBe(true)
    })

    it("defaults to 1 credit for unknown model with no DB or static cost", async () => {
      mockTable("model_pricing", null, { code: "PGRST116" })
      mockTable("tier_config", { daily_credit_limit: null, monthly_credits: 530, features: {} })
      const result = await CreditsService.checkCreditsWithProfile(userId, paidProfile, "totally-unknown-model-xyz")
      expect(result.allowed).toBe(true)
      expect(result.required).toBe(1)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // estimateWorkflowCredits — composite model identifiers from node data
  // ════════════════════════════════════════════════════════════════════════

  describe("estimateWorkflowCredits with composite identifiers", () => {
    it("resolves gpt-image:high", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "gpt-image", quality: "high" } },
      ])).toBe(7)
    })

    it("resolves gpt-image with medium quality (base)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "gpt-image", quality: "medium" } },
      ])).toBe(4)
    })

    it("resolves flux:2K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "flux", resolution: "2K" } },
      ])).toBe(3)
    })

    it("resolves flux with 1K (base)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "flux", resolution: "1K" } },
      ])).toBe(2)
    })

    it("resolves nano-banana-2:2K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "nano-banana-2", resolution: "2K" } },
      ])).toBe(5)
    })

    it("resolves nano-banana-2:4K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "nano-banana-2", resolution: "4K" } },
      ])).toBe(7)
    })

    it("resolves nano-banana-pro:4K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "nano-banana-pro", resolution: "4K" } },
      ])).toBe(8)
    })

    it("resolves ideogram-edit:TURBO", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "image-to-image", data: { provider: "ideogram-edit", renderingSpeed: "TURBO" } },
      ])).toBe(4)
    })

    it("resolves ideogram-edit:QUALITY", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "image-to-image", data: { provider: "ideogram-edit", renderingSpeed: "QUALITY" } },
      ])).toBe(8)
    })

    it("resolves topaz-image-upscale:4K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "edit-image", data: { provider: "topaz-image-upscale", targetResolution: "4K" } },
      ])).toBe(7)
    })

    it("resolves topaz-image-upscale:8K", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "edit-image", data: { provider: "topaz-image-upscale", targetResolution: "8K" } },
      ])).toBe(13)
    })

    it("resolves topaz-image-upscale at default 2K (base)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "edit-image", data: { provider: "topaz-image-upscale", targetResolution: "2K" } },
      ])).toBe(4)
    })

    it("resolves seedream:high", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "seedream", quality: "high" } },
      ])).toBe(4)
    })

    it("resolves ai-writer directly", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "ai-writer", data: { provider: "claude" } },
      ])).toBe(5)
    })

    it("resolves suno-separate split_stem", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-separate", data: { type: "split_stem" } },
      ])).toBe(16)
    })

    it("resolves suno-separate default type", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-separate", data: { type: "separate" } },
      ])).toBe(5)
    })

    it("resolves suno-generate V5", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-generate", data: { model: "V5" } },
      ])).toBe(4)
    })

    it("resolves suno-generate V4", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-generate", data: { model: "V4" } },
      ])).toBe(4)
    })

    it("resolves suno-cover V5", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-cover", data: { model: "V5" } },
      ])).toBe(4)
    })

    it("resolves suno-lyrics (exempted from V5 check)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-lyrics", data: { model: "V5" } },
      ])).toBe(2)
    })

    it("resolves suno-music-video (exempted from V5 check)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "suno-music-video", data: { model: "V5" } },
      ])).toBe(5)
    })

    it("resolves extend-video veo-extend:quality", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "extend-video", data: { provider: "veo-extend", model: "quality" } },
      ])).toBe(79)
    })

    it("resolves extend-video veo-extend fast (base)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "extend-video", data: { provider: "veo-extend", model: "fast" } },
      ])).toBe(19)
    })

    it("resolves I2V kling-3.0:5s", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "image-to-video", data: { provider: "kling-3.0", duration: 5 } },
      ])).toBe(43)
    })

    it("resolves I2V kling-3.0:5s:audio", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "image-to-video", data: { provider: "kling-3.0", duration: 5, sound: true } },
      ])).toBe(63)
    })

    it("resolves T2V grok (override to grok-i2v)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "text-to-video", data: { provider: "grok" } },
      ])).toBe(5)
    })

    it("resolves T2V wan (override to wan-t2v)", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "text-to-video", data: { provider: "wan" } },
      ])).toBe(33)
    })

    it("resolves motion-transfer kling-3.0 1080p 5s", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "motion-transfer", data: { provider: "kling-3.0", resolution: "1080p", videoDuration: 5 } },
      ])).toBe(32)
    })

    it("resolves motion-transfer wan-animate-move 720p", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "motion-transfer", data: { provider: "wan-animate-move", resolution: "720p" } },
      ])).toBe(41)
    })

    it("resolves motion-transfer wan-animate-move default 480p", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "motion-transfer", data: { provider: "wan-animate-move", resolution: "480p" } },
      ])).toBe(26)
    })

    it("resolves I2V seedance:12s", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "image-to-video", data: { provider: "seedance", duration: 12 } },
      ])).toBe(15)
    })

    it("falls back for unknown provider", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: { provider: "future-provider" } },
      ])).toBe(2)
    })

    it("handles nodes with empty data object", () => {
      expect(CreditsService.estimateWorkflowCredits([
        { type: "generate-image", data: {} },
      ])).toBe(2)
    })

    it("sums mixed composite and simple nodes", () => {
      const nodes = [
        { type: "generate-image", data: { provider: "gpt-image", quality: "high" } }, // 7
        { type: "text-to-speech" },                                                     // 4
        { type: "image-to-video", data: { provider: "kling-3.0", duration: 10, sound: true } }, // 126
        { type: "suno-separate", data: { type: "split_stem" } },                        // 16
      ]
      expect(CreditsService.estimateWorkflowCredits(nodes)).toBe(153)
    })
  })

  // ════════════════════════════════════════════════════════════════════════
  // model pricing cache (TtlCache behavior)
  // ════════════════════════════════════════════════════════════════════════

  describe("model pricing cache", () => {
    it("returns cached result on second call without hitting DB", async () => {
      mockTable("model_pricing", { credit_cost: 5, is_enabled: true, tier_restriction: null })
      const cost1 = await CreditsService.getModelCreditCost("cache-test-model")
      tableResponses.clear()
      const cost2 = await CreditsService.getModelCreditCost("cache-test-model")
      expect(cost1).toBe(5)
      expect(cost2).toBe(5)
    })

    it("returns fresh data after cache invalidation", async () => {
      mockTable("model_pricing", { credit_cost: 5, is_enabled: true, tier_restriction: null })
      const cost1 = await CreditsService.getModelCreditCost("invalidate-test")
      expect(cost1).toBe(5)
      invalidateModelPricingCache()
      mockTable("model_pricing", { credit_cost: 10, is_enabled: true, tier_restriction: null })
      const cost2 = await CreditsService.getModelCreditCost("invalidate-test")
      expect(cost2).toBe(10)
    })
  })
})
