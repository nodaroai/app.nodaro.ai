import { describe, expect, it } from "vitest"
import { REDUCE_STRATEGIES, REDUCE_STRATEGY_IDS, getStrategy } from "../reduce-strategy-registry"

describe("reduce-strategy-registry", () => {
  it("registers exactly the 6 v1 strategies (snapshot)", () => {
    expect(REDUCE_STRATEGY_IDS).toEqual([
      "pick-best-llm",
      "concat",
      "first-non-empty",
      "count",
      "vote",
      "merge-json",
    ])
  })

  it("every strategy has id, label, description, configSchema, defaultConfig, outputType, creditCostKey", () => {
    for (const s of REDUCE_STRATEGIES) {
      expect(s.id).toBeTruthy()
      expect(s.label).toBeTruthy()
      expect(s.description).toBeTruthy()
      expect(s.configSchema).toBeTruthy()
      expect(s.defaultConfig).toBeDefined()
      expect(s.outputType).toMatch(/^(image|video|audio|text|data)$/)
      expect(s.creditCostKey).toMatch(/^reduce:/)
    }
  })

  it("every strategy's configSchema accepts its defaultConfig", () => {
    for (const s of REDUCE_STRATEGIES) {
      const result = s.configSchema.safeParse(s.defaultConfig)
      expect(result.success, `${s.id} defaultConfig must satisfy configSchema`).toBe(true)
    }
  })

  it("getStrategy returns the right strategy by id", () => {
    expect(getStrategy("concat").id).toBe("concat")
    expect(getStrategy("pick-best-llm").id).toBe("pick-best-llm")
  })

  it("getStrategy throws on unknown id", () => {
    expect(() => getStrategy("nope" as never)).toThrow(/unknown reduce strategy/i)
  })
})
