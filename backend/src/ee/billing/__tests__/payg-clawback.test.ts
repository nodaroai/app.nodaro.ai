import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"
import path from "path"

// Refund/dispute clawback (design §4.1a): proportional per-refund claims,
// idempotent via the transactions claim table, floor collapse only when
// something was actually clawed.

const { mockFrom, mockRpc, tableResponses, rpcCalls } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = []
  let lastMatched: { data: unknown; error: unknown } | null = null
  const rpcResult = { value: { data: true, error: null } as { data: unknown; error: unknown } }

  function createChain() {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn(self),
      update: vi.fn(self),
      single: vi.fn(() => Promise.resolve(lastMatched ?? { data: null, error: null })),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(lastMatched ?? { data: null, error: null }).then(resolve),
    })
    return chain
  }

  const mockFrom = vi.fn((table: string) => {
    lastMatched = tableResponses.get(table) ?? null
    return createChain()
  })
  const mockRpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    rpcCalls.push({ fn, args })
    return Promise.resolve(rpcResult.value)
  })
  return { mockFrom, mockRpc, tableResponses, rpcCalls, rpcResult }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}))

vi.mock("@/ee/routes/credits.js", () => ({
  invalidateBalanceCache: vi.fn(),
}))

import { handleTopupClawback } from "../provision-credits.js"

beforeEach(() => {
  tableResponses.clear()
  rpcCalls.length = 0
})

const CLAIM = {
  data: { user_id: "u1", credits_granted: 3300, amount_usd: 10 },
  error: null,
}

describe("handleTopupClawback", () => {
  it("full refund claws the full grant", async () => {
    tableResponses.set("transactions", CLAIM)
    tableResponses.set("profiles", {
      data: { tier: "free", subscription_tier: null, lifetime_topup_credits: 0, storage_limit_bytes: 10 * 1024 ** 3 },
      error: null,
    })
    await handleTopupClawback({
      paymentIntentId: "pi_1",
      refunds: [{ refundId: "re_1", amountCents: 1000 }],
    })
    const claw = rpcCalls.find((c) => c.fn === "clawback_topup_credits")
    expect(claw?.args.p_credits).toBe(3300)
    expect(claw?.args.p_refund_id).toBe("re_1")
  })

  it("partial refund claws proportionally, clamped to the grant", async () => {
    tableResponses.set("transactions", CLAIM)
    tableResponses.set("profiles", { data: null, error: null })
    await handleTopupClawback({
      paymentIntentId: "pi_1",
      refunds: [{ refundId: "re_2", amountCents: 250 }], // $2.50 of $10
    })
    expect(rpcCalls[0]?.args.p_credits).toBe(Math.round(3300 * 0.25))
  })

  it("multiple refunds claim independently by their own ids", async () => {
    tableResponses.set("transactions", CLAIM)
    tableResponses.set("profiles", { data: null, error: null })
    await handleTopupClawback({
      paymentIntentId: "pi_1",
      refunds: [
        { refundId: "re_a", amountCents: 500 },
        { refundId: "re_b", amountCents: 500 },
      ],
    })
    expect(rpcCalls.map((c) => c.args.p_refund_id)).toEqual(["re_a", "re_b"])
  })

  it("non-topup charges no-op (no claim row matches)", async () => {
    tableResponses.set("transactions", { data: null, error: { code: "PGRST116" } })
    await handleTopupClawback({
      paymentIntentId: "pi_sub_invoice",
      refunds: [{ refundId: "re_x", amountCents: 1200 }],
    })
    expect(rpcCalls).toHaveLength(0)
  })

  it("missing payment intent no-ops", async () => {
    await handleTopupClawback({ paymentIntentId: null, refunds: [{ refundId: "re", amountCents: 1 }] })
    expect(rpcCalls).toHaveLength(0)
  })
})

describe("webhook wiring text pins", () => {
  it("both event cases exist and route to the handler", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../routes/stripe-webhook.ts"),
      "utf8"
    )
    expect(src).toContain('case "charge.refunded"')
    // The modern-API fallback: empty embedded list + amount_refunded > 0
    // must fetch the real refunds (first live refund regression).
    expect(src).toContain("refunds.list({ charge: charge.id")
    expect(src).toContain('case "charge.dispute.funds_withdrawn"')
    // E2/P13: both events now go through routeClawback — the org/personal
    // fork keyed on the grant claim's org_id. The personal path is UNCHANGED
    // behind it: routeClawback delegates to handleTopupClawback for every
    // non-org transaction (pinned behaviorally in org-customer.test.ts).
    expect(src.match(/routeClawback\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})
