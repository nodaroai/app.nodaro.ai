import { describe, it, expect, vi, beforeEach } from "vitest"

const { llmCompleteMock } = vi.hoisted(() => ({ llmCompleteMock: vi.fn() }))

vi.mock("../llm-client.js", () => ({
  llmComplete: llmCompleteMock,
}))

vi.mock("../../../../packages/shared/src/llm-models.js", () => ({
  LLM_FEATURE_DEFAULTS: { translate: "gemini-flash" },
}))

import { translateToEnglish } from "../translate.js"

describe("translateToEnglish", () => {
  beforeEach(() => {
    llmCompleteMock.mockReset()
  })

  it("returns input untouched when non-ASCII ratio is below 10%", async () => {
    const text = "Hello world this is an english sentence 中" // 1 non-ASCII of 41 chars ≈ 2.4%
    const result = await translateToEnglish(text)
    expect(result).toBe(text)
    expect(llmCompleteMock).not.toHaveBeenCalled()
  })

  it("calls LLM for mostly non-ASCII text", async () => {
    llmCompleteMock.mockResolvedValue({ text: "  a translated sentence.  " })
    const result = await translateToEnglish("שלום עולם יפה")
    expect(result).toBe("a translated sentence.")
    expect(llmCompleteMock).toHaveBeenCalledTimes(1)
    const call = llmCompleteMock.mock.calls[0][0]
    expect(call.modelId).toBe("gemini-flash")
    expect(call.messages[0].role).toBe("user")
    expect(call.messages[0].content).toContain("שלום עולם יפה")
  })

  it("trims whitespace from the LLM response", async () => {
    llmCompleteMock.mockResolvedValue({ text: "\n\n  translated\n" })
    const result = await translateToEnglish("日本語のテキスト")
    expect(result).toBe("translated")
  })
})
