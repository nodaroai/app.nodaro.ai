// @test-units-by-name looks up only reduce (Choose Best) and llm-chat
/**
 * Choose Best (`reduce`) under metered pricing: an untouched node runs a free
 * strategy, and its AI judge is a metered call charged its actual usage. So
 * `GET /v1/nodes` states the band from its free strategies up to the judge's
 * default-model estimate, marked an estimate — never the judge's tier rows
 * (`0-70`). Under the rollback (no metered key priced) the band is exactly as
 * before.
 */
import { describe, it, expect } from "vitest"
import { LLM_FEATURE_DEFAULTS, llmPriceKey } from "@nodaro/shared/llm-models"
import { NODE_REGISTRY, chargedDescriptor, UNPRICED_CREDIT_COST } from "../node-registry.js"
import { hostedStatedPrices, statedPrices } from "../../ee/billing/stated-prices.js"
import { meteredLlmKeyOfNode, meteredLlmOptionKeyOfType } from "../../ee/billing/credits.js"
import type { ChargedPrices } from "../pricing/charged-prices.js"

const reduce = NODE_REGISTRY.find((d) => d.type === "reduce")!
const judgeKey = llmPriceKey("reduce:pick-best-llm", LLM_FEATURE_DEFAULTS["pick-best-llm"])

describe("Choose Best's served price", () => {
  it("the option key is the judge on its default model", () => {
    expect(meteredLlmOptionKeyOfType("reduce")).toBe(judgeKey)
    expect(meteredLlmOptionKeyOfType("llm-chat")).toBeNull()
  })

  it("metered: free strategies up to the judge's estimate, marked an estimate", () => {
    const prices = hostedStatedPrices()
    const judge = prices.credits(judgeKey)
    expect(judge).toBeGreaterThan(0)
    const served = chargedDescriptor(reduce, prices)
    expect(served.creditCost).toBe(`0-${judge}`)
    expect(served.estimate).toBe(true)
  })

  it("the judge's model has no price on its lane: unpriced, never the tier band", () => {
    const prices: ChargedPrices = { ...hostedStatedPrices(), llmQuote: (id) => (id === judgeKey ? { kind: "unpriced" } : null) }
    expect(chargedDescriptor(reduce, prices).creditCost).toBe(UNPRICED_CREDIT_COST)
  })

  it("rollback (no metered key priced): the band exactly as before, no estimate flag", () => {
    const prices: ChargedPrices = { ...statedPrices(), llmQuote: () => null }
    const served = chargedDescriptor(reduce, prices)
    expect(served).toEqual(chargedDescriptor(reduce, { credits: prices.credits, rate: prices.rate }))
    expect(served.estimate).toBeUndefined()
    expect(served.creditCost).not.toBe(`0-${hostedStatedPrices().credits(judgeKey)}`)
  })

  it("a real node is still priced as it is set: an untouched Choose Best makes no metered call", () => {
    expect(meteredLlmKeyOfNode({ type: "reduce", data: {} })).toBeNull()
  })
})
