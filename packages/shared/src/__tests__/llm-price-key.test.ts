import { describe, expect, it } from "vitest"
import { LLM_FEATURE_DEFAULTS, LLM_FEATURE_DEFAULTS_FROM, llmDefaultsFeature, llmPriceKey } from "../entries/llm-models.js"

// The key a client asks `POST /v1/credits/model-costs` for a metered LLM
// call's price with: `<feature>:<model>`, plus `:direct` when the call is
// served on the vendor's own API (it is then priced at the direct rate).
describe("llmPriceKey", () => {
  it("is <feature>:<model> for a call on the model's primary lane", () => {
    expect(llmPriceKey("llm-chat", "claude-opus-5.5")).toBe("llm-chat:claude-opus-5.5")
    expect(llmPriceKey("llm-chat", "gemini-3.8-flash")).toBe("llm-chat:gemini-3.8-flash")
  })

  it("adds :direct when an effort runs the model direct", () => {
    expect(llmPriceKey("llm-chat", "claude-opus-5.5", "high")).toBe("llm-chat:claude-opus-5.5:direct")
  })

  it("adds :direct in Advanced mode, only for a model that has it", () => {
    expect(llmPriceKey("llm-chat", "claude-opus-5.5", undefined, true)).toBe("llm-chat:claude-opus-5.5:direct")
    // GPT has no direct lane: Advanced mode cannot apply, so the key is the KIE one.
    expect(llmPriceKey("llm-chat", "gpt-5.2", undefined, true)).toBe("llm-chat:gpt-5.2")
    expect(llmPriceKey("llm-chat", "gpt-5.2", "high")).toBe("llm-chat:gpt-5.2")
  })

  it("reads the feature's default effort when none is sent, as the run does", () => {
    // describe-to-picker runs Opus 5.5 at `high` by default (LLM_FEATURE_DEFAULT_EFFORTS),
    // which only Anthropic's own API honours: the call is held and charged direct.
    expect(llmPriceKey("describe-to-picker", "claude-opus-5.5")).toBe("describe-to-picker:claude-opus-5.5:direct")
    // …only on that model.
    expect(llmPriceKey("describe-to-picker", "claude-sonnet-5.5")).toBe("describe-to-picker:claude-sonnet-5.5")
  })

  it("a feature that borrows its defaults reads the effort of the feature it borrows from", () => {
    // Text to Picker runs on Describe to Picker's defaults: Opus 5.5 at high → direct.
    expect(llmPriceKey("text-to-picker", "claude-opus-5.5")).toBe("text-to-picker:claude-opus-5.5:direct")
    // Generate Structured runs on Generate Text's (no recipe effort), the Choose
    // Best judge on pick-best-llm's (none): their Opus 5.5 calls run on KIE.
    expect(llmPriceKey("llm-structured", "claude-opus-5.5")).toBe("llm-structured:claude-opus-5.5")
    expect(llmPriceKey("reduce:pick-best-llm", "claude-opus-5.5")).toBe("reduce:pick-best-llm:claude-opus-5.5")
    // An explicit effort still decides.
    expect(llmPriceKey("llm-structured", "claude-opus-5.5", "high")).toBe("llm-structured:claude-opus-5.5:direct")
  })

  it("llmDefaultsFeature maps the borrowing features and leaves the rest alone", () => {
    expect(llmDefaultsFeature("text-to-picker")).toBe("describe-to-picker")
    expect(llmDefaultsFeature("llm-structured")).toBe("llm-chat")
    expect(llmDefaultsFeature("reduce:pick-best-llm")).toBe("pick-best-llm")
    expect(llmDefaultsFeature("llm-chat")).toBe("llm-chat")
    expect(llmDefaultsFeature("toString")).toBe("toString")
    for (const target of Object.values(LLM_FEATURE_DEFAULTS_FROM)) expect(LLM_FEATURE_DEFAULTS).toHaveProperty(target)
  })

  it("refuses an unresolved (empty) model id", () => {
    expect(() => llmPriceKey("llm-chat", "")).toThrow(TypeError)
  })
})
