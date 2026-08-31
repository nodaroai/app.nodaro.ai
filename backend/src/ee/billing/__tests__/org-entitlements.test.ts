// P14/W4a+W4b — the workspace payer's entitlement override at BOTH spend
// sites (preflight + reservation), and family 0's `p_workspace_id` threading.
//
// The flagship scenario these pin: a ZERO-BALANCE free-tier member doing
// class work is neither refused for a personal balance they don't need, nor
// watermarked, nor tier-blocked, nor day-capped — and the moment the context
// is absent (or degraded), every one of those personal gates is back,
// verbatim. The "stays personal" controls are as load-bearing as the
// workspace cells: they are what protects every existing user of every
// edition with the flag off.
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockRpc, tableResponses, insertCalls, mockAttemptAutoRecharge } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const insertCalls: Array<{ table: string; row: Record<string, unknown> }> = []

  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      neq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockImplementation((row: Record<string, unknown>) => {
        insertCalls.push({ table, row })
        return chain
      }),
      update: vi.fn().mockReturnThis(),
    }
    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) =>
    createChain(table, tableResponses.get(table) ?? null),
  )
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockAttemptAutoRecharge = vi.fn().mockResolvedValue(undefined)

  return { mockFrom, mockRpc, tableResponses, insertCalls, mockAttemptAutoRecharge }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, auth: { getUser: vi.fn() }, rpc: mockRpc },
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

vi.mock("../auto-recharge.js", () => ({
  attemptAutoRecharge: mockAttemptAutoRecharge,
}))

import { CreditsService, invalidateModelPricingCache, type CreditProfile } from "../credits.js"
import { applyOrgEntitlements } from "../org-entitlements.js"
import type { BillingContext } from "../../../lib/billing-context.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

const DEGRADED_CTX: BillingContext = { payer: "user", userId: "user-123", degraded: true }

const todayUTC = new Date().toISOString().slice(0, 10)

/** A free-tier member with NOTHING in the personal pockets. */
function zeroBalanceFreeProfile(): CreditProfile {
  return {
    tier: "free",
    subscription_tier: null,
    lifetime_topup_credits: 0,
    subscription_credits: 0,
    topup_credits: 0,
    daily_spent_credits: 0,
    last_daily_reset: todayUTC,
    app_credits_allowance: 0,
  } as CreditProfile
}

function mockTable(table: string, data: unknown, error: unknown = null): void {
  tableResponses.set(table, { data, error })
}

function mockPricing(overrides?: Partial<{ credit_cost: number; is_enabled: boolean; tier_restriction: string | null }>): void {
  mockTable("model_pricing", {
    credit_cost: 5,
    is_enabled: true,
    tier_restriction: null,
    ...overrides,
  })
}

beforeEach(() => {
  tableResponses.clear()
  insertCalls.length = 0
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockRpc.mockResolvedValue({ data: null, error: null })
  mockAttemptAutoRecharge.mockClear()
  invalidateModelPricingCache()
})

// ---------------------------------------------------------------------------
// The helper itself
// ---------------------------------------------------------------------------

describe("applyOrgEntitlements", () => {
  it("personal free tier: pre-P14 derivation, verbatim", () => {
    const g = applyOrgEntitlements({ userTier: "free", webFree: false })
    expect(g).toEqual({
      workspacePayer: false,
      tierForGates: "free",
      webFree: false,
      freeSemantics: true,
      personalBalance: true,
      appAllowance: true,
      dailyCapOff: false,
      watermarkable: true,
    })
  })

  it("personal payg on a web-free surface rides free semantics", () => {
    const g = applyOrgEntitlements({ userTier: "payg", webFree: true })
    expect(g.tierForGates).toBe("free")
    expect(g.freeSemantics).toBe(true)
    expect(g.webFree).toBe(true)
    expect(g.watermarkable).toBe(true)
  })

  it("personal paid tier: gates keyed on the real tier", () => {
    const g = applyOrgEntitlements({ userTier: "pro", webFree: false })
    expect(g.tierForGates).toBe("pro")
    expect(g.freeSemantics).toBe(false)
    expect(g.watermarkable).toBe(false)
    expect(g.personalBalance).toBe(true)
  })

  it("workspace payer: every gate reads the entitlement grade", () => {
    const g = applyOrgEntitlements({ userTier: "free", webFree: true }, WS_CTX)
    expect(g).toEqual({
      workspacePayer: true,
      tierForGates: "business",
      webFree: false,
      freeSemantics: false,
      personalBalance: false,
      appAllowance: false,
      dailyCapOff: true,
      watermarkable: false,
    })
  })

  it("a DEGRADED personal fallback behaves exactly personal — never a stealth workspace", () => {
    const g = applyOrgEntitlements({ userTier: "free", webFree: false }, DEGRADED_CTX)
    expect(g.workspacePayer).toBe(false)
    expect(g.personalBalance).toBe(true)
    expect(g.watermarkable).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Site 1: checkCreditsWithProfile (the guard's preflight)
// ---------------------------------------------------------------------------

describe("checkCreditsWithProfile — workspace payer override", () => {
  it("FLAGSHIP: a zero-balance free member doing class work passes preflight, unwatermarked", async () => {
    mockPricing()
    const result = await CreditsService.checkCreditsWithProfile(
      "user-123",
      zeroBalanceFreeProfile(),
      "flux",
      false,
      undefined,
      { billingContext: WS_CTX },
    )
    expect(result.allowed).toBe(true)
    expect(result.watermark).toBe(false)
  })

  it("CONTROL: the same member without a context stays refused (personal balance rules)", async () => {
    mockPricing()
    const result = await CreditsService.checkCreditsWithProfile(
      "user-123",
      zeroBalanceFreeProfile(),
      "flux",
      false,
      undefined,
      {},
    )
    expect(result.allowed).toBe(false)
    expect(result.error).toContain("Insufficient credits")
    expect(result.watermark).toBe(true)
  })

  it("a DEGRADED personal fallback is refused like any personal caller", async () => {
    mockPricing()
    const result = await CreditsService.checkCreditsWithProfile(
      "user-123",
      zeroBalanceFreeProfile(),
      "flux",
      false,
      undefined,
      { billingContext: DEGRADED_CTX },
    )
    expect(result.allowed).toBe(false)
  })

  it("tierRestriction gates on the ORG grade for a workspace payer, the personal tier otherwise", async () => {
    mockPricing({ tier_restriction: "pro" })
    const withCtx = await CreditsService.checkCreditsWithProfile(
      "user-123", zeroBalanceFreeProfile(), "flux", false, undefined, { billingContext: WS_CTX },
    )
    expect(withCtx.allowed).toBe(true)

    invalidateModelPricingCache()
    mockPricing({ tier_restriction: "pro" })
    const withoutCtx = await CreditsService.checkCreditsWithProfile(
      "user-123", zeroBalanceFreeProfile(), "flux", false, undefined, {},
    )
    expect(withoutCtx.allowed).toBe(false)
    expect(withoutCtx.error).toContain("requires pro tier")
  })

  it("the free-tier model blocklist is off for class work", async () => {
    mockPricing()
    const withCtx = await CreditsService.checkCreditsWithProfile(
      "user-123",
      { ...zeroBalanceFreeProfile(), subscription_credits: 500 } as CreditProfile,
      "veo3",
      false,
      undefined,
      { billingContext: WS_CTX },
    )
    expect(withCtx.allowed).toBe(true)

    const withoutCtx = await CreditsService.checkCreditsWithProfile(
      "user-123",
      { ...zeroBalanceFreeProfile(), subscription_credits: 500 } as CreditProfile,
      "veo3",
      false,
      undefined,
      {},
    )
    expect(withoutCtx.allowed).toBe(false)
    expect(withoutCtx.error).toContain("paid subscription")
  })

  it("the paid-tier daily cap does not bind class work (and its reads are skipped)", async () => {
    mockPricing()
    mockTable("tier_config", { daily_credit_limit: 10, monthly_credits: 23000, features: {} })
    const proProfile = {
      ...zeroBalanceFreeProfile(),
      tier: "pro",
      subscription_credits: 1000,
      daily_spent_credits: 100,
    } as CreditProfile

    const withoutCtx = await CreditsService.checkCreditsWithProfile(
      "user-123", proProfile, "flux", false, undefined, {},
    )
    expect(withoutCtx.allowed).toBe(false)
    expect(withoutCtx.error).toContain("Daily credit limit reached")

    const withCtx = await CreditsService.checkCreditsWithProfile(
      "user-123", proProfile, "flux", false, undefined, { billingContext: WS_CTX },
    )
    expect(withCtx.allowed).toBe(true)
    expect(withCtx.dailyLimit).toBeUndefined()
    expect(withCtx.dailySpent).toBeUndefined()
  })

  it("the app-allowance economy does not bind class app runs", async () => {
    mockPricing()
    const result = await CreditsService.checkCreditsWithProfile(
      "user-123",
      { ...zeroBalanceFreeProfile(), subscription_credits: 500, app_credits_allowance: 0 } as CreditProfile,
      "flux",
      true, // isAppRun
      undefined,
      { billingContext: WS_CTX },
    )
    expect(result.allowed).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Site 2: reserveCredits (family 0 — the one line that talks to the RPC)
// ---------------------------------------------------------------------------

describe("reserveCredits — workspace payer threading", () => {
  function mockReserveOk(): void {
    mockPricing()
    mockTable("profiles", {
      tier: "free",
      subscription_tier: null,
      lifetime_topup_credits: 0,
      subscription_credits: 0,
      topup_credits: 0,
    })
    mockRpc.mockResolvedValue({ data: "usage-log-ws", error: null })
  }

  it("threads p_workspace_id, kills the personal daily cap and web-free mode", async () => {
    mockReserveOk()
    const result = await CreditsService.reserveCredits(
      "user-123", "job-1", "flux", 0.05, 0.0625,
      { billingContext: WS_CTX, webFreeMode: true },
    )
    expect(mockRpc).toHaveBeenCalledWith("reserve_credits", expect.objectContaining({
      p_user_id: "user-123",
      p_workspace_id: "ws-1",
      p_daily_limit: null,
      p_web_free_mode: false,
    }))
    expect(result.watermark).toBe(false)
  })

  it("BYTE-IDENTICAL personal wire shape: no p_workspace_id key without a workspace context", async () => {
    mockReserveOk()
    await CreditsService.reserveCredits("user-123", "job-1", "flux", 0.05, 0.0625, {})
    const args = mockRpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args).not.toHaveProperty("p_workspace_id")
  })

  it("writes an ORG-shaped ledger row and never reads the personal balance", async () => {
    mockReserveOk()
    const logSpy = vi.spyOn(CreditsService, "logTransaction").mockResolvedValue(true)
    try {
      await CreditsService.reserveCredits(
        "user-123", "job-1", "flux", 0.05, 0.0625, { billingContext: WS_CTX },
      )
      expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({
        creditType: "org",
        source: "org_usage",
        workspaceId: "ws-1",
        orgId: "org-1",
        amount: -5,
        // The personal balance did not move; 0 matches the RPC's own org-row
        // convention (migration 351 omits the column → default).
        balanceAfter: 0,
      }))
      // The tier fetch is the ONLY profiles read — the post-RPC balance
      // fetch is skipped for a workspace payer.
      const profileReads = mockFrom.mock.calls.filter(([t]) => t === "profiles").length
      expect(profileReads).toBe(1)
    } finally {
      logSpy.mockRestore()
    }
  })

  it("never fires auto-recharge for a workspace payer — class work must not pump a member's card", async () => {
    mockReserveOk()
    await CreditsService.reserveCredits(
      "user-123", "job-1", "flux", 0.05, 0.0625, { billingContext: WS_CTX },
    )
    expect(mockAttemptAutoRecharge).not.toHaveBeenCalled()

    await CreditsService.reserveCredits("user-123", "job-2", "flux", 0.05, 0.0625, {})
    expect(mockAttemptAutoRecharge).toHaveBeenCalledTimes(1)
  })

  it("an explicit watermarkOverride cannot watermark class work", async () => {
    mockReserveOk()
    const result = await CreditsService.reserveCredits(
      "user-123", "job-1", "flux", 0.05, 0.0625,
      { billingContext: WS_CTX, watermarkOverride: true },
    )
    expect(result.watermark).toBe(false)
  })

  it("zero-cost path: payer recorded in METADATA ONLY; entitlements stay PERSONAL (no override without payment)", async () => {
    mockPricing({ credit_cost: 0 })
    mockTable("profiles", {
      tier: "free",
      subscription_tier: null,
      lifetime_topup_credits: 0,
    })
    mockTable("usage_logs", { id: "log-zero" })

    const result = await CreditsService.reserveCredits(
      "user-123", "job-1", "free-model", 0, 0, { billingContext: WS_CTX },
    )

    expect(mockRpc).not.toHaveBeenCalled()
    const insert = insertCalls.find((c) => c.table === "usage_logs")
    // The TOP-LEVEL columns must stay absent: commit_credits/refund_credits
    // dispatch on usage_logs.workspace_id (migration 351), and this
    // reservation never passed a workspace guard — a stamped column would
    // let a later metered commit debit the workspace budget unauthorized.
    expect(insert?.row).not.toHaveProperty("workspace_id")
    expect(insert?.row).not.toHaveProperty("org_id")
    expect(insert?.row.metadata).toMatchObject({
      payer: { kind: "workspace", workspace_id: "ws-1", org_id: "org-1" },
    })
    // Free-tier member: the zero-cost result is still watermarked — the
    // RPC's workspace guards never ran, so nothing was paid for the upgrade.
    expect(result.watermark).toBe(true)
  })

  it("a DEGRADED personal fallback reserves personally — no workspace keys, auto-recharge fires", async () => {
    // Guards the payer test itself: `payer === "workspace"` (never a truthy
    // check) is what keeps a failed resolve from threading p_workspace_id.
    mockReserveOk()
    await CreditsService.reserveCredits(
      "user-123", "job-1", "flux", 0.05, 0.0625, { billingContext: DEGRADED_CTX },
    )
    const args = mockRpc.mock.calls[0]?.[1] as Record<string, unknown>
    expect(args).not.toHaveProperty("p_workspace_id")
    expect(mockAttemptAutoRecharge).toHaveBeenCalledTimes(1)
  })

  it("a personal reserve writes a PERSONAL-shaped ledger row — no workspace keys, ever", async () => {
    mockReserveOk()
    mockTable("usage_logs", { metadata: { from_sub: 5, from_topup: 0 } })
    await CreditsService.reserveCredits("user-123", "job-1", "flux", 0.05, 0.0625, {})
    const row = insertCalls.find((c) => c.table === "credit_transactions")?.row
    expect(row).toBeDefined()
    expect(row).not.toHaveProperty("workspace_id")
    expect(row).not.toHaveProperty("org_id")
    expect(row).toMatchObject({ credit_type: "subscription", source: "usage" })
  })

  it("zero-cost path for a personal payer is byte-identical to pre-P14 (no workspace keys)", async () => {
    mockPricing({ credit_cost: 0 })
    mockTable("profiles", { tier: "free", subscription_tier: null, lifetime_topup_credits: 0 })
    mockTable("usage_logs", { id: "log-zero" })

    await CreditsService.reserveCredits("user-123", "job-1", "free-model", 0, 0, {})

    const insert = insertCalls.find((c) => c.table === "usage_logs")
    expect(insert?.row).not.toHaveProperty("workspace_id")
    expect(insert?.row).not.toHaveProperty("org_id")
    expect((insert?.row.metadata as Record<string, unknown>)).not.toHaveProperty("payer")
  })
})

describe("applyOrgEntitlements — deployment payer (SAI item 9)", () => {
  const DEP_CTX: BillingContext = {
    payer: "deployment",
    userId: "req-1",
    payerId: "payer-acct",
    entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "pro" },
  }

  it("the payer's grade replaces the requester's: tier gates at the payer, caps and watermark off", () => {
    // A free-tier requester under a pro-grade payer: what the gates say is
    // the PAYER's entitlement, and the free-tier semantics disappear —
    // deployment work is prepaid class work.
    const g = applyOrgEntitlements({ userTier: "free", webFree: true }, DEP_CTX)
    expect(g).toEqual({
      workspacePayer: false,
      tierForGates: "pro",
      webFree: false,
      freeSemantics: false,
      // TRUE deliberately: the balance that gates the run is the PAYER's
      // personal pool (the guard fetches that profile) — unlike a workspace
      // budget whose ceiling lives in the RPC.
      personalBalance: true,
      appAllowance: false,
      dailyCapOff: true,
      watermarkable: false,
    })
  })

  it("no context stays byte-equivalent to the personal derivation (the inert invariant)", () => {
    expect(applyOrgEntitlements({ userTier: "free", webFree: false })).toEqual(
      applyOrgEntitlements({ userTier: "free", webFree: false }, undefined),
    )
  })
})
