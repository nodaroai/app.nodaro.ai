/**
 * No model runs without a rate on EVERY lane it may be served on
 * (`llmPossibleLanes`): the hold prices the primary lane only, so a fallback
 * lane with no rate would leave the settle a cost it cannot compute. Pinned
 * with a synthetic registry entry: GPT-5.2's KIE row and NO direct row, given
 * a direct fallback lane it does not really have.
 */
import { describe, expect, it, vi } from "vitest"

vi.mock("@nodaro/shared/llm-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nodaro/shared/llm-models")>()
  const real = actual.getLlmModel("gpt-5.2")!
  const synthetic = { ...real, directFallbackModel: "gpt-5.2-direct", preferKie: true as const }
  return { ...actual, getLlmModel: (id: string) => (id === "gpt-5.2" ? synthetic : actual.getLlmModel(id)) }
})

const { llmHoldBaseCredits, LlmUnpricedModelError } = await import("../llm-metered.js")
const { llmPrecheckBaseCreditsImpl } = await import("../llm-billing-impl.js")
const { llmPossibleLanes, llmPrimaryLane } = await import("../../../lib/pricing/llm-cost.js")
const { getLlmModel } = await import("@nodaro/shared/llm-models")

const request: import("../../../lib/llm/types.js").LlmRequest = {
  modelId: "gpt-5.2",
  system: "",
  messages: [{ role: "user", content: "hello" }],
  maxTokens: 500,
}

describe("a hold refuses a model with no rate on a fallback lane", () => {
  it("the synthetic model is KIE-primary with a direct fallback", () => {
    expect(llmPrimaryLane(getLlmModel("gpt-5.2")!, request)).toBe("kie")
    expect(llmPossibleLanes("gpt-5.2")).toEqual(["kie", "direct"])
  })

  it("reserve: llmHoldBaseCredits refuses on the direct lane", () => {
    let thrown: unknown
    try {
      llmHoldBaseCredits("gpt-5.2", { request })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeInstanceOf(LlmUnpricedModelError)
    expect(thrown).toMatchObject({ modelId: "gpt-5.2", lane: "direct" })
  })

  it("precheck: the guard's pre-check refuses the same way", () => {
    expect(() => llmPrecheckBaseCreditsImpl("llm-chat", { llmModel: "gpt-5.2" }, 100)).toThrow(LlmUnpricedModelError)
  })
})
