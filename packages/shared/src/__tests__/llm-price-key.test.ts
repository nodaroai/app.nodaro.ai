import { describe, expect, it } from "vitest"
import {
  LLM_FEATURE_DEFAULTS,
  LLM_FEATURE_DEFAULTS_FROM,
  LLM_MODELS,
  LLM_REASONING_EFFORTS,
  STRUCTURED_VISION_MODELS,
  defaultReasoningEffort,
  effectiveReasoningEffort,
  getLlmModel,
  llmDefaultsFeature,
  llmPriceKey,
  llmSendsSchema,
  llmServesDirect,
  parseLlmPriceKeyModel,
  structuredWireMode,
} from "../entries/llm-models.js"

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

// A model whose price depends on the effort a call sends (`effortPriced`)
// names that effort in its key — no model does today (GPT-6.1 Terra did for
// part of 2026-11-12), so every key is exactly what it was before the suffix
// existed. The mechanism is exercised on a stand-in: Terra flagged for the
// length of one test.
describe("llmPriceKey: the effort, on a model whose price depends on it (`effortPriced`)", () => {
  /** The key as it was built before effort-priced models existed. */
  const keyBefore = (feature: string, modelId: string, effort?: string, advanced?: boolean) => {
    const e = effort ?? defaultReasoningEffort(llmDefaultsFeature(feature), modelId)
    return llmServesDirect(modelId, e, advanced) ? `${feature}:${modelId}:direct` : `${feature}:${modelId}`
  }
  /** Run `fn` with `modelId` flagged `effortPriced`, then put the registry back. */
  const whileEffortPriced = (modelId: string, fn: () => void) => {
    const model = getLlmModel(modelId) as { effortPriced?: true }
    const before = model.effortPriced
    model.effortPriced = true
    try {
      fn()
    } finally {
      if (before === undefined) delete model.effortPriced
      else model.effortPriced = before
    }
  }

  it("no model is effort-priced today", () => {
    expect(LLM_MODELS.filter((m) => m.effortPriced).map((m) => m.id)).toEqual([])
  })

  it("every model's key is unchanged, at every effort, with Advanced mode on or off", () => {
    for (const m of LLM_MODELS) {
      for (const feature of ["llm-chat", "ai-writer", "describe-to-picker", "text-to-picker"]) {
        for (const effort of [undefined, ...LLM_REASONING_EFFORTS]) {
          for (const advanced of [false, true]) {
            expect(llmPriceKey(feature, m.id, effort, advanced), `${feature} ${m.id} ${effort} ${advanced}`).toBe(keyBefore(feature, m.id, effort, advanced))
          }
        }
      }
    }
  })

  it("GPT-6.1 Terra's key is the bare key at every effort", () => {
    for (const effort of [undefined, ...LLM_REASONING_EFFORTS]) {
      expect(llmPriceKey("llm-chat", "gpt-6.1-terra", effort), String(effort)).toBe("llm-chat:gpt-6.1-terra")
      expect(llmPriceKey("ai-writer", "gpt-6.1-terra", effort), String(effort)).toBe("ai-writer:gpt-6.1-terra")
    }
  })

  it("an effort-priced model's key names the effort its call sends: none at Auto (or a level it does not offer), the level otherwise", () => {
    whileEffortPriced("gpt-6.1-terra", () => {
      expect(llmPriceKey("llm-chat", "gpt-6.1-terra")).toBe("llm-chat:gpt-6.1-terra")
      expect(llmPriceKey("llm-chat", "gpt-6.1-terra", "none")).toBe("llm-chat:gpt-6.1-terra")
      expect(llmPriceKey("llm-chat", "gpt-6.1-terra", "high")).toBe("llm-chat:gpt-6.1-terra:effort-high")
      expect(llmPriceKey("ai-writer", "gpt-6.1-terra", "max", true)).toBe("ai-writer:gpt-6.1-terra:effort-max")
      expect(parseLlmPriceKeyModel("gpt-6.1-terra:effort-high")).toEqual({ modelId: "gpt-6.1-terra", reasoningEffort: "high" })
      // A level it does not offer, and both suffixes at once, are no key.
      expect(parseLlmPriceKeyModel("gpt-6.1-terra:effort-none")).toBeNull()
      expect(parseLlmPriceKeyModel("gpt-6.1-terra:effort-high:direct")).toBeNull()
      expect(parseLlmPriceKeyModel("gpt-6.1-terra:direct:effort-high")).toBeNull()
    })
    expect(getLlmModel("gpt-6.1-terra")?.effortPriced).toBeUndefined()
  })

  it("parseLlmPriceKeyModel reads back exactly the keys llmPriceKey builds", () => {
    expect(parseLlmPriceKeyModel("gpt-6.1-terra")).toEqual({ modelId: "gpt-6.1-terra" })
    expect(parseLlmPriceKeyModel("claude-opus-5.5:direct")).toEqual({ modelId: "claude-opus-5.5", lane: "direct" })
    for (const m of LLM_MODELS) {
      for (const effort of [undefined, ...LLM_REASONING_EFFORTS]) {
        for (const advanced of [false, true]) {
          const key = llmPriceKey("llm-chat", m.id, effort, advanced)
          expect(parseLlmPriceKeyModel(key.slice("llm-chat:".length))?.modelId, key).toBe(m.id)
        }
      }
    }
  })

  it("parseLlmPriceKeyModel refuses what no key carries", () => {
    // An effort on a model whose price does not depend on it — Terra's included now.
    expect(parseLlmPriceKeyModel("gpt-6.1-terra:effort-high")).toBeNull()
    expect(parseLlmPriceKeyModel("gpt-6.1-sol:effort-high")).toBeNull()
    expect(parseLlmPriceKeyModel("claude-opus-5.5:effort-high")).toBeNull()
    // Unknown models, borrowed slugs, other suffixes.
    expect(parseLlmPriceKeyModel("no-such-model")).toBeNull()
    expect(parseLlmPriceKeyModel("gpt-6-1-terra")).toBeNull()
    expect(parseLlmPriceKeyModel("gpt-6.1-terra:premium")).toBeNull()
  })
})

describe("effortBelowLowestSendsLowest (Kimi K3 and K3.1 Pro)", () => {
  it("a request below the lowest level sends the lowest level; Auto still sends nothing", () => {
    for (const id of ["kimi-k3", "kimi-k3.1-pro"]) {
      expect(getLlmModel(id)?.effortBelowLowestSendsLowest, id).toBe(true)
      expect(effectiveReasoningEffort(id, "none"), id).toBe("low")
      expect(effectiveReasoningEffort(id, undefined), id).toBeUndefined()
      expect(effectiveReasoningEffort(id, "low"), id).toBe("low")
    }
    // The clamp above the lowest level is unchanged.
    expect(effectiveReasoningEffort("kimi-k3.1-pro", "medium")).toBe("low")
    expect(effectiveReasoningEffort("kimi-k3.1-pro", "xhigh")).toBe("high")
    expect(effectiveReasoningEffort("kimi-k3", "medium")).toBe("medium")
    expect(effectiveReasoningEffort("kimi-k3", "max")).toBe("high")
  })

  it("only the two Kimi models declare it — every other model still drops a request below its lowest level", () => {
    expect(LLM_MODELS.filter((m) => m.effortBelowLowestSendsLowest).map((m) => m.id).sort()).toEqual(["kimi-k3", "kimi-k3.1-pro"])
    expect(effectiveReasoningEffort("gpt-6.1-sol", "none")).toBeUndefined()
    expect(effectiveReasoningEffort("gpt-6.1-terra", "none")).toBeUndefined()
    expect(effectiveReasoningEffort("gemini-4-carbon", "none")).toBeUndefined()
  })
})

describe("structured output: a trusted mode vs a schema hint", () => {
  it("Gemini 4 Carbon sends its schema as a hint, never as a trusted mode", () => {
    const carbon = getLlmModel("gemini-4-carbon")!
    expect(carbon.structuredOutputMode).toBeUndefined()
    expect(carbon.structuredOutputHint).toBe("kie-response-format")
    expect(structuredWireMode(carbon)).toBe("kie-response-format")
    expect(STRUCTURED_VISION_MODELS.map((m) => m.id)).not.toContain("gemini-4-carbon")
  })

  it("a hint is never set beside a trusted mode; a trusted model's wire mode is its mode", () => {
    for (const m of LLM_MODELS) {
      expect(m.structuredOutputMode !== undefined && m.structuredOutputHint !== undefined, m.id).toBe(false)
      if (m.structuredOutputMode) expect(structuredWireMode(m), m.id).toBe(m.structuredOutputMode)
    }
  })

  it("llmSendsSchema: a model that sends its schema (trusted or hinted) counts it; one that sends none does not", () => {
    expect(llmSendsSchema("gemini-4-carbon")).toBe(true)
    expect(llmSendsSchema("gpt-6.1-terra")).toBe(true)
    expect(llmSendsSchema("gpt-5.2")).toBe(false)
    // Unset model = the feature's default; an unknown model counts it.
    expect(llmSendsSchema(undefined, "llm-chat")).toBe(llmSendsSchema(LLM_FEATURE_DEFAULTS["llm-chat"]))
    expect(llmSendsSchema("no-such-model")).toBe(true)
  })
})
