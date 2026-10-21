import { describe, expect, it } from "vitest"
import { LLM_MODELS, getLlmModel, reasoningOutputFloor, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { llmEffectiveOutputCap } from "../llm-node-output-cap.js"
import { deriveParams } from "../llm/params.js"
import type { LlmRequest } from "../llm/types.js"

describe("llmEffectiveOutputCap", () => {
  it("output cap: Fable asked 2000 → 32768 (thinkingDefaultOn, REASONING_OUTPUT_FLOOR)", () => {
    expect(llmEffectiveOutputCap(getLlmModel("claude-fable-5")!, { maxTokens: 2000 })).toBe(32768)
  })

  it("output cap: Gemini 3.8 Flash asked 8192 → its own floor 16384", () => {
    expect(llmEffectiveOutputCap(getLlmModel("gemini-3.8-flash")!, { maxTokens: 8192 })).toBe(16384)
  })

  it("output cap: a model without thinkingDefaultOn keeps 2000 unless effort is xhigh", () => {
    const m = LLM_MODELS.find((x) => !x.thinkingDefaultOn && x.reasoningEfforts?.includes("xhigh"))!
    expect(m).toBeDefined()
    expect(llmEffectiveOutputCap(m, { maxTokens: 2000 })).toBe(2000)
    expect(llmEffectiveOutputCap(m, { maxTokens: 2000, reasoningEffort: "high" })).toBe(2000)
    expect(llmEffectiveOutputCap(m, { maxTokens: 2000, reasoningEffort: "xhigh" })).toBe(reasoningOutputFloor(m))
  })

  it("no maxTokens asked → the model's own maximum (raised to the floor where thinking shares it)", () => {
    const m = LLM_MODELS.find((x) => !x.thinkingDefaultOn)!
    expect(llmEffectiveOutputCap(m, {})).toBe(m.maxOutputTokens)
  })

  it("deriveParams.maxTokens === llmEffectiveOutputCap for every model × effort {undefined,high,xhigh} × requireLane {undefined,direct}", () => {
    for (const model of LLM_MODELS) {
      for (const reasoningEffort of [undefined, "high", "xhigh"] as (LlmReasoningEffort | undefined)[]) {
        for (const requireLane of [undefined, "direct"] as const) {
          for (const maxTokens of [undefined, 2000]) {
            const req: LlmRequest = { modelId: model.id, system: "", messages: [], maxTokens, reasoningEffort, requireLane }
            expect(deriveParams(model, req).maxTokens, `${model.id} ${reasoningEffort} ${requireLane} ${maxTokens}`).toBe(
              llmEffectiveOutputCap(model, req),
            )
          }
        }
      }
    }
  })
})
