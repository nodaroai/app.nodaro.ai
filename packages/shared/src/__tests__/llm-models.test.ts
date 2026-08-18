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
  supportsAdvancedMode,
  availableReasoningEfforts,
  LLM_VENDOR_ORDER,
  LLM_VENDOR_LABELS,
  groupLlmModelsByVendor,
  orderedLlmModels,
} from "../llm-models.js"
import type { LlmModelDef, LlmTier, LlmFeature } from "../llm-models.js"
import { PIPELINE_PINNABLE_SCRIPT_LLMS } from "../pipeline-types.js"

// The provider-$ per-token rate table and `calculateLlmCost` moved to
// backend/src/lib/pricing/llm-cost.ts (S5) — its tests live in
// backend/src/lib/pricing/__tests__/llm-cost.test.ts. This file covers only
// the NON-monetary model registry (ids, capabilities, tiers, feature
// defaults) that stays in the published package.

/** The registry's expected membership, in order — the single list both the
 *  count guard and the id-order guard below assert against, so a model
 *  addition can never leave one of them stale. */
const EXPECTED_MODEL_IDS = [
  "gemini-3-flash",
  "gemini-3.6-flash",
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
  "grok-4.6",
  "claude-sonnet-5",
  "claude-opus-4.8",
  "claude-opus-5",
  "claude-fable-5",
]

// ---------------------------------------------------------------------------
// LLM_MODELS data integrity
// ---------------------------------------------------------------------------
describe("LLM_MODELS data integrity", () => {
  it("model count matches the enumerated id list", () => {
    // Bound to the id list asserted below rather than a hand-typed number, so
    // the count and the title can never disagree after a model addition.
    expect(LLM_MODELS).toHaveLength(EXPECTED_MODEL_IDS.length)
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

  it("has 4 economy, 5 standard, 8 premium models", () => {
    const tierCounts: Record<LlmTier, number> = { economy: 0, standard: 0, premium: 0 }
    for (const model of LLM_MODELS) {
      tierCounts[model.tier]++
    }
    expect(tierCounts.economy).toBe(4)
    expect(tierCounts.standard).toBe(5)
    expect(tierCounts.premium).toBe(8)
  })

  it("all three kieFormats are represented", () => {
    const formats = new Set(LLM_MODELS.map((m) => m.kieFormat))
    expect(formats).toContain("chat-completions")
    expect(formats).toContain("messages")
    expect(formats).toContain("responses")
  })

  it("all four vendors are represented", () => {
    const vendors = new Set(LLM_MODELS.map((m) => m.vendor))
    expect(vendors).toContain("anthropic")
    expect(vendors).toContain("google")
    expect(vendors).toContain("openai")
    expect(vendors).toContain("xai")
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
    expect(LLM_MODEL_IDS).toEqual(EXPECTED_MODEL_IDS)
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
    "pick-best-llm",
  ]

  it("has entries for all 16 features", () => {
    expect(Object.keys(LLM_FEATURE_DEFAULTS)).toHaveLength(16)
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

  it('"prompt-helper" defaults to "gemini-3.6-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["prompt-helper"]).toBe("gemini-3.6-flash")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["prompt-helper"])).toBe("economy")
  })

  it('"ai-writer" defaults to "claude-sonnet-4.6" (standard)', () => {
    expect(LLM_FEATURE_DEFAULTS["ai-writer"]).toBe("claude-sonnet-4.6")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["ai-writer"])).toBe("standard")
  })

  it('"describe-to-picker" defaults to "claude-opus-5" (premium vision)', () => {
    expect(LLM_FEATURE_DEFAULTS["describe-to-picker"]).toBe("claude-opus-5")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["describe-to-picker"])).toBe("premium")
    // The default MUST be an accepted analyzer model (vision + structured output).
    expect(STRUCTURED_VISION_MODELS.map((m) => m.id)).toContain("claude-opus-5")
  })

  it('"generate-script" defaults to "gemini-3.6-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["generate-script"]).toBe("gemini-3.6-flash")
  })

  it('"qa-check" defaults to "gemini-3.6-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["qa-check"]).toBe("gemini-3.6-flash")
    expect(getLlmTier(LLM_FEATURE_DEFAULTS["qa-check"])).toBe("economy")
  })

  it('"translate" defaults to "gemini-3.6-flash" (economy)', () => {
    expect(LLM_FEATURE_DEFAULTS["translate"]).toBe("gemini-3.6-flash")
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
        "gemini-3.6-flash",
        "gemini-3.1-pro",
        "claude-sonnet-5",
        "claude-opus-4.8",
        "claude-opus-5",
        "claude-fable-5",
        // responses-format GPTs — KIE text.format json_schema live-verified
        // 2026-07-14 (text AND vision inputs).
        "gpt-5.4",
        "gpt-5.5",
        "gpt-5.6-luna",
        "gpt-5.6-terra",
        "gpt-5.6-sol",
        // responses-format Grok — vision + text.format live-verified 2026-08-18.
        "grok-4.6",
      ].sort(),
    )
  })

  it("includes Anthropic (forced-tool), Gemini (response_format), and OpenAI/xAI (responses text.format) vendors", () => {
    const vendors = new Set(STRUCTURED_VISION_MODELS.map((m) => m.vendor))
    expect(vendors).toContain("anthropic")
    expect(vendors).toContain("google")
    expect(vendors).toContain("openai")
    expect(vendors).toContain("xai")
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
// Reasoning effort registry (GPT-5.6 / Claude Sonnet 5 / Claude Opus 4.8 /
// Grok 4.6 — grok-4.5 was deferred on 2026-07-13 because its chat endpoint
// wasn't live; grok-4.6 is its activation, live-verified 2026-08-18.)
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
    expect(getLlmTier("grok-4.6")).toBe("standard")
    expect(getLlmTier("claude-sonnet-5")).toBe("standard")
    expect(getLlmTier("claude-opus-4.8")).toBe("premium")
    expect(getLlmTier("gpt-5.5")).toBe("premium")
    expect(getLlmTier("gemini-3.6-flash")).toBe("economy")
    expect(getLlmTier("claude-fable-5")).toBe("premium")
    expect(getLlmTier("claude-opus-5")).toBe("premium")
  })

  it("claude-opus-5 carries the full ladder, its own direct fallback, and thinkingDefaultOn", () => {
    const m = getLlmModel("claude-opus-5")
    expect(m?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(m?.directFallbackModel).toBe("claude-opus-5")
    // Load-bearing: consumers floor max_tokens off this flag, because Opus 5
    // reasons even with NO thinking param sent. Dropping it silently
    // reintroduces truncated answers at Effort=Auto on a premium model.
    expect(m?.thinkingDefaultOn).toBe(true)
  })

  it("thinkingDefaultOn is set only where the vendor default actually reasons", () => {
    // Opus 4.8 / 4.7 and Sonnet 5 do NOT reason when `thinking` is omitted —
    // flagging them would inflate every call's cap for no reason.
    for (const id of ["claude-opus-4.8", "claude-opus-4.7", "claude-sonnet-5", "claude-sonnet-4.6"]) {
      expect(getLlmModel(id)?.thinkingDefaultOn, id).toBeUndefined()
    }
  })

  it("gemini-3.6-flash exposes the KIE low/high thinking levels; claude-fable-5 the full Claude ladder", () => {
    expect(getLlmModel("gemini-3.6-flash")?.reasoningEfforts).toEqual(["low", "high"])
    expect(getLlmModel("claude-fable-5")?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh", "max"])
    expect(getLlmModel("claude-fable-5")?.directFallbackModel).toBe("claude-fable-5")
  })

  it("grok-4.6: responses format on the grok family path, KIE's documented effort enum, no sampling params, reasons by default", () => {
    const m = getLlmModel("grok-4.6")
    expect(m?.vendor).toBe("xai")
    expect(m?.kieFormat).toBe("responses")
    expect(m?.kieSlugOrModel).toBe("grok-4-6")
    expect(m?.structuredOutputMode).toBe("responses-json-schema")
    // KIE's enum is low..xhigh with NO `none` — the endpoint reasons
    // unconditionally (thinkingDefaultOn), so `none` would be a lie.
    expect(m?.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"])
    // Live-probed 2026-08-18: temperature is silently ignored — never send it.
    expect(m?.supportsTemperature).toBe(false)
    // Load-bearing: consumers floor max_tokens off this flag (a trivial probe
    // spent 169/170 output tokens on reasoning with no reasoning param sent).
    expect(m?.thinkingDefaultOn).toBe(true)
    // KIE-only: no direct lane on either vendor SDK.
    expect(m?.directFallbackModel).toBeUndefined()
    expect(m?.directGeminiModel).toBeUndefined()
  })

  it("grok-4.6 resolves from its dash-form wire slug", () => {
    expect(getLlmModel("grok-4-6")?.id).toBe("grok-4.6")
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
    expect(buildLlmCreditIdentifier("llm-chat", "grok-4.6", "xhigh")).toBe("llm-chat:premium")
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
    // gemini-3.6-flash tops out at "high" — max clamps to high, never bumps.
    expect(effectiveReasoningEffort("gemini-3.6-flash", "max")).toBe("high")
    expect(buildLlmCreditIdentifier("llm-chat", "gemini-3.6-flash", "max")).toBe("llm-chat:economy")
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

describe("direct-vendor lane declarations", () => {
  it("no model declares BOTH preferKie and preferDirect", () => {
    // They are the two halves of one idea (which lane goes first). Declaring
    // both is meaningless and would make routing depend on branch order in
    // llm-client rather than on the registry.
    const conflicted = LLM_MODELS.filter((m) => m.preferKie && m.preferDirect).map((m) => m.id)
    expect(conflicted).toEqual([])
  })

  it("preferDirect is only meaningful alongside a directGeminiModel", () => {
    const orphaned = LLM_MODELS.filter((m) => m.preferDirect && !m.directGeminiModel).map((m) => m.id)
    expect(orphaned).toEqual([])
  })

  it("every direct-lane model id is a non-empty, non-placeholder string", () => {
    for (const m of LLM_MODELS.filter((x) => x.directGeminiModel)) {
      expect(m.directGeminiModel!.length, m.id).toBeGreaterThan(0)
      expect(m.directGeminiModel, m.id).not.toContain(" ")
    }
  })

  it("only google-vendor models carry a Gemini direct lane", () => {
    const misvendored = LLM_MODELS.filter((m) => m.directGeminiModel && m.vendor !== "google").map((m) => m.id)
    expect(misvendored).toEqual([])
  })

  it("getLlmModel resolves a model by its direct Google id", () => {
    // The `-preview`-suffixed Google ids differ from our canonical ids, and
    // cost/usage reconciliation looks models up by whatever id the wire used.
    expect(getLlmModel("gemini-3.1-pro-preview")?.id).toBe("gemini-3.1-pro")
    expect(getLlmModel("gemini-3-flash-preview")?.id).toBe("gemini-3-flash")
  })
})

describe("advanced mode", () => {
  it("is available exactly on models with a direct Gemini lane", () => {
    for (const m of LLM_MODELS) {
      expect(supportsAdvancedMode(m.id), m.id).toBe(Boolean(m.directGeminiModel))
    }
  })

  it("is unavailable for an unknown or missing model id", () => {
    expect(supportsAdvancedMode(undefined)).toBe(false)
    expect(supportsAdvancedMode("not-a-real-model")).toBe(false)
  })

  it("bumps the credit tier one step", () => {
    // gemini-3-flash is economy → standard (standard renders as the bare feature)
    expect(buildLlmCreditIdentifier("llm-chat", "gemini-3-flash")).toBe("llm-chat:economy")
    expect(buildLlmCreditIdentifier("llm-chat", "gemini-3-flash", undefined, true)).toBe("llm-chat")
  })

  it("is independent of the effort bump — advanced adds exactly one step", () => {
    // No Gemini model declares xhigh/max today (their KIE-safe ceiling is
    // `high`, which never bumps), so the two bumps cannot currently stack in
    // practice — `max` clamps to `high` first. What must hold regardless is
    // that advanced adds exactly one step on top of whatever the
    // effort-clamped tier already is.
    for (const effort of [undefined, "low", "high", "max"]) {
      const plain = buildLlmCreditIdentifier("llm-chat", "gemini-3.6-flash", effort)
      const advanced = buildLlmCreditIdentifier("llm-chat", "gemini-3.6-flash", effort, true)
      expect(plain, `effort=${effort}`).toBe("llm-chat:economy")
      expect(advanced, `effort=${effort}`).toBe("llm-chat")
    }
  })

  it("no advanced-capable model declares xhigh/max — the UI copy depends on it", () => {
    // `EFFORT_LABELS` in reasoning-effort-select.tsx labels xhigh/max "may bill
    // one tier up" and its comment explains that the effort bump and the
    // advanced bump can never both apply, because Advanced is Gemini-only and
    // no Gemini model reaches xhigh/max. That was a note asking a future reader
    // to remember; this is the check that fails instead.
    //
    // If this ever goes red, the two bumps CAN stack: reword the labels to say
    // so and revisit whether a double bump is the price we want.
    for (const m of LLM_MODELS) {
      if (!supportsAdvancedMode(m.id)) continue
      const levels = [...(m.reasoningEfforts ?? []), ...(m.directReasoningEfforts ?? [])]
      expect(levels, `${m.id} can run advanced AND declares a tier-bumping effort`)
        .not.toEqual(expect.arrayContaining(["xhigh"]))
      expect(levels, `${m.id} can run advanced AND declares a tier-bumping effort`)
        .not.toEqual(expect.arrayContaining(["max"]))
    }
  })

  it("never bumps past premium", () => {
    expect(buildLlmCreditIdentifier("llm-chat", "gemini-3.1-pro", "max", true)).toBe("llm-chat:premium")
  })

  it("ignores the flag on a model that cannot run advanced (no silent overcharge)", () => {
    // gpt-5.2 has no direct lane — a stale advancedMode flag must not inflate it.
    expect(buildLlmCreditIdentifier("llm-chat", "gpt-5.2", undefined, true))
      .toBe(buildLlmCreditIdentifier("llm-chat", "gpt-5.2"))
    expect(buildLlmCreditIdentifier("llm-chat", "claude-opus-4.7", undefined, true))
      .toBe(buildLlmCreditIdentifier("llm-chat", "claude-opus-4.7"))
  })

  it("back-compat: omitting the 4th arg is identical to before for every model", () => {
    for (const m of LLM_MODELS) {
      expect(buildLlmCreditIdentifier("x", m.id, "high", false)).toBe(buildLlmCreditIdentifier("x", m.id, "high"))
    }
  })

  it("resolveLlmCreditId reads advancedMode from the raw body", () => {
    expect(resolveLlmCreditId("llm-chat", { llmModel: "gemini-3-flash", advancedMode: true })).toBe("llm-chat")
    expect(resolveLlmCreditId("llm-chat", { llmModel: "gemini-3-flash" })).toBe("llm-chat:economy")
    // Only a real boolean true counts — a truthy string must not bump.
    expect(resolveLlmCreditId("llm-chat", { llmModel: "gemini-3-flash", advancedMode: "yes" })).toBe("llm-chat:economy")
  })
})

describe("lane-aware reasoning efforts", () => {
  it("widens the ladder on the direct lane where the vendor accepts more", () => {
    expect(availableReasoningEfforts("gemini-3.6-flash")).toEqual(["low", "high"])
    expect(availableReasoningEfforts("gemini-3.6-flash", true)).toEqual(["none", "low", "medium", "high"])
  })

  it("exposes an effort lever on models that have none via KIE", () => {
    // gemini-3-flash declares no reasoningEfforts at all — Advanced is the
    // only way its effort picker appears.
    expect(availableReasoningEfforts("gemini-3-flash")).toEqual([])
    expect(availableReasoningEfforts("gemini-3-flash", true)).toEqual(["none", "low", "medium", "high"])
  })

  it("respects a shorter direct ladder (3.1 Pro has no minimal tier)", () => {
    expect(availableReasoningEfforts("gemini-3.1-pro", true)).toEqual(["low", "medium", "high"])
  })

  it("ignores the advanced flag on a model with no direct lane", () => {
    const claude = availableReasoningEfforts("claude-sonnet-4.6")
    expect(availableReasoningEfforts("claude-sonnet-4.6", true)).toEqual(claude)
  })

  it("clamps against the lane's ladder, not the other lane's", () => {
    // `medium` is not on 3.6-flash's KIE ladder → clamps down to `low`.
    expect(effectiveReasoningEffort("gemini-3.6-flash", "medium")).toBe("low")
    // On the direct lane `medium` is a real level → survives.
    expect(effectiveReasoningEffort("gemini-3.6-flash", "medium", true)).toBe("medium")
  })

  it("every directReasoningEfforts entry is a valid effort, ascending", () => {
    for (const m of LLM_MODELS.filter((x) => x.directReasoningEfforts)) {
      const levels = m.directReasoningEfforts!
      for (const l of levels) expect(LLM_REASONING_EFFORTS, m.id).toContain(l)
      const ranks = levels.map((l) => LLM_REASONING_EFFORTS.indexOf(l))
      expect(ranks, `${m.id} must be ascending`).toEqual([...ranks].sort((a, b) => a - b))
    }
  })

  it("only advanced-capable models declare a direct ladder", () => {
    const bad = LLM_MODELS.filter((m) => m.directReasoningEfforts && !supportsAdvancedMode(m.id)).map((m) => m.id)
    expect(bad).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Vendor grouping — the ONE ordering every LLM model menu renders
// ---------------------------------------------------------------------------
describe("groupLlmModelsByVendor / orderedLlmModels", () => {
  it("every vendor in the union has an order slot AND a label (totality)", () => {
    // A new vendor added to LlmVendor without a menu decision would silently
    // sort its models to the end of every picker unlabeled — fail here instead.
    const vendorsInUse = new Set(LLM_MODELS.map((m) => m.vendor))
    for (const v of vendorsInUse) {
      expect(LLM_VENDOR_ORDER, `vendor "${v}" missing from LLM_VENDOR_ORDER`).toContain(v)
      expect(LLM_VENDOR_LABELS[v], `vendor "${v}" missing from LLM_VENDOR_LABELS`).toBeTruthy()
    }
    for (const v of LLM_VENDOR_ORDER) {
      expect(LLM_VENDOR_LABELS[v]).toBeTruthy()
    }
  })

  it("covers every model exactly once, in vendor order", () => {
    const groups = groupLlmModelsByVendor()
    const flattened = groups.flatMap((g) => g.models.map((m) => m.id))
    expect(flattened.sort()).toEqual(LLM_MODELS.map((m) => m.id).sort())
    expect(new Set(flattened).size).toBe(flattened.length)
    const groupVendors = groups.map((g) => g.vendor)
    expect(groupVendors).toEqual(LLM_VENDOR_ORDER.filter((v) => groupVendors.includes(v)))
  })

  it("inside each group models are tier-ordered economy → standard → premium", () => {
    const rank = { economy: 0, standard: 1, premium: 2 } as const
    for (const g of groupLlmModelsByVendor()) {
      const ranks = g.models.map((m) => rank[m.tier])
      expect(ranks, g.vendor).toEqual([...ranks].sort((a, b) => a - b))
    }
  })

  it("groups carry their display label and omit empty groups after a filter", () => {
    const groups = groupLlmModelsByVendor(LLM_MODELS.filter((m) => m.vendor === "xai"))
    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe("xAI")
    expect(groups[0].models.map((m) => m.id)).toEqual(["grok-4.6"])
  })

  it("does not mutate the registry (registry order is load-bearing for LLM_MODEL_IDS)", () => {
    const before = LLM_MODELS.map((m) => m.id)
    groupLlmModelsByVendor()
    orderedLlmModels()
    expect(LLM_MODELS.map((m) => m.id)).toEqual(before)
  })

  it("orderedLlmModels is the flattened grouping", () => {
    expect(orderedLlmModels().map((m) => m.id)).toEqual(
      groupLlmModelsByVendor().flatMap((g) => g.models.map((m) => m.id)),
    )
  })
})
