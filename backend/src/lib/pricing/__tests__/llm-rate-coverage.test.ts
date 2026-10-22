import { afterEach, describe, it, expect, vi } from "vitest"
import { LLM_MODELS, getLlmModel, supportsAdvancedMode } from "@nodaro/shared/llm-models"
import { kieCostUsd } from "../../llm/kie-cost.js"
import {
  LlmRateMissingError,
  calculateLlmCost,
  hasLlmRate,
  llmCostOrZero,
  llmPossibleLanes,
} from "../llm-cost.js"

describe("LLM rates fail closed", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("every registered LLM model has a rate on every lane it may be served on", () => {
    for (const m of LLM_MODELS) {
      for (const lane of llmPossibleLanes(m.id, "high", true).concat(llmPossibleLanes(m.id))) {
        expect(hasLlmRate(m.id, lane), `${m.id} on ${lane}`).toBe(true)
      }
    }
  })

  it("calculateLlmCost throws for a model with no rate", () => {
    expect(() => calculateLlmCost("no-such-model", { inputTokens: 1, outputTokens: 1 })).toThrow(LlmRateMissingError)
  })

  it("names the model and the lane on the error", () => {
    let caught: unknown
    try {
      calculateLlmCost("no-such-model", { inputTokens: 1, outputTokens: 1 }, "direct")
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(LlmRateMissingError)
    expect((caught as LlmRateMissingError).modelId).toBe("no-such-model")
    expect((caught as LlmRateMissingError).lane).toBe("direct")
  })

  it("prices Fable 5 at its KIE and direct rates", () => {
    expect(calculateLlmCost("claude-fable-5", { inputTokens: 2000, outputTokens: 2000 }, "kie")).toBeCloseTo(0.048, 6)
    expect(calculateLlmCost("claude-fable-5", { inputTokens: 2000, outputTokens: 2000 }, "direct")).toBeCloseTo(0.12, 6)
  })

  it("hasLlmRate direct needs a direct row; every model that can be served direct has one", () => {
    // gpt-5.2 carries only a KIE row: it has no direct price (calculateLlmCost's
    // direct→KIE row fallback is for cost logging only).
    expect(hasLlmRate("gpt-5.2", "direct")).toBe(false)
    for (const m of LLM_MODELS) {
      if (supportsAdvancedMode(m.id) || m.directOnly) expect(hasLlmRate(m.id, "direct"), m.id).toBe(true)
    }
    // gemini-4-argon is directOnly: a direct row and no KIE row.
    expect(hasLlmRate("gemini-4-argon", "direct")).toBe(true)
    expect(hasLlmRate("gemini-4-argon", "kie")).toBe(false)
    expect(hasLlmRate("no-such-model", "kie")).toBe(false)
  })

  it("llmPossibleLanes lists every lane that can serve the call, primary lane first", () => {
    // directOnly: KIE is never called.
    expect(getLlmModel("gemini-4-argon")?.directOnly).toBe(true)
    expect(llmPossibleLanes("gemini-4-argon")).toEqual(["direct"])
    expect(llmPossibleLanes("gemini-4-argon", "high", true)).toEqual(["direct"])
    // Served direct (an effort on an effortRequiresDirect Claude, or Advanced
    // mode): direct first, KIE as the account-exhaustion fallback.
    expect(getLlmModel("claude-opus-5.5")?.effortRequiresDirect).toBe(true)
    expect(llmPossibleLanes("claude-opus-5.5", "high")).toEqual(["direct", "kie"])
    expect(llmPossibleLanes("gemini-3.8-flash", undefined, true)).toEqual(["direct", "kie"])
    // KIE first, direct as the reliability fallback: a Claude with
    // directFallbackModel and a Gemini Flash with directGeminiModel.
    expect(llmPossibleLanes("claude-opus-5.5")).toEqual(["kie", "direct"])
    expect(getLlmModel("gemini-3.8-flash")?.directGeminiModel).toBeTruthy()
    expect(llmPossibleLanes("gemini-3.8-flash")).toEqual(["kie", "direct"])
    // No direct lane at all: KIE only, even when Advanced is asked for.
    expect(llmPossibleLanes("gpt-5.2")).toEqual(["kie"])
    expect(llmPossibleLanes("gpt-5.2", "high", true)).toEqual(["kie"])
  })

  it("kieCostUsd throws for an unpriced model (billing input)", () => {
    expect(() => kieCostUsd("no-such-model", { promptChars: 1, answerChars: 1 })).toThrow(LlmRateMissingError)
    // a stated KIE charge needs no rate
    expect(kieCostUsd("no-such-model", { creditsUsd: 0.5, promptChars: 1, answerChars: 1 })).toBe(0.5)
  })

  it("llmCostOrZero reports 0 for a missing rate (and warns) and the real cost otherwise", () => {
    const usage = { inputTokens: 2000, outputTokens: 2000 }
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(llmCostOrZero("no-such-model", usage)).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe("[llm-rate-missing] model=no-such-model lane=kie — cost reported as 0")
    warn.mockClear()
    expect(llmCostOrZero("claude-fable-5", usage, "kie")).toBe(calculateLlmCost("claude-fable-5", usage, "kie"))
    expect(warn).not.toHaveBeenCalled()
  })
})
