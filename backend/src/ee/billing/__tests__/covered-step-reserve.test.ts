// @test-units-by-name names no node type: it reserves and checks credit ids through CreditsService
/**
 * A covered step (lib/covered-step.ts): a step of a run a podcast pack paid
 * for. Its reservation holds 0 credits whatever its price, through the
 * zero-cost branch (no reserve RPC), and its usage log names the pack and the
 * price the step would have had. Its credit check asks only what refuses the
 * model — an admin's disable still refuses it, a balance never does.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const JOB = "11111111-1111-4111-8111-111111111111"
const LOG = "22222222-2222-4222-8222-222222222222"
const PACK = "33333333-3333-4333-8333-333333333333"

const { mockFrom, mockRpc, tableResponses, inserts } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const inserts: Array<{ table: string; values: Record<string, unknown> }> = []
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {}
    for (const m of ["select", "eq", "is", "neq", "order", "limit", "update", "gte", "lt", "in"]) chain[m] = vi.fn(() => chain)
    chain.single = vi.fn(() => Promise.resolve(fallback))
    chain.maybeSingle = vi.fn(() => Promise.resolve(fallback))
    chain.insert = vi.fn((values: Record<string, unknown>) => {
      inserts.push({ table, values })
      return chain
    })
    chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject)
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) => createChain(table, tableResponses.get(table) ?? null))
  return { mockFrom, mockRpc: vi.fn(), tableResponses, inserts }
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
  llmMeteredPricing: () => true,
}))

import { CreditsService, invalidateModelPricingCache } from "../credits.js"

function price(credits: number, isEnabled = true): void {
  tableResponses.set("model_pricing", { data: { credit_cost: credits, is_enabled: isEnabled, tier_restriction: null }, error: null })
}

function profile(balance: number): void {
  tableResponses.set("profiles", {
    data: {
      tier: "pro", subscription_tier: "pro", lifetime_topup_credits: 0,
      subscription_credits: balance, topup_credits: 0, daily_spent_credits: 0, last_daily_reset: null, app_credits_allowance: 0,
    },
    error: null,
  })
}

const usageLogInserts = () => inserts.filter((i) => i.table === "usage_logs").map((i) => i.values)

beforeEach(() => {
  vi.clearAllMocks()
  tableResponses.clear()
  inserts.length = 0
  invalidateModelPricingCache()
  profile(100)
  price(40)
  tableResponses.set("usage_logs", { data: { id: LOG }, error: null })
  mockRpc.mockResolvedValue({ data: LOG, error: null })
})

describe("reserveCredits — covered", () => {
  it("holds 0 credits through the zero-cost branch, never the reserve RPC", async () => {
    const result = await CreditsService.reserveCredits("user-1", JOB, "speaker-view", 0, 0, { covered: PACK })
    expect(result).toMatchObject({ usageLogId: LOG, creditsReserved: 0 })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("its usage log names the pack and the price the step would have had", async () => {
    await CreditsService.reserveCredits("user-1", JOB, "speaker-view", 0, 0, { covered: PACK })
    const [log] = usageLogInserts()
    expect(log).toMatchObject({ job_id: JOB, action: "speaker-view", credits_used: 0 })
    expect((log!.metadata as Record<string, unknown>).covered).toEqual({ by: PACK, credits: 40 })
  })

  it("a route's override is the price it records", async () => {
    await CreditsService.reserveCredits("user-1", JOB, "apply-edl", 0, 0, { covered: PACK, creditOverride: 75 })
    expect((usageLogInserts()[0]!.metadata as Record<string, unknown>).covered).toEqual({ by: PACK, credits: 75 })
  })

  it("an ordinary zero-cost row carries no mark", async () => {
    price(0)
    await CreditsService.reserveCredits("user-1", JOB, "free-model", 0, 0, {})
    expect((usageLogInserts()[0]!.metadata as Record<string, unknown>).covered).toBeUndefined()
  })

  it("is never a job-once or a side hold", async () => {
    await expect(CreditsService.reserveCredits("user-1", JOB, "speaker-view", 0, 0, { covered: PACK, oncePerJob: true })).rejects.toThrow(/covered/)
    await expect(CreditsService.reserveCredits("user-1", JOB, "speaker-view", 0, 0, { covered: PACK, sideHold: { key: "k" } })).rejects.toThrow(/covered/)
    expect(usageLogInserts()).toEqual([])
  })
})

describe("checkCredits — covered", () => {
  it("an empty balance never refuses it", async () => {
    profile(0)
    expect(await CreditsService.checkCredits("user-1", "speaker-view", false, 40, { covered: true })).toMatchObject({ allowed: true, required: 0 })
    // …while the same step on its own is refused.
    expect((await CreditsService.checkCredits("user-1", "speaker-view", false, 40, {})).allowed).toBe(false)
  })

  it("an admin's disable still refuses it", async () => {
    price(40, false)
    expect(await CreditsService.checkCredits("user-1", "speaker-view", false, 40, { covered: true })).toMatchObject({ allowed: false, code: "model_disabled" })
  })
})
