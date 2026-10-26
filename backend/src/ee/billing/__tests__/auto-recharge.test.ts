import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "fs"
import path from "path"

const { mockFrom, mockRpc, tableResponses, rpcResponses, stripeMocks } = vi.hoisted(() => {
  const tableResponses = new Map<string, { data: unknown; error: unknown }>()
  const rpcResponses = new Map<string, { data: unknown; error: unknown }>()
  let lastMatched: { data: unknown; error: unknown } | null = null

  function createChain() {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    Object.assign(chain, {
      select: vi.fn(self),
      eq: vi.fn(self),
      single: vi.fn(() => Promise.resolve(lastMatched ?? { data: null, error: null })),
    })
    return chain
  }
  const mockFrom = vi.fn((table: string) => {
    lastMatched = tableResponses.get(table) ?? null
    return createChain()
  })
  const mockRpc = vi.fn((fn: string) =>
    Promise.resolve(rpcResponses.get(fn) ?? { data: null, error: null })
  )
  const stripeMocks = {
    retrieve: vi.fn(),
    pmList: vi.fn(),
    piCreate: vi.fn(),
  }
  return { mockFrom, mockRpc, tableResponses, rpcResponses, stripeMocks }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: mockFrom, rpc: mockRpc },
}))

const configRef = vi.hoisted(() => ({ enabled: true }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = (await importOriginal()) as { config: Record<string, unknown> }
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get(t, k) {
        if (k === "AUTO_RECHARGE_ENABLED") return configRef.enabled
        return (t as Record<string, unknown>)[k as string]
      },
    }),
  }
})

vi.mock("@/ee/billing/stripe-client.js", () => ({
  getStripe: () => ({
    customers: { retrieve: stripeMocks.retrieve },
    paymentMethods: { list: stripeMocks.pmList },
    paymentIntents: { create: stripeMocks.piCreate },
  }),
}))

import { attemptAutoRecharge } from "../auto-recharge.js"

const READY_PROFILE = {
  auto_recharge_enabled: true,
  auto_recharge_threshold_credits: 3000,
  auto_recharge_amount_usd: 50,
  auto_recharge_failure_count: 0,
  subscription_credits: 1000,
  topup_credits: 500, // balance 1500 < threshold 3000
}

beforeEach(() => {
  tableResponses.clear()
  rpcResponses.clear()
  vi.clearAllMocks()
  configRef.enabled = true
  tableResponses.set("profiles", { data: READY_PROFILE, error: null })
  tableResponses.set("stripe_customers", { data: { stripe_customer_id: "cus_1" }, error: null })
  rpcResponses.set("claim_auto_recharge", {
    data: [{ amount_usd: 50, threshold_credits: 3000 }],
    error: null,
  })
  stripeMocks.retrieve.mockResolvedValue({
    invoice_settings: { default_payment_method: "pm_default" },
  })
  stripeMocks.piCreate.mockResolvedValue({ id: "pi_ar_1", status: "succeeded" })
})

describe("attemptAutoRecharge", () => {
  it("charges the configured amount off-session with the auto_recharge kind", async () => {
    await attemptAutoRecharge("u1")
    expect(mockRpc).toHaveBeenCalledWith("claim_auto_recharge", { p_user_id: "u1" })
    const [params, opts] = stripeMocks.piCreate.mock.calls[0]
    expect(params.amount).toBe(5000)
    expect(params.off_session).toBe(true)
    expect(params.confirm).toBe(true)
    expect(params.payment_method).toBe("pm_default")
    expect(params.metadata.kind).toBe("auto_recharge")
    expect(opts.idempotencyKey).toMatch(/^ar_u1_/)
  })

  it("kill switch off → nothing happens", async () => {
    configRef.enabled = false
    await attemptAutoRecharge("u1")
    expect(mockRpc).not.toHaveBeenCalled()
    expect(stripeMocks.piCreate).not.toHaveBeenCalled()
  })

  it("balance at/above threshold → precheck exits before the claim", async () => {
    tableResponses.set("profiles", {
      data: { ...READY_PROFILE, subscription_credits: 2000, topup_credits: 1500 },
      error: null,
    })
    await attemptAutoRecharge("u1")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("three prior failures → precheck exits", async () => {
    tableResponses.set("profiles", {
      data: { ...READY_PROFILE, auto_recharge_failure_count: 3 },
      error: null,
    })
    await attemptAutoRecharge("u1")
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it("lost claim (cooldown/cap/race) → no charge", async () => {
    rpcResponses.set("claim_auto_recharge", { data: [], error: null })
    await attemptAutoRecharge("u1")
    expect(stripeMocks.piCreate).not.toHaveBeenCalled()
  })

  it("no saved payment method → records a webhook-less failure, no charge", async () => {
    stripeMocks.retrieve.mockResolvedValue({ invoice_settings: {} })
    stripeMocks.pmList.mockResolvedValue({ data: [] })
    await attemptAutoRecharge("u1")
    expect(stripeMocks.piCreate).not.toHaveBeenCalled()
    expect(mockRpc).toHaveBeenCalledWith("record_auto_recharge_failure", { p_user_id: "u1" })
  })

  it("charge error WITH a PaymentIntent → webhook owns the failure (no local record)", async () => {
    stripeMocks.piCreate.mockRejectedValue(
      Object.assign(new Error("card_declined"), { payment_intent: { id: "pi_x" } })
    )
    await attemptAutoRecharge("u1")
    expect(mockRpc).not.toHaveBeenCalledWith("record_auto_recharge_failure", { p_user_id: "u1" })
  })

  it("never throws — a stripe explosion is contained", async () => {
    stripeMocks.retrieve.mockRejectedValue(new Error("stripe down"))
    await expect(attemptAutoRecharge("u1")).resolves.toBeUndefined()
  })
})

describe("hook coverage (audit F2.2) — text pins", () => {
  const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8")

  it("all three reservation sites fire the attempt, for the account autoRechargeTargetFor chose", () => {
    // The full guard (no raw user id at any call) is auto-recharge-target.test.ts.
    expect(read("credits.ts")).toContain("void attemptAutoRecharge(rechargeTarget)")
    expect(read("../pipelines/credits.ts")).toContain("void attemptAutoRecharge(rechargeTarget)")
    expect(read("../pipelines/scene-helper-credits.ts")).toContain("void attemptAutoRecharge(rechargeTarget)")
  })

  it("third-party app operations are excluded at the guard", () => {
    expect(read("../lib/credit-guard-impl.ts")).toContain("skipAutoRecharge: Boolean(req.appAuthorization)")
  })
})
