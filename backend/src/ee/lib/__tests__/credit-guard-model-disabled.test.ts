/**
 * A model an admin switched off (`model_pricing.is_enabled = false`) is
 * refused with 403 `model_disabled` and the check's own sentence — on both
 * emit paths of the credit guard: the route preHandler and the in-request
 * reservation. Never the 402 `insufficient_credits` shape: the SDK reads a
 * 402 as InsufficientCreditsError, the MCP prints its fixed "insufficient
 * credits" line before reading any code, and the editor opens the
 * buy-credits dialog — all of which an admin saw after switching a model
 * off (2026-10-29), with a full balance.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  function createChain(response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
    }
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
vi.mock("@/lib/deployment-payer.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/deployment-payer.js")>()
  return { ...actual, deploymentPayerActive: () => false, deploymentPayerId: () => null, allowanceEnforcementActive: () => false }
})

import { creditGuardImpl, reserveCreditsForJobImpl, insufficientCreditsRefusal } from "../credit-guard-impl.js"
import { invalidateModelPricingCache } from "../../billing/credits.js"

const USER = "user-admin-switch-1"

function richProfile(): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "business",
      subscription_tier: "business",
      lifetime_topup_credits: 0,
      subscription_credits: 0,
      topup_credits: 38_489,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
}

function pricing(enabled: boolean): void {
  tableResponses.set("model_pricing", { data: { credit_cost: 35, is_enabled: enabled, tier_restriction: null }, error: null })
  invalidateModelPricingCache()
}

function makeReply() {
  const sent: Array<{ status: number; body: unknown }> = []
  return {
    sent,
    reply: {
      status(code: number) {
        return { send: (body: unknown) => { sent.push({ status: code, body }) } }
      },
    },
  }
}

const makeReq = () => ({ userId: USER, url: "/v1/generate-image", headers: {}, body: {} })

beforeEach(() => {
  tableResponses.clear()
  mockFrom.mockClear()
  richProfile()
})

describe("credit guard — a model an admin switched off", () => {
  it("the route preHandler answers 403 model_disabled with the check's sentence, with a full balance", async () => {
    pricing(false)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "flux-flex")(makeReq() as never, reply as never)
    expect(sent).toEqual([
      { status: 403, body: { error: { code: "model_disabled", message: "This model is currently disabled" } } },
    ])
  })

  it("a metered hold's in-request check answers the same 403, and drops the pending job row", async () => {
    // The hold path (`holdCovered`) re-runs the credit check inside the
    // request, after the preHandler — the one reservation path that answers
    // a refusal of its own.
    pricing(false)
    const { reply, sent } = makeReply()
    const ok = await reserveCreditsForJobImpl(makeReq() as never, reply as never, "job-1", "llm-chat", { holdCredits: 35 })
    expect(ok).toBeUndefined()
    expect(sent).toEqual([
      { status: 403, body: { error: { code: "model_disabled", message: "This model is currently disabled" } } },
    ])
    expect(mockFrom).toHaveBeenCalledWith("jobs")
  })

  it("the same model switched on passes the preHandler", async () => {
    pricing(true)
    const { reply, sent } = makeReply()
    await creditGuardImpl(() => "flux-flex")(makeReq() as never, reply as never)
    expect(sent).toEqual([])
  })

  it("insufficientCreditsRefusal: the code wins over every other shape, deployment payer included", () => {
    const check = { error: "This model is currently disabled", code: "model_disabled" as const, required: 35, balance: 38_489 }
    const expected = { statusCode: 403, body: { error: { code: "model_disabled", message: "This model is currently disabled" } } }
    expect(insufficientCreditsRefusal(check, false)).toEqual(expected)
    expect(insufficientCreditsRefusal(check, true)).toEqual(expected)
    expect(insufficientCreditsRefusal({ ...check, subscriptionRequired: true }, false)).toEqual(expected)
    // Without the code the plain 402 is untouched.
    expect(insufficientCreditsRefusal({ error: "Insufficient credits", required: 35, balance: 1 }, false).statusCode).toBe(402)
  })
})
