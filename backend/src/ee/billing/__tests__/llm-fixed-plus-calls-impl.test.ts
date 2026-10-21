// @test-reads-none mocks the supabase client and the credit service; reads no repo file
/**
 * The settle of a FIXED-price job that also makes metered LLM calls (the
 * scrapes' per-item analysis): what it writes on the job (`writeJobSettle`).
 * `credits_actual` from the receipt, `provider_cost` when computable, then the
 * billing ledger — WITH its charge id — in the server-only ledger column (R32).
 * A billed call whose cost cannot be computed is charged its hold whole and
 * gets the `uncomputable` ledger (no `provider_cost`), replacing any interim one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  commit: vi.fn(async (..._a: unknown[]) => ({ charged: 130, collectedOverHold: 0, shortfall: 0 }) as unknown),
  refund: vi.fn(async (..._a: unknown[]) => undefined),
  actual: vi.fn(async (..._a: unknown[]) => 30),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: (values: Record<string, unknown>) => {
        h.updates.push(values)
        return { eq: async () => ({ error: null }) }
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { user_id: "user-1" }, error: null }) }) }),
      insert: async () => ({ error: null }),
    })),
  },
}))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: vi.fn(async () => ({ cost_markup_percent: 10 })) }))
vi.mock("../credits.js", () => ({
  CreditsService: { commitCredits: h.commit, refundCredits: h.refund },
  getModelCreditCostFromDB: vi.fn(async () => ({ creditCost: 100 })),
}))
vi.mock("../credit-anomaly.js", () => ({ computeActualCredits: h.actual }))

const { settleFixedPlusLlmCallsImpl } = await import("../llm-fixed-plus-calls-impl.js")
const { LlmSpend } = await import("../../../lib/llm-billing.js")

const CHARGE_ID = "meta-ads-analysis:claude-sonnet-5.5"
const HOLD = { usageLogId: "log-1", chargeId: CHARGE_ID, fixedCharged: 100, llmHoldCredits: 45, holdCredits: 145 }
const kie = (fields: Record<string, unknown>) => ({ text: "ok", model: "m", lane: "kie" as const, ...fields })
const req = (modelId: string) => ({ modelId, system: "", messages: [{ role: "user" as const, content: "a".repeat(400) }] })

beforeEach(() => {
  vi.clearAllMocks()
  h.updates.length = 0
  h.commit.mockResolvedValue({ charged: 130, collectedOverHold: 0, shortfall: 0 })
})

describe("settleFixedPlusLlmCalls — what the settle writes on the job", () => {
  it("a costed spend: credits_actual + provider_cost, then the ledger with its charge id", async () => {
    const spend = new LlmSpend()
    spend.add("claude-sonnet-5.5", req("claude-sonnet-5.5"), { response: kie({ usage: { inputTokens: 100, outputTokens: 100 }, creditsUsd: 0.05 }) as never })
    const out = await settleFixedPlusLlmCallsImpl("job-1", HOLD, spend, "charge")
    expect(out).toMatchObject({ outcome: "charged", charged: 130 })
    expect(h.commit).toHaveBeenCalledWith("log-1", 130, { collectOverHold: true })
    expect(h.updates).toEqual([
      { credits_actual: 130, provider_cost: 0.05 },
      { llm_billing: { costUsd: 0.05, source: "kie-stated", calls: 1, lanes: ["kie"], chargeId: CHARGE_ID } },
    ])
  })

  it("UNCOMPUTABLE: a billed call with no rate charges the calls' hold whole and writes the uncomputable ledger — no provider_cost, never a refund", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const spend = new LlmSpend()
    // gemini-4-argon has no KIE rate: its answer cannot be costed.
    spend.add("gemini-4-argon", req("gemini-4-argon"), { response: kie({ usage: { inputTokens: 10, outputTokens: 10 } }) as never })
    h.commit.mockResolvedValue({ charged: 145, collectedOverHold: 0, shortfall: 0 })
    const out = await settleFixedPlusLlmCallsImpl("job-1", HOLD, spend, "charge")
    // The fixed part (100) + the calls' hold whole (45).
    expect(h.commit).toHaveBeenCalledWith("log-1", 145, { collectOverHold: true })
    expect(h.refund).not.toHaveBeenCalled()
    expect(h.actual).not.toHaveBeenCalled()
    expect(out).toEqual({ outcome: "charged", charged: 145, shortfall: 0 })
    expect(h.updates).toEqual([
      { credits_actual: 145 },
      { llm_billing: { costUsd: null, source: "uncomputable", calls: 1, lanes: ["kie"], chargeId: CHARGE_ID } },
    ])
  })

  it("nothing billed, fixed part refunded: refunded, nothing written on the job", async () => {
    const out = await settleFixedPlusLlmCallsImpl("job-1", HOLD, new LlmSpend(), "refund")
    expect(out).toEqual({ outcome: "refunded" })
    expect(h.refund).toHaveBeenCalledWith("log-1")
    expect(h.updates).toEqual([])
  })

  it("nothing billed, fixed part charged: credits_actual only — no ledger", async () => {
    h.commit.mockResolvedValue({ charged: 100, collectedOverHold: 0, shortfall: 0 })
    await settleFixedPlusLlmCallsImpl("job-1", HOLD, new LlmSpend(), "charge")
    expect(h.updates).toEqual([{ credits_actual: 100 }])
  })
})
