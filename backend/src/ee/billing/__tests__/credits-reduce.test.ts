import { describe, expect, it } from "vitest"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits"

describe("reduce credit costs", () => {
  it("has STATIC_CREDIT_COSTS entries for all 6 composite keys", () => {
    expect(STATIC_CREDIT_COSTS["reduce:pick-best-llm"]).toBe(3)
    expect(STATIC_CREDIT_COSTS["reduce:concat"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:first-non-empty"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:count"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:vote"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["reduce:merge-json"]).toBe(0)
  })

  it("CREDIT_COSTS resolver returns the composite key for reduce", () => {
    const resolver = CREDIT_COSTS["reduce"]
    expect(resolver).toBeDefined()
    expect(resolver!({ strategyId: "pick-best-llm" } as any)).toBe("reduce:pick-best-llm")
    expect(resolver!({ strategyId: "concat" } as any)).toBe("reduce:concat")
  })
})
