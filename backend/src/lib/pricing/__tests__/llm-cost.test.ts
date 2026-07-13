import { describe, it, expect } from "vitest"
import { LLM_MODELS, getLlmModel } from "@nodaro/shared"
import { calculateLlmCost } from "../llm-cost.js"

describe("calculateLlmCost", () => {
  it("calculates cost for gemini-3-flash by model ID string", () => {
    // (1000 * 0.15 + 500 * 0.90) / 1_000_000 = (150 + 450) / 1_000_000 = 0.0006
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 1000, outputTokens: 500 })
    expect(cost).toBeCloseTo(0.0006, 10)
  })

  it("calculates cost for claude-sonnet-4.6 by model ID string", () => {
    // (1000 * 3.00 + 500 * 15.00) / 1_000_000 = (3000 + 7500) / 1_000_000 = 0.0105
    const cost = calculateLlmCost("claude-sonnet-4.6", { inputTokens: 1000, outputTokens: 500 })
    expect(cost).toBeCloseTo(0.0105, 10)
  })

  it("calculates cost when model def object is passed directly", () => {
    const model = getLlmModel("gpt-5.2")!
    // (2000 * 2.50 + 1000 * 10.00) / 1_000_000 = (5000 + 10000) / 1_000_000 = 0.015
    const cost = calculateLlmCost(model, { inputTokens: 2000, outputTokens: 1000 })
    expect(cost).toBeCloseTo(0.015, 10)
  })

  it("returns 0 for unknown model ID", () => {
    const cost = calculateLlmCost("nonexistent-model", { inputTokens: 5000, outputTokens: 5000 })
    expect(cost).toBe(0)
  })

  it("returns 0 for zero tokens", () => {
    const cost = calculateLlmCost("claude-opus-4.7", { inputTokens: 0, outputTokens: 0 })
    expect(cost).toBe(0)
  })

  it("handles large token counts (1M input + 1M output for claude-opus-4.7)", () => {
    // (1_000_000 * 1.425 + 1_000_000 * 7.15) / 1_000_000 = 1.425 + 7.15 = 8.575
    const cost = calculateLlmCost("claude-opus-4.7", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(8.575, 10)
  })

  it("handles input-only usage", () => {
    // (10_000 * 0.15) / 1_000_000 = 0.0015
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 10_000, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.0015, 10)
  })

  it("handles output-only usage", () => {
    // (10_000 * 0.90) / 1_000_000 = 0.009
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 0, outputTokens: 10_000 })
    expect(cost).toBeCloseTo(0.009, 10)
  })

  it("produces consistent results between model ID string and model def object", () => {
    const usage = { inputTokens: 12345, outputTokens: 6789 }
    for (const model of LLM_MODELS) {
      const costById = calculateLlmCost(model.id, usage)
      const costByDef = calculateLlmCost(model, usage)
      expect(costById).toBe(costByDef)
    }
  })

  it("has a rate entry for every model in LLM_MODELS (no silent 0-cost gap)", () => {
    for (const model of LLM_MODELS) {
      const cost = calculateLlmCost(model.id, { inputTokens: 1000, outputTokens: 1000 })
      expect(cost, `${model.id} should have a positive computed cost`).toBeGreaterThan(0)
    }
  })

  it("prices gpt-5.6-luna at KIE list rates", () => {
    // (1000 * 0.28 + 500 * 1.68) / 1_000_000 = 0.00112
    expect(calculateLlmCost("gpt-5.6-luna", { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.00112, 10)
  })
  it("prices claude-opus-4.8 at KIE list rates", () => {
    // 1M/1M: 2.00 + 10.00 = 12.00
    expect(calculateLlmCost("claude-opus-4.8", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(12.0, 10)
  })
  it("prices gpt-5.5 at KIE list rates", () => {
    // (1000 * 1.40 + 500 * 8.40) / 1_000_000 = 0.0056
    expect(calculateLlmCost("gpt-5.5", { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.0056, 10)
  })
})
