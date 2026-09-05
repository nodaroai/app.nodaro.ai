/**
 * Deployment payer (item 9) — what the credit guard does for a requester
 * on a deployment-payer instance.
 *
 * Two properties, both about a wallet the requester does not own:
 *   1. The PAYER's profile is what gates the request (its tier, its balance),
 *      not the requester's frozen signup grant — otherwise the instance 402s
 *      for everyone the moment those untouched grants look spent.
 *   2. When that wallet IS empty, the refusal must not echo its balance. The
 *      402 reaches anyone who can press Generate, and the operator's pool
 *      size is exactly the figure the consumption-only /usage page exists to
 *      keep private. The copy names the operator, because a prepaid
 *      instance's user has no purchase path to be sent to.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const { mockFrom, tableResponses, eqCalls } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const eqCalls: Array<{ table: string; args: unknown[] }> = []
  function createChain(table: string, response: { data: unknown; error: unknown } | null) {
    const fallback = response ?? { data: null, error: { code: "PGRST116" } }
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockImplementation((...args: unknown[]) => {
        eqCalls.push({ table, args })
        return chain
      }),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve(fallback)),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
    }
    return chain
  }
  const mockFrom = vi.fn().mockImplementation((table: string) =>
    createChain(table, tableResponses.get(table) ?? null),
  )
  return { mockFrom, tableResponses, eqCalls }
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

import { creditGuardImpl } from "../credit-guard-impl.js"

const REQUESTER = "requester-1"
const PAYER = "payer-acct"
const DEP_CTX = {
  payer: "deployment" as const,
  userId: REQUESTER,
  payerId: PAYER,
  entitlements: { watermark: false as const, dailyCapCredits: null, parallelism: 4, tierForGates: "business" },
}

function world(balance: number): void {
  tableResponses.set("profiles", {
    data: {
      role: "user",
      tier: "business",
      subscription_tier: "business",
      lifetime_topup_credits: 0,
      subscription_credits: balance,
      topup_credits: 0,
      daily_spent_credits: 0,
      last_daily_reset: new Date().toISOString().slice(0, 10),
      storage_used_bytes: 0,
      storage_limit_bytes: 1_000_000_000,
    },
    error: null,
  })
  tableResponses.set("model_pricing", { data: { credit_cost: 5, is_enabled: true, tier_restriction: null }, error: null })
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

const makeReq = () => ({ userId: REQUESTER, url: "/v1/generate-image", headers: {}, body: {}, billingContext: DEP_CTX })

beforeEach(() => {
  tableResponses.clear()
  eqCalls.length = 0
  mockFrom.mockClear()
})

describe("creditGuardImpl under a deployment payer", () => {
  it("gates on the PAYER's profile, not the requester's", async () => {
    world(10_000)
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => "flux")(makeReq() as never, reply as never)

    expect(sent).toHaveLength(0)
    const profileLookup = eqCalls.find((c) => c.table === "profiles")
    expect(profileLookup?.args).toEqual(["id", PAYER])
  })

  it("an empty payer wallet 402s WITHOUT echoing the payer's balance", async () => {
    world(0)
    const { sent, reply } = makeReply()
    await creditGuardImpl(() => "flux")(makeReq() as never, reply as never)

    expect(sent).toHaveLength(1)
    expect(sent[0]?.status).toBe(402)
    const body = sent[0]?.body as { error: { code: string; message: string }; required: number; balance?: number }
    expect(body.error.code).toBe("insufficient_credits")
    // The leak this test exists for: no pool figure, under any key.
    expect(body).not.toHaveProperty("balance")
    expect(JSON.stringify(body)).not.toContain(PAYER)
    // The copy points at the only party who can fix it.
    expect(body.error.message).toMatch(/administrator/i)
    expect(body.required).toBe(5)
  })

  it("without a deployment context the 402 keeps its balance (mainline unchanged)", async () => {
    world(0)
    const { sent, reply } = makeReply()
    const req = { ...makeReq(), billingContext: { payer: "user" as const, userId: REQUESTER } }
    await creditGuardImpl(() => "flux")(req as never, reply as never)

    expect(sent[0]?.status).toBe(402)
    expect(sent[0]?.body).toHaveProperty("balance")
  })
})
