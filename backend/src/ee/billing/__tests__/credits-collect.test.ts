import { describe, expect, it } from "vitest"
import { STATIC_CREDIT_COSTS, CREDIT_COSTS } from "../credits"

describe("collect credit costs", () => {
  it("has STATIC_CREDIT_COSTS entries for all 6 composite keys", () => {
    expect(STATIC_CREDIT_COSTS["collect:pick-best-llm"]).toBe(3)
    expect(STATIC_CREDIT_COSTS["collect:concat"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["collect:first-non-empty"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["collect:count"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["collect:vote"]).toBe(0)
    expect(STATIC_CREDIT_COSTS["collect:merge-json"]).toBe(0)
  })

  it("CREDIT_COSTS resolver returns the composite key for collect", () => {
    const resolver = CREDIT_COSTS["collect"]
    expect(resolver).toBeDefined()
    expect(resolver!({ strategyId: "pick-best-llm" } as any)).toBe("collect:pick-best-llm")
    expect(resolver!({ strategyId: "concat" } as any)).toBe("collect:concat")
  })
})
