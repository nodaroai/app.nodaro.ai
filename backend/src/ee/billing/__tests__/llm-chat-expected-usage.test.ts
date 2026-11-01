// @test-units-by-name prices the metered llm-chat node type at its own expected usage
/**
 * A workflow estimate's `llm-chat` node may say how large its call is
 * (`data.expectedUsage: { inputTokens, outputTokens }`, a plugin's quote graph,
 * `tk.capabilities.llmChatEstimateUsage`): it is priced at that call on the
 * model's primary lane, in place of the feature's typical call — never below
 * it (each token count floored at the typical one). A node without
 * it, or with one that is not two positive integers within the bounds, prices
 * exactly as before. Under the rollback nothing changes.
 *
 * The real switch is exercised (as workflow-estimate-metered.test.ts): the
 * price table is the real one over an empty `model_pricing` at a 10% markup.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"
import { LLM_MODEL_IDS, getLlmModel } from "@nodaro/shared/llm-models"

vi.mock("@/lib/supabase.js", () => {
  const query = {
    select: () => query,
    order: () => query,
    eq: () => query,
    in: () => query,
    single: async () => ({ data: null, error: { code: "PGRST116" } }),
    range: async () => ({ data: [], error: null }),
  }
  return { supabase: { from: () => query } }
})
vi.mock("@/lib/app-settings.js", () => ({
  getAppSettings: async () => ({ cost_markup_percent: 10, service_margin_percent: {} }),
}))

import { config } from "../../../lib/config.js"
import { setLlmMeteredSchemaReadyForTesting } from "../../../lib/llm-metered-schema-gate.js"
import { hasLlmRate, llmPrimaryLane } from "../../../lib/pricing/llm-cost.js"
import { EXPECTED_LLM_USAGE_MAX, estimateWorkflowCredits, expectedLlmUsageOf, type EstimateNode } from "../credits.js"
import { LLM_TYPICAL_USAGE } from "../llm-typical-usage.js"

const rollback = (on: boolean) => {
  ;(config as { LLM_TIER_PRICING_ROLLBACK: boolean }).LLM_TIER_PRICING_ROLLBACK = on
}

beforeEach(() => {
  setLlmMeteredSchemaReadyForTesting(true)
  rollback(false)
})
afterAll(() => {
  setLlmMeteredSchemaReadyForTesting(undefined)
  rollback(false)
})

const chat = (model: string, expectedUsage?: unknown): EstimateNode => ({
  id: "chat",
  type: "llm-chat",
  data: { llmModel: model, ...(expectedUsage !== undefined ? { expectedUsage } : {}) },
})
const price = (node: EstimateNode) => estimateWorkflowCredits([node], [])

const OPUS = "claude-opus-5.5"
const TYPICAL = LLM_TYPICAL_USAGE["llm-chat"]

describe("an llm-chat node with its own expected usage", () => {
  it("is priced at that call: the typical size prices as today, a larger call higher", async () => {
    const today = await price(chat(OPUS))
    expect(await price(chat(OPUS, { ...TYPICAL }))).toBe(today)
    const larger = await price(chat(OPUS, { inputTokens: 40_000, outputTokens: 4_000 }))
    expect(larger).toBeGreaterThan(today)
    // Linear enough that a 10x larger call is far dearer (rounding aside).
    expect(await price(chat(OPUS, { inputTokens: 400_000, outputTokens: 40_000 }))).toBeGreaterThan(larger * 5)
  })

  it("on a model whose primary lane is another, still the typical size prices as today", async () => {
    const lanes = new Set<string>()
    const models = LLM_MODEL_IDS.filter((id) => {
      const model = getLlmModel(id)
      if (!model) return false
      const lane = llmPrimaryLane(model, {})
      if (lanes.has(lane) || !hasLlmRate(id, lane)) return false
      lanes.add(lane)
      return true
    })
    expect(models.length, "at least two primary lanes among the models").toBeGreaterThan(1)
    for (const model of models) {
      expect(await price(chat(model, { ...TYPICAL })), model).toBe(await price(chat(model)))
      expect(await price(chat(model, { inputTokens: 200_000, outputTokens: 20_000 })), model).toBeGreaterThan(await price(chat(model)))
    }
  })

  it("prices as today when the field is not two positive integers within the bounds", async () => {
    const today = await price(chat(OPUS))
    for (const bad of [
      null,
      "1000",
      {},
      { inputTokens: 1000 },
      { inputTokens: 0, outputTokens: 1000 },
      { inputTokens: -5, outputTokens: 1000 },
      { inputTokens: 1000.5, outputTokens: 1000 },
      { inputTokens: "1000", outputTokens: 1000 },
      { inputTokens: EXPECTED_LLM_USAGE_MAX.inputTokens + 1, outputTokens: 1000 },
      { inputTokens: 1000, outputTokens: EXPECTED_LLM_USAGE_MAX.outputTokens + 1 },
    ]) {
      expect(expectedLlmUsageOf({ expectedUsage: bad }), JSON.stringify(bad)).toBeNull()
      expect(await price(chat(OPUS, bad)), JSON.stringify(bad)).toBe(today)
    }
    expect(expectedLlmUsageOf({ expectedUsage: { ...EXPECTED_LLM_USAGE_MAX } })).toEqual({ ...EXPECTED_LLM_USAGE_MAX })
  })

  it("never prices below the typical call: each token count is floored at it", async () => {
    const today = await price(chat(OPUS))
    expect(expectedLlmUsageOf({ expectedUsage: { inputTokens: 1, outputTokens: 1 } })).toEqual({ ...TYPICAL })
    expect(await price(chat(OPUS, { inputTokens: 1, outputTokens: 1 }))).toBe(today)
    // A larger output alone (input below the typical) still prices higher, at the typical input.
    expect(expectedLlmUsageOf({ expectedUsage: { inputTokens: 1, outputTokens: 50_000 } })).toEqual({ inputTokens: TYPICAL.inputTokens, outputTokens: 50_000 })
    expect(await price(chat(OPUS, { inputTokens: 1, outputTokens: 50_000 }))).toBeGreaterThan(today)
  })

  it("under the rollback, nothing changes", async () => {
    rollback(true)
    expect(await price(chat(OPUS, { inputTokens: 400_000, outputTokens: 40_000 }))).toBe(await price(chat(OPUS)))
  })
})
