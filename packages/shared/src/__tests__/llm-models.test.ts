import {
  LLM_MODELS,
  LLM_MODEL_IDS,
  LLM_FEATURE_DEFAULTS,
  calculateLlmCost,
  getLlmModel,
  getLlmTier,
  buildLlmCreditIdentifier,
  resolveLlmCreditId,
} from "../llm-models.js"
import type { LlmModelDef, LlmTier, LlmFeature } from "../llm-models.js"

// ---------------------------------------------------------------------------
// LLM_MODELS data integrity
// ---------------------------------------------------------------------------
describe("LLM_MODELS data integrity", () => {
  it("should have exactly 7 models", () => {
    expect(LLM_MODELS).toHaveLength(7)
  })

  it("each model has all required fields", () => {
    const requiredKeys: (keyof LlmModelDef)[] = [
      "id",
      "displayName",
      "tier",
      "kieFormat",
      "kieSlugOrModel",
      "vendor",
      "supportsImages",
      "maxOutputTokens",
      "inputPricePerM",
      "outputPricePerM",
    ]

    for (const model of LLM_MODELS) {
      for (const key of requiredKeys) {
        expect(model).toHaveProperty(key)
        expect(model[key]).toBeDefined()
      }
    }
  })

  it("each model id is a non-empty string", () => {
    for (const model of LLM_MODELS) {
      expect(typeof model.id).toBe("string")
      expect(model.id.length).toBeGreaterThan(0)
    }
  })

  it("model ids are unique", () => {
    const ids = LLM_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("has 2 economy, 2 standard, 3 premium models", () => {
    const tierCounts: Record<LlmTier, number> = { economy: 0, standard: 0, premium: 0 }
    for (const model of LLM_MODELS) {
      tierCounts[model.tier]++
    }
    expect(tierCounts.economy).toBe(2)
    expect(tierCounts.standard).toBe(2)
    expect(tierCounts.premium).toBe(3)
  })

  it("all three kieFormats are represented", () => {
    const formats = new Set(LLM_MODELS.map((m) => m.kieFormat))
    expect(formats).toContain("chat-completions")
    expect(formats).toContain("messages")
    expect(formats).toContain("responses")
  })

  it("all three vendors are represented", () => {
    const vendors = new Set(LLM_MODELS.map((m) => m.vendor))
    expect(vendors).toContain("anthropic")
    expect(vendors).toContain("google")
    expect(vendors).toContain("openai")
  })

  it("all models support images", () => {
    for (const model of LLM_MODELS) {
      expect(model.supportsImages).toBe(true)
    }
  })

  it("all models have positive pricing values", () => {
    for (const model of LLM_MODELS) {
      expect(model.inputPricePerM).toBeGreaterThan(0)
      expect(model.outputPricePerM).toBeGreaterThan(0)
    }
  })

  it("all models have positive maxOutputTokens", () => {
    for (const model of LLM_MODELS) {
      expect(model.maxOutputTokens).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// LLM_MODEL_IDS
// ---------------------------------------------------------------------------
describe("LLM_MODEL_IDS", () => {
  it("matches model ids from LLM_MODELS in same order", () => {
    expect(LLM_MODEL_IDS).toEqual(LLM_MODELS.map((m) => m.id))
  })

  it("contains all expected model ids", () => {
    const expected = [
      "gemini-3-flash",
      "claude-haiku-4.5",
      "claude-sonnet-4.6",
      "gpt-5.2",
      "gemini-3.1-pro",
      "claude-opus-4.6",
      "gpt-5.4",
    ]
    expect(LLM_MODEL_IDS).toEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// getLlmModel
// ---------------------------------------------------------------------------
describe("getLlmModel", () => {
  it('returns model def for "gemini-3-flash"', () => {
    const model = getLlmModel("gemini-3-flash")
    expect(model).toBeDefined()
    expect(model!.id).toBe("gemini-3-flash")
    expect(model!.tier).toBe("economy")
    expect(model!.vendor).toBe("google")
    expect(model!.kieFormat).toBe("chat-completions")
    expect(model!.inputPricePerM).toBe(0.10)
    expect(model!.outputPricePerM).toBe(0.40)
  })

  it('returns model def for "claude-opus-4.6" with directFallbackModel', () => {
    const model = getLlmModel("claude-opus-4.6")
    expect(model).toBeDefined()
    expect(model!.id).toBe("claude-opus-4.6")
    expect(model!.tier).toBe("premium")
    expect(model!.vendor).toBe("anthropic")
    expect(model!.directFallbackModel).toBe("claude-opus-4-6")
  })

  it('returns model def for "claude-haiku-4.5" with directFallbackModel', () => {
    const model = getLlmModel("claude-haiku-4.5")
    expect(model).toBeDefined()
    expect(model!.directFallbackModel).toBe("claude-haiku-4-5-20251001")
  })

  it("returns undefined for unknown model id", () => {
    expect(getLlmModel("nonexistent-model")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(getLlmModel("")).toBeUndefined()
  })

  it("returns correct model for every id in LLM_MODEL_IDS", () => {
    for (const id of LLM_MODEL_IDS) {
      const model = getLlmModel(id)
      expect(model).toBeDefined()
      expect(model!.id).toBe(id)
    }
  })
})

// ---------------------------------------------------------------------------
// getLlmTier
// ---------------------------------------------------------------------------
describe("getLlmTier", () => {
  it.each([
    ["gemini-3-flash", "economy"],
    ["claude-haiku-4.5", "economy"],
  ] as const)("%s -> %s", (id, expected) => {
    expect(getLlmTier(id)).toBe(expected)
  })

  it.each([
    ["claude-sonnet-4.6", "standard"],
    ["gpt-5.2", "standard"],
  ] as const)("%s -> %s", (id, expected) => {
    expect(getLlmTier(id)).toBe(expected)
  })

  it.each([
    ["gemini-3.1-pro", "premium"],
    ["claude-opus-4.6", "premium"],
    ["gpt-5.4", "premium"],
  ] as const)("%s -> %s", (id, expected) => {
    expect(getLlmTier(id)).toBe(expected)
  })

  it('defaults to "standard" for unknown model id', () => {
    expect(getLlmTier("totally-fake-model")).toBe("standard")
  })

  it('defaults to "standard" for empty string', () => {
    expect(getLlmTier("")).toBe("standard")
  })
})

// ---------------------------------------------------------------------------
// calculateLlmCost
// ---------------------------------------------------------------------------
describe("calculateLlmCost", () => {
  it("calculates cost for gemini-3-flash by model ID string", () => {
    // (1000 * 0.10 + 500 * 0.40) / 1_000_000 = (100 + 200) / 1_000_000 = 0.0003
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 1000, outputTokens: 500 })
    expect(cost).toBeCloseTo(0.0003, 10)
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
    const cost = calculateLlmCost("claude-opus-4.6", { inputTokens: 0, outputTokens: 0 })
    expect(cost).toBe(0)
  })

  it("handles large token counts (1M input + 1M output for claude-opus-4.6)", () => {
    // (1_000_000 * 15.00 + 1_000_000 * 75.00) / 1_000_000 = 15.00 + 75.00 = 90.00
    const cost = calculateLlmCost("claude-opus-4.6", {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    })
    expect(cost).toBeCloseTo(90.0, 10)
  })

  it("handles input-only usage", () => {
    // (10_000 * 0.10) / 1_000_000 = 0.001
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 10_000, outputTokens: 0 })
    expect(cost).toBeCloseTo(0.001, 10)
  })

  it("handles output-only usage", () => {
    // (10_000 * 0.40) / 1_000_000 = 0.004
    const cost = calculateLlmCost("gemini-3-flash", { inputTokens: 0, outputTokens: 10_000 })
    expect(cost).toBeCloseTo(0.004, 10)
  })

  it("produces consistent results between model ID string and model def object", () => {
    const usage = { inputTokens: 12345, outputTokens: 6789 }
    for (const model of LLM_MODELS) {
      const costById = calculateLlmCost(model.id, usage)
      const costByDef = calculateLlmCost(model, usage)
      expect(costById).toBe(costByDef)
    }
  })
})

// ---------------------------------------------------------------------------
// buildLlmCreditIdentifier
// ---------------------------------------------------------------------------
describe("buildLlmCreditIdentifier", () => {
  it("returns bare feature name when no modelId provided", () => {
    expect(buildLlmCreditIdentifier("ai-writer")).toBe("ai-writer")
  })

  it("returns bare feature name when modelId is undefined", () => {
    expect(buildLlmCreditIdentifier("scene-graph-ai", undefined)).toBe("scene-graph-ai")
  })

  it('appends ":economy" for economy-tier models', () => {
    expect(buildLlmCreditIdentifier("ai-writer", "gemini-3-flash")).toBe("ai-writer:economy")
    expect(buildLlmCreditIdentifier("prompt-helper", "claude-haiku-4.5")).toBe(
      "prompt-helper:economy",
    )
  })

  it("returns bare feature name for standard-tier models (backward compat)", () => {
    expect(buildLlmCreditIdentifier("ai-writer", "claude-sonnet-4.6")).toBe("ai-writer")
    expect(buildLlmCreditIdentifier("scene-graph-ai", "gpt-5.2")).toBe("scene-graph-ai")
  })

  it('appends ":premium" for premium-tier models', () => {
    expect(buildLlmCreditIdentifier("scene-graph-ai", "claude-opus-4.6")).toBe(
      "scene-graph-ai:premium",
    )
    expect(buildLlmCreditIdentifier("ai-writer", "gpt-5.4")).toBe("ai-writer:premium")
    expect(buildLlmCreditIdentifier("after-effects", "gemini-3.1-pro")).toBe(
      "after-effects:premium",
    )
  })

  it("treats unknown model as standard tier (no suffix)", () => {
    // getLlmTier defaults to "standard" for unknown models
    expect(buildLlmCreditIdentifier("ai-writer", "fake-model")).toBe("ai-writer")
  })

  it("works with all LLM feature names", () => {
    const features: LlmFeature[] = [
      "ai-writer",
      "llm-chat",
      "prompt-helper",
      "scene-graph-ai",
      "after-effects",
      "motion-graphics",
      "lottie-overlay",
      "3d-title",
      "image-to-text",
      "qa-check",
      "generate-script",
      "translate",
    ]

    for (const feature of features) {
      // economy
      const economy = buildLlmCreditIdentifier(feature, "gemini-3-flash")
      expect(economy).toBe(`${feature}:economy`)

      // standard
      const standard = buildLlmCreditIdentifier(feature, "claude-sonnet-4.6")
      expect(standard).toBe(feature)

      // premium
      const premium = buildLlmCreditIdentifier(feature, "claude-opus-4.6")
      expect(premium).toBe(`${feature}:premium`)
    }
  })
})

// ---------------------------------------------------------------------------
// resolveLlmCreditId
// ---------------------------------------------------------------------------
describe("resolveLlmCreditId", () => {
  it("uses llmModel from body when present (economy)", () => {
    expect(resolveLlmCreditId("ai-writer", { llmModel: "gemini-3-flash" })).toBe(
      "ai-writer:economy",
    )
  })

  it("uses llmModel from body when present (standard)", () => {
    expect(resolveLlmCreditId("ai-writer", { llmModel: "claude-sonnet-4.6" })).toBe("ai-writer")
  })

  it("uses llmModel from body when present (premium)", () => {
    expect(resolveLlmCreditId("ai-writer", { llmModel: "claude-opus-4.6" })).toBe(
      "ai-writer:premium",
    )
  })

  it("returns bare feature when body has no llmModel", () => {
    expect(resolveLlmCreditId("ai-writer", { prompt: "hello" })).toBe("ai-writer")
  })

  it("returns bare feature when body is empty object", () => {
    expect(resolveLlmCreditId("prompt-helper", {})).toBe("prompt-helper")
  })

  it("returns bare feature when body is null", () => {
    expect(resolveLlmCreditId("scene-graph-ai", null)).toBe("scene-graph-ai")
  })

  it("returns bare feature when body is undefined", () => {
    expect(resolveLlmCreditId("after-effects", undefined)).toBe("after-effects")
  })

  it("handles body with llmModel set to undefined", () => {
    expect(resolveLlmCreditId("translate", { llmModel: undefined })).toBe("translate")
  })

  it("works across different features", () => {
    const body = { llmModel: "gpt-5.4" }
    expect(resolveLlmCreditId("3d-title", body)).toBe("3d-title:premium")
    expect(resolveLlmCreditId("motion-graphics", body)).toBe("motion-graphics:premium")
    expect(resolveLlmCreditId("lottie-overlay", body)).toBe("lottie-overlay:premium")
  })
})

// ---------------------------------------------------------------------------
// LLM_FEATURE_DEFAULTS
// ---------------------------------------------------------------------------
describe("LLM_FEATURE_DEFAULTS", () => {
  const ALL_FEATURES: LlmFeature[] = [
    "ai-writer",
    "llm-chat",
    "prompt-helper",
    "scene-graph-ai",
    "after-effects",
    "motion-graphics",
    "lottie-overlay",
    "3d-title",
    "image-to-text",
    "qa-check",
    "generate-script",
    "translate",
    "image-critic",
  ]

  it("has entries for all 13 features", () => {
    expect(Object.keys(LLM_FEATURE_DEFAULTS)).toHaveLength(13)
    for (const feature of ALL_FEATURES) {
      expect(LLM_FEATURE_DEFAULTS).toHaveProperty(feature)
    }
  })

  it("all default values are valid model IDs", () => {
    for (const [feature, modelId] of Object.entries(LLM_FEATURE_DEFAULTS)) {
      const model = getLlmModel(modelId)
      expect(model).toBeDefined()
    }
  })

  it('"prompt-helper" defaults to "gemini-3-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["prompt-helper"]).toBe("gemini-3-flash")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["prompt-helper"])).toBe("economy")
  })

  it('"ai-writer" defaults to "claude-sonnet-4.6" (standard)', () => {
    expect(LLM_FEATURE_DEFAULTS["ai-writer"]).toBe("claude-sonnet-4.6")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["ai-writer"])).toBe("standard")
  })

  it('"generate-script" defaults to "gemini-3-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["generate-script"]).toBe("gemini-3-flash")
  })

  it('"translate" defaults to "gemini-3-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["translate"]).toBe("gemini-3-flash")
  })

  it("composition features default to claude-sonnet-4.6", () => {
    const compositionFeatures: LlmFeature[] = [
      "scene-graph-ai",
      "after-effects",
      "motion-graphics",
      "lottie-overlay",
      "3d-title",
    ]
    for (const feature of compositionFeatures) {
      expect(LLM_FEATURE_DEFAULTS[feature]).toBe("claude-sonnet-4.6")
    }
  })
})
