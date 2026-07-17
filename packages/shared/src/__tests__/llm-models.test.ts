import {
  LLM_MODELS,
  LLM_MODEL_IDS,
  LLM_FEATURE_DEFAULTS,
  STRUCTURED_VISION_MODELS,
  LLM_REASONING_EFFORTS,
  getLlmModel,
  getLlmTier,
  buildLlmCreditIdentifier,
  resolveLlmCreditId,
  motionGraphicsFeature,
  effectiveReasoningEffort,
} from "../llm-models.js"
import type { LlmModelDef, LlmTier, LlmFeature } from "../llm-models.js"
import { PIPELINE_PINNABLE_SCRIPT_LLMS } from "../pipeline-types.js"

// The provider-$ per-token rate table and `calculateLlmCost` moved to
// backend/src/lib/pricing/llm-cost.ts (S5) — its tests live in
// backend/src/lib/pricing/__tests__/llm-cost.test.ts. This file covers only
// the NON-monetary model registry (ids, capabilities, tiers, feature
// defaults) that stays in the published package.

// ---------------------------------------------------------------------------
// LLM_MODELS data integrity
// ---------------------------------------------------------------------------
describe("LLM_MODELS data integrity", () => {
  it("should have exactly 13 models", () => {
    expect(LLM_MODELS).toHaveLength(13)
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

  it("has 3 economy, 4 standard, 6 premium models", () => {
    const tierCounts: Record<LlmTier, number> = { economy: 0, standard: 0, premium: 0 }
    for (const model of LLM_MODELS) {
      tierCounts[model.tier]++
    }
    expect(tierCounts.economy).toBe(3)
    expect(tierCounts.standard).toBe(4)
    expect(tierCounts.premium).toBe(6)
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
      "claude-opus-4.7",
      "gpt-5.4",
      "gpt-5.5",
      "gpt-5.6-luna",
      "gpt-5.6-terra",
      "gpt-5.6-sol",
      "claude-sonnet-5",
      "claude-opus-4.8",
    ]
    expect(LLM_MODEL_IDS).toEqual(expected)
  })
})

// ---------------------------------------------------------------------------
// getLlmModel
// ---------------------------------------------------------------------------
describe("getLlmModel", () => {
  // Dash-alias resolution: wire contracts (PIPELINE_PINNABLE_SCRIPT_LLMS,
  // provider slugs, persisted configs) carry dash forms while LLM_MODELS keys
  // canonical dot ids — getLlmModel must accept both or the film pipeline's
  // own script default throws "Unknown LLM model" at run time.
  it("resolves dash-form aliases to their canonical dot-form models", () => {
    expect(getLlmModel("claude-sonnet-4-6")?.id).toBe("claude-sonnet-4.6")
    expect(getLlmModel("claude-opus-4-7")?.id).toBe("claude-opus-4.7")
    expect(getLlmModel("claude-haiku-4-5")?.id).toBe("claude-haiku-4.5")
  })

  it("resolves every PIPELINE_PINNABLE_SCRIPT_LLMS member (the film pipeline's pin surface)", () => {
    for (const id of PIPELINE_PINNABLE_SCRIPT_LLMS) {
      expect(getLlmModel(id), `pinnable script llm ${id} must resolve`).toBeDefined()
    }
  })

  it("resolves provider slugs as historical aliases", () => {
    const dated = LLM_MODELS.find((m) => m.directFallbackModel && m.directFallbackModel !== m.id)
    if (dated) expect(getLlmModel(dated.directFallbackModel!)?.id).toBe(dated.id)
  })

  it("still returns undefined for a genuinely unknown id", () => {
    expect(getLlmModel("claude-sonnet-9-9")).toBeUndefined()
    expect(getLlmModel("not-a-model")).toBeUndefined()
  })

  it('returns model def for "gemini-3-flash"', () => {
    const model = getLlmModel("gemini-3-flash")
    expect(model).toBeDefined()
    expect(model!.id).toBe("gemini-3-flash")
    expect(model!.tier).toBe("economy")
    expect(model!.vendor).toBe("google")
    expect(model!.kieFormat).toBe("chat-completions")
  })

  it('returns model def for "claude-opus-4.7" with directFallbackModel', () => {
    const model = getLlmModel("claude-opus-4.7")
    expect(model).toBeDefined()
    expect(model!.id).toBe("claude-opus-4.7")
    expect(model!.tier).toBe("premium")
    expect(model!.vendor).toBe("anthropic")
    expect(model!.directFallbackModel).toBe("claude-opus-4-7")
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
    ["claude-opus-4.7", "premium"],
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
    expect(buildLlmCreditIdentifier("scene-graph-ai", "claude-opus-4.7")).toBe(
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
      "image-critic",
    ]

    for (const feature of features) {
      // economy
      const economy = buildLlmCreditIdentifier(feature, "gemini-3-flash")
      expect(economy).toBe(`${feature}:economy`)

      // standard
      const standard = buildLlmCreditIdentifier(feature, "claude-sonnet-4.6")
      expect(standard).toBe(feature)

      // premium
      const premium = buildLlmCreditIdentifier(feature, "claude-opus-4.7")
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
    expect(resolveLlmCreditId("ai-writer", { llmModel: "claude-opus-4.7" })).toBe(
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
    "motion-graphics-lottie",
    "lottie-overlay",
    "3d-title",
    "image-to-text",
    "describe-to-picker",
    "qa-check",
    "generate-script",
    "translate",
    "image-critic",
  ]

  it("has entries for all 15 features", () => {
    expect(Object.keys(LLM_FEATURE_DEFAULTS)).toHaveLength(15)
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

  it('"describe-to-picker" defaults to "claude-opus-4.7" (premium vision)', () => {
    expect(LLM_FEATURE_DEFAULTS["describe-to-picker"]).toBe("claude-opus-4.7")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["describe-to-picker"])).toBe("premium")
    // The default MUST be an accepted analyzer model (vision + structured output).
    expect(STRUCTURED_VISION_MODELS.map((m) => m.id)).toContain("claude-opus-4.7")
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
      "motion-graphics-lottie",
      "lottie-overlay",
      "3d-title",
    ]
    for (const feature of compositionFeatures) {
      expect(LLM_FEATURE_DEFAULTS[feature]).toBe("claude-sonnet-4.6")
    }
  })
})

// ---------------------------------------------------------------------------
// motionGraphicsFeature
// ---------------------------------------------------------------------------
describe("motionGraphicsFeature", () => {
  it.each([
    [undefined, "motion-graphics"],
    ["elements", "motion-graphics"],
    ["lottie", "motion-graphics-lottie"],
    ["junk", "motion-graphics"],
  ] as const)("%s -> %s", (engine, expected) => {
    expect(motionGraphicsFeature(engine)).toBe(expected)
  })
})

// ---------------------------------------------------------------------------
// STRUCTURED_VISION_MODELS — describe-to-picker's single source of truth
// (the model picker AND the backend route gate both derive from this list)
// ---------------------------------------------------------------------------
describe("STRUCTURED_VISION_MODELS", () => {
  it("is exactly the vision models with a guaranteed structured-output mode", () => {
    const ids = STRUCTURED_VISION_MODELS.map((m) => m.id).sort()
    expect(ids).toEqual(
      [
        "claude-haiku-4.5",
        "claude-opus-4.7",
        "claude-sonnet-4.6",
        "gemini-3-flash",
        "gemini-3.1-pro",
        "claude-sonnet-5",
        "claude-opus-4.8",
        // responses-format GPTs — KIE text.format json_schema live-verified
        // 2026-07-14 (text AND vision inputs).
        "gpt-5.4",
        "gpt-5.5",
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
      ].sort(),
    )
  })

  it("includes Anthropic (forced-tool), Gemini (response_format), and OpenAI (responses text.format) vendors", () => {
    const vendors = new Set(STRUCTURED_VISION_MODELS.map((m) => m.vendor))
    expect(vendors).toContain("anthropic")
    expect(vendors).toContain("google")
    expect(vendors).toContain("openai")
  })

  it("excludes chat-completions GPT models — no native structured mode there (parse+retry only)", () => {
    const ids = STRUCTURED_VISION_MODELS.map((m) => m.id)
    expect(ids).not.toContain("gpt-5.2")
  })

  it("every member is vision-capable and has a structuredOutputMode", () => {
    for (const m of STRUCTURED_VISION_MODELS) {
      expect(m.supportsImages).toBe(true)
      expect(m.structuredOutputMode).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// Reasoning effort registry (GPT-5.6 / Claude Sonnet 5 / Claude Opus 4.8)
// grok-4.5 is DEFERRED — its chat endpoint is not live on the provider yet
// (2026-07-13); its tests are intentionally omitted here.
// ---------------------------------------------------------------------------
describe("reasoning effort registry", () => {
  it("every reasoningEfforts list is a subset of the superset, in ascending order", () => {
    const rank = Object.fromEntries(LLM_REASONING_EFFORTS.map((e, i) => [e, i]))
    for (const m of LLM_MODELS) {
      for (const e of m.reasoningEfforts ?? []) expect(LLM_REASONING_EFFORTS).toContain(e)
      const ranks = (m.reasoningEfforts ?? []).map((e) => rank[e])
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    }
  })
  it("new models exist with expected tiers", () => {
    expect(getLlmTier("gpt-5.6-luna")).toBe("economy")
    expect(getLlmTier("gpt-5.6-terra")).toBe("standard")
    expect(getLlmTier("gpt-5.6-sol")).toBe("premium")
    expect(getLlmTier("claude-sonnet-5")).toBe("standard")
    expect(getLlmTier("claude-opus-4.8")).toBe("premium")
    expect(getLlmTier("gpt-5.5")).toBe("premium")
  })
})

describe("effectiveReasoningEffort", () => {
  it("passes through a supported level", () => {
    expect(effectiveReasoningEffort("claude-sonnet-5", "max")).toBe("max")
  })
  it("clamps down to the highest supported level ≤ requested", () => {
    expect(effectiveReasoningEffort("gpt-5.4", "xhigh")).toBe("high")
  })
  it("returns undefined when the model has no levels", () => {
    expect(effectiveReasoningEffort("gemini-3-flash", "high")).toBeUndefined()
  })
  it("returns undefined for none on Claude (below its lowest level)", () => {
    expect(effectiveReasoningEffort("claude-sonnet-5", "none")).toBeUndefined()
  })
  it("returns undefined for undefined/garbage input", () => {
    expect(effectiveReasoningEffort("claude-sonnet-5", undefined)).toBeUndefined()
    expect(effectiveReasoningEffort("claude-sonnet-5", "turbo")).toBeUndefined()
  })
})

describe("buildLlmCreditIdentifier effort bump (xhigh/max only)", () => {
  it("economy + max → standard (bare feature)", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "gpt-5.6-luna", "max")).toBe("llm-chat")
  })
  it("standard + xhigh → premium", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "gpt-5.6-terra", "xhigh")).toBe("llm-chat:premium")
  })
  it("premium + max stays premium", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "gpt-5.6-sol", "max")).toBe("llm-chat:premium")
  })
  it("high never bumps", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "claude-sonnet-5", "high")).toBe("llm-chat")
  })
  it("clamp on a partial-list standard model never bumps (sonnet-4.6 @ xhigh → high)", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "claude-sonnet-4.6", "xhigh")).toBe("llm-chat")
  })
  it("bump uses the CLAMPED effort (xhigh on a low/medium/high model clamps to high → no bump)", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "gpt-5.4", "xhigh")).toBe("llm-chat:premium")
    // gpt-5.4 is premium anyway; the real clamp case:
    expect(buildLlmCreditIdentifier("llm-chat", "gemini-3-flash", "max")).toBe("llm-chat:economy")
  })
  it("back-compat: no effort arg → identical to today for every model", () => {
    for (const m of LLM_MODELS) {
      const before = m.tier === "standard" ? "x" : `x:${m.tier}`
      expect(buildLlmCreditIdentifier("x", m.id)).toBe(before)
    }
  })
  it("resolveLlmCreditId reads reasoningEffort from the raw body", () => {
    expect(resolveLlmCreditId("llm-chat", { llmModel: "gpt-5.6-terra", reasoningEffort: "max" })).toBe("llm-chat:premium")
  })
})
