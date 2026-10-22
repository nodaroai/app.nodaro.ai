import { describe, expect, it, vi, beforeEach } from "vitest"

// D6: metered LLM pricing is the default; the rollback restores the tier ids.
const llmPricing = vi.hoisted(() => ({ rollback: false }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  llmMeteredPricing: () => !llmPricing.rollback,
}))

import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits"

describe("reduce credit costs", () => {
  it("has STATIC_CREDIT_COSTS entries for all 6 composite keys", () => {
    expect(STATIC_CREDIT_COSTS["reduce:pick-best-llm"]).toBe(10) // base (Sonnet image-rank ~$0.0135)
    expect(STATIC_CREDIT_COSTS["reduce:concat"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:first-non-empty"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:count"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:vote"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:merge-json"]).toBe(0)
  })

  beforeEach(() => { llmPricing.rollback = false })

  it("CREDIT_COSTS resolver: the AI judge is priced per model (its price key); pure-logic strategies keep their rows", () => {
    const resolver = CREDIT_COSTS["reduce"]
    expect(resolver).toBeDefined()
    // An unset judge model is the feature's default.
    expect(resolver!({ strategyId: "pick-best-llm" } as any)).toBe("reduce:pick-best-llm:claude-sonnet-5.5")
    expect(resolver!({ strategyId: "pick-best-llm", strategyConfig: { llmModel: "gemini-3.8-flash" } } as any)).toBe("reduce:pick-best-llm:gemini-3.8-flash")
    expect(resolver!({ strategyId: "concat" } as any)).toBe("reduce:concat")
  })

  it("rollback: CREDIT_COSTS resolver returns the composite key for reduce, byte-identical", () => {
    llmPricing.rollback = true
    const resolver = CREDIT_COSTS["reduce"]
    expect(resolver!({ strategyId: "pick-best-llm" } as any)).toBe("reduce:pick-best-llm")
    expect(resolver!({ strategyId: "concat" } as any)).toBe("reduce:concat")
  })
})
