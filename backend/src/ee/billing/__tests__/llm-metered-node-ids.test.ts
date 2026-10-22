// @test-units-by-name prices only the metered LLM node types it names (llm-chat, describe-to-picker, video-composer, reduce)
/**
 * The workflow-estimate credit ids of metered LLM nodes (A5, metered LLM
 * pricing Task 11): Generate Text, Describe to Picker, Video Composer (the
 * scene-graph-ai feature) and Choose Best's AI judge are priced under the
 * price key `<feature>:<model>[:direct]` (`llmPriceKey`), which the charged
 * price table answers with the model's estimate — never a tier row. Under the
 * rollback every id is today's tier id, byte-identical.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { llmPriceKey } from "@nodaro/shared/llm-models"

const llmPricing = vi.hoisted(() => ({ rollback: false }))
vi.mock("@/lib/config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/config.js")>()),
  hasCredits: () => true,
  llmMeteredPricing: () => !llmPricing.rollback,
}))

import { CREDIT_COSTS, chargedCredits, chargedPriceTableFrom, getNodeModelIdentifier, meteredLlmQuote } from "../credits.js"

const id = (type: string, data: Record<string, unknown>) => getNodeModelIdentifier({ type, data })

beforeEach(() => {
  llmPricing.rollback = false
})

describe("metered: the estimate prices each LLM node under its price key", () => {
  it("llm-chat: the node's model, effort and Advanced flag decide the key (the default model when unset)", () => {
    expect(id("llm-chat", { llmModel: "gpt-5.6-terra" })).toBe("llm-chat:gpt-5.6-terra")
    expect(id("llm-chat", { llmModel: "gpt-5.6-terra", reasoningEffort: "max" })).toBe(llmPriceKey("llm-chat", "gpt-5.6-terra", "max"))
    expect(id("llm-chat", { llmModel: "gemini-4-argon" })).toBe("llm-chat:gemini-4-argon:direct")
    expect(id("llm-chat", {})).toMatch(/^llm-chat:[a-z0-9.-]+(:direct)?$/)
  })

  it("describe-to-picker: Opus 5.5's recipe effort keys the direct lane; the untouched default keys the aggregator", () => {
    expect(id("describe-to-picker", { llmModel: "claude-opus-5.5" })).toBe("describe-to-picker:claude-opus-5.5:direct")
    expect(id("describe-to-picker", {})).toBe("describe-to-picker:gemini-3.8-flash")
  })

  it("video-composer prices on the scene-graph-ai feature it reserves through", () => {
    expect(id("video-composer", { llmModel: "claude-sonnet-5.5" })).toBe(llmPriceKey("scene-graph-ai", "claude-sonnet-5.5"))
  })

  it("Choose Best's AI judge", () => {
    expect(CREDIT_COSTS["reduce"]!({ strategyId: "pick-best-llm", strategyConfig: { llmModel: "gemini-3.8-flash" } })).toBe("reduce:pick-best-llm:gemini-3.8-flash")
  })

  it("the charged price table answers each key with the model's estimate, never a missing price", () => {
    const prices = chargedPriceTableFrom(new Map(), { cost_markup_percent: 10 } as never)
    for (const key of [
      id("llm-chat", { llmModel: "gpt-5.6-terra" }),
      id("describe-to-picker", { llmModel: "claude-opus-5.5" }),
      id("video-composer", { llmModel: "claude-sonnet-5.5" }),
    ]) {
      const quote = meteredLlmQuote(prices, key)
      expect(quote?.kind, key).toBe("estimate")
      expect(chargedCredits(prices, key), key).toBe(quote?.kind === "estimate" ? quote.credits : NaN)
    }
  })
})

describe("rollback: today's tier ids, byte-identical", () => {
  beforeEach(() => {
    llmPricing.rollback = true
  })

  it("every builder answers its tier id", () => {
    expect(id("llm-chat", { llmModel: "gpt-5.6-terra" })).toBe("llm-chat")
    expect(id("llm-chat", { llmModel: "gpt-5.6-terra", reasoningEffort: "max" })).toBe("llm-chat:premium")
    expect(id("describe-to-picker", {})).toBe("describe-to-picker:economy")
    expect(id("describe-to-picker", { llmModel: "claude-opus-5.5" })).toBe("describe-to-picker:premium-direct")
    expect(id("video-composer", { llmModel: "claude-sonnet-5.5" })).toMatch(/^scene-graph-ai(:|$)/)
    expect(CREDIT_COSTS["reduce"]!({ strategyId: "pick-best-llm" })).toBe("reduce:pick-best-llm")
  })
})
