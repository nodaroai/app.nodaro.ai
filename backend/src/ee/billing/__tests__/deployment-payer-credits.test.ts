/**
 * Deployment payer (SAI item 9) at the RESERVATION — what these pin:
 * the debit user becomes the PAYER account (`p_user_id`) while the
 * positional requester keeps the job; the requester is stamped into
 * `usage_logs.on_behalf_of` (attribution, migration 362); auto-recharge
 * never fires for a deployment payer (prepaid-only); the ledger row is
 * payer-keyed; and — the merge condition — a call WITHOUT a deployment
 * context is byte-identical to pre-payer behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, mockRpc, mockAutoRecharge, tableResponses, updateCalls, insertCalls } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const updateCalls: Array<{ table: string; values: unknown; eq: unknown[] }> = []
  const insertCalls: Array<{ table: string; values: unknown }> = []

  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockImplementation((values: unknown) => {
        insertCalls.push({ table, values })
        return chain
      }),
      update: vi.fn().mockImplementation((values: unknown) => {
        const call = { table, values, eq: [] as unknown[] }
        updateCalls.push(call)
        return {
          eq: vi.fn().mockImplementation((...args: unknown[]) => {
            call.eq.push(args)
            return Promise.resolve({ error: null })
          }),
        }
      }),
    }
    return chain
  }

  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  const mockRpc = vi.fn().mockResolvedValue({ data: null, error: null })
  const mockAutoRecharge = vi.fn().mockResolvedValue(undefined)

  return { mockFrom, mockRpc, mockAutoRecharge, tableResponses, updateCalls, insertCalls }
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
vi.mock("../auto-recharge.js", () => ({ attemptAutoRecharge: mockAutoRecharge }))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"
import type { BillingContext } from "../../../lib/billing-context.js"

const REQUESTER = "user-123"
const PAYER = "payer-acct-uuid"
const DEP_CTX: BillingContext = {
  payer: "deployment",
  userId: REQUESTER,
  payerId: PAYER,
  entitlements: { watermark: false, dailyCapCredits: null, parallelism: 4, tierForGates: "basic" },
}

function mockTable(table: string, data: unknown, error: unknown = null): void {
  tableResponses.set(table, { data, error })
}

beforeEach(() => {
  tableResponses.clear()
  updateCalls.length = 0
  insertCalls.length = 0
  mockFrom.mockClear()
  mockRpc.mockClear()
  mockAutoRecharge.mockClear()
  invalidateModelPricingCache()
  mockTable("model_pricing", { credit_cost: 5, is_enabled: true, tier_restriction: null })
  // The profile read is the DEBIT user's — a free-tier row here would
  // watermark a personal call but must not watermark a deployment one.
  mockTable("profiles", { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, subscription_credits: 100, topup_credits: 0 })
  mockTable("usage_logs", { id: "log-1", metadata: { from_sub: 5, from_topup: 0 } })
})

describe("reserveCredits under a deployment payer", () => {
  it("debits the PAYER: p_user_id is the payer account, daily cap off, watermark off", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    const result = await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, {
      billingContext: DEP_CTX,
    })
    expect(mockRpc).toHaveBeenCalledWith(
      "reserve_credits",
      expect.objectContaining({ p_user_id: PAYER, p_credits: 5, p_job_id: "job-1", p_daily_limit: null }),
    )
    // The requester's free tier must NOT watermark deployment-paid work —
    // the payer's grade (watermark: false, literal) decides.
    expect(result.watermark).toBe(false)
    expect(result.usageLogId).toBe("log-1")
  })

  it("stamps the REQUESTER into usage_logs.on_behalf_of (attribution, migration 362)", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    const stamp = updateCalls.find((c) => c.table === "usage_logs")
    expect(stamp).toBeDefined()
    expect(stamp!.values).toEqual({ on_behalf_of: REQUESTER })
    expect(stamp!.eq).toEqual([["id", "log-1"]])
  })

  it("NEVER auto-recharges a deployment payer — prepaid-only, no card to pump", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    expect(mockAutoRecharge).not.toHaveBeenCalled()
  })

  it("the ledger row is PAYER-keyed — the payer's transaction page is the audit trail", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, { billingContext: DEP_CTX })
    const tx = insertCalls.find((c) => c.table === "credit_transactions")
    expect(tx).toBeDefined()
    expect(tx!.values).toMatchObject({ user_id: PAYER, amount: -5 })
    expect((tx!.values as { description: string }).description).toContain(REQUESTER)
  })

  it("zero-cost path: the row stays REQUESTER-owned, marked with the payer, unwatermarked", async () => {
    mockTable("model_pricing", { credit_cost: 0, is_enabled: true, tier_restriction: null })
    const result = await CreditsService.reserveCredits(REQUESTER, "job-1", "free-model", 0, 0, {
      billingContext: DEP_CTX,
    })
    expect(mockRpc).not.toHaveBeenCalledWith("reserve_credits", expect.anything())
    const log = insertCalls.find((c) => c.table === "usage_logs")
    expect(log).toBeDefined()
    expect(log!.values).toMatchObject({
      user_id: REQUESTER,
      credits_used: 0,
      metadata: expect.objectContaining({ payer: { kind: "deployment", account: PAYER } }),
    })
    expect(result.watermark).toBe(false)
  })

  it("BYTE-EQUIVALENCE control: without a deployment context nothing above happens", async () => {
    mockRpc.mockResolvedValueOnce({ data: "log-1", error: null })
    await CreditsService.reserveCredits(REQUESTER, "job-1", "flux", 0.05, 0.0625, {})
    expect(mockRpc).toHaveBeenCalledWith("reserve_credits", expect.objectContaining({ p_user_id: REQUESTER }))
    expect(updateCalls.filter((c) => c.table === "usage_logs")).toEqual([])
    const tx = insertCalls.find((c) => c.table === "credit_transactions")
    expect(tx!.values).toMatchObject({ user_id: REQUESTER })
    expect(mockAutoRecharge).toHaveBeenCalledWith(REQUESTER)
  })
})
