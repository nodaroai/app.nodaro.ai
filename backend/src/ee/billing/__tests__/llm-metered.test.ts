import { describe, it, expect } from "vitest"
import { LLM_FEATURE_DEFAULTS, LLM_MODELS, getLlmModel, type LlmModelDef, type LlmReasoningEffort } from "@nodaro/shared/llm-models"
import { llmPossibleLanes, llmPrimaryLane } from "../../../lib/pricing/llm-cost.js"
import { claudeMustServeDirect } from "../../../lib/llm/router.js"
import type { LlmContentBlock, LlmRequest } from "../../../lib/llm/types.js"
import {
  LLM_CEILING_CHARS_PER_TOKEN,
  LLM_IMAGE_TOKENS,
  LLM_MEDIA_TOKENS_PER_SECOND,
  LLM_UNKNOWN_MEDIA_SECONDS,
  LlmUnpricedModelError,
  llmChargeId,
  llmEstimateBaseCredits,
  llmHoldBaseCredits,
  llmInputTokenBound,
  llmRequestInputBound,
} from "../llm-metered.js"
import { LLM_TYPICAL_USAGE, METERED_LLM_FEATURES, type MeteredLlmFeature } from "../llm-typical-usage.js"
import { isTierBilledLlmFeature } from "@nodaro/render-rules"

/** A request whose text (system + schema + text blocks) is exactly `chars` ASCII characters. */
function req(opts: {
  modelId?: string
  chars: number
  maxTokens?: number
  reasoningEffort?: LlmReasoningEffort
  requireLane?: "kie" | "direct"
  images?: number
  jsonSchema?: boolean
}): LlmRequest {
  const jsonSchema = opts.jsonSchema ? { name: "out", schema: { type: "object" } } : undefined
  const schemaChars = jsonSchema ? JSON.stringify(jsonSchema.schema).length : 0
  const blocks: LlmContentBlock[] = [{ type: "text", text: "a".repeat(opts.chars - schemaChars) }]
  for (let i = 0; i < (opts.images ?? 0); i++) blocks.push({ type: "image", url: `https://example.com/${i}.png` })
  return {
    modelId: opts.modelId ?? "",
    system: "",
    messages: [{ role: "user", content: blocks }],
    maxTokens: opts.maxTokens,
    reasoningEffort: opts.reasoningEffort,
    requireLane: opts.requireLane,
    jsonSchema,
  }
}

describe("input bound", () => {
  it("pins the constants", () => {
    expect(LLM_CEILING_CHARS_PER_TOKEN).toBe(3)
    expect(LLM_IMAGE_TOKENS).toBe(1600)
    expect(LLM_MEDIA_TOKENS_PER_SECOND).toBe(300)
    expect(LLM_UNKNOWN_MEDIA_SECONDS).toBe(60)
  })

  it("input bound counts non-ASCII 1:1", () => {
    // ceil(300 / 3) = 100 ASCII + 3000 Hebrew at 1 token each (the v1 rule, all at 3 chars/token, gave 1100)
    expect(llmInputTokenBound({ text: "a".repeat(300) + "ש".repeat(3000), imageCount: 0, mediaSeconds: 0 })).toBe(3100)
  })

  it("input bound: 2 images + a 600 s video", () => {
    // 2 × 1600 + 600 × 300 = 3200 + 180000
    expect(llmInputTokenBound({ text: "", imageCount: 2, mediaSeconds: 600 })).toBe(183200)
  })

  it("rounds media seconds up to whole tokens", () => {
    expect(llmInputTokenBound({ text: "", imageCount: 0, mediaSeconds: 0.001 })).toBe(1)
  })

  it("refuses a negative or non-finite size", () => {
    expect(() => llmInputTokenBound({ text: "", imageCount: -1, mediaSeconds: 0 })).toThrow(RangeError)
    expect(() => llmInputTokenBound({ text: "", imageCount: 1.5, mediaSeconds: 0 })).toThrow(RangeError)
    expect(() => llmInputTokenBound({ text: "", imageCount: 0, mediaSeconds: Number.NaN })).toThrow(RangeError)
  })

  it("request bound: a video block with no length counts 60 s", () => {
    const r: LlmRequest = { modelId: "", system: "", messages: [{ role: "user", content: [{ type: "video", url: "https://example.com/v.mp4" }] }] }
    expect(llmRequestInputBound(r)).toBe(18000)
  })

  it("request bound: every media block (video, inline video, audio) adds the given length", () => {
    const r: LlmRequest = {
      modelId: "",
      system: "",
      messages: [{
        role: "user",
        content: [
          { type: "video", url: "https://example.com/v.mp4" },
          { type: "video_base64", mediaType: "video/mp4", data: "AAAA" },
          { type: "audio", url: "https://example.com/a.mp3" },
        ],
      }],
    }
    expect(llmRequestInputBound(r, { mediaSeconds: 10 })).toBe(3 * 10 * 300)
  })

  it("request bound: text from system + schema + string and text-block messages; images counted once each", () => {
    const r: LlmRequest = {
      modelId: "",
      system: "abc",
      jsonSchema: { name: "x", schema: { a: 1 } }, // '{"a":1}' = 7 chars
      messages: [
        { role: "user", content: "de" },
        { role: "user", content: [{ type: "text", text: "f" }, { type: "image", url: "u" }, { type: "image_base64", mediaType: "image/png", data: "AAAA" }] },
      ],
    }
    // 3 + 7 + 2 + 1 = 13 ASCII → ceil(13 / 3) = 5; 2 images → 3200 (never also counted as 6,400 chars)
    expect(llmRequestInputBound(r)).toBe(5 + 3200)
  })
})

// Figures computed at CREDIT_BASE_USD = 0.002 (usdToCredits rounds milli-credits, then up).
describe("llmHoldBaseCredits (D1: primary lane, one attempt, real output cap)", () => {
  it("hold H1: Fable, 8000 ASCII chars, asked 2000, KIE primary = 334", () => {
    // in 2667, out 32768: 2667×4e-6 + 32768×20e-6 = 0.010668 + 0.65536 = 0.666028 → 333.014 → 334
    expect(llmHoldBaseCredits("claude-fable-5", { request: req({ chars: 8000, maxTokens: 2000 }) })).toBe(334)
  })

  it("hold H2: same at effort high is served direct = 833", () => {
    // 2667×10e-6 + 32768×50e-6 = 0.02667 + 1.6384 = 1.66507 → 832.535 → 833
    expect(llmHoldBaseCredits("claude-fable-5", { request: req({ chars: 8000, maxTokens: 2000, reasoningEffort: "high" }) })).toBe(833)
  })

  it("hold H3: Studio Director default (Fable, llm-structured, 30000 chars, asked 16384, KIE) = 348", () => {
    // structured Claude stays on KIE (KIE_CLAUDE_TOOLS_VERIFIED): in 10000, out 32768: 0.04 + 0.65536 = 0.69536 → 347.68 → 348
    const request = req({ chars: 30000, maxTokens: 16384, jsonSchema: true })
    expect(llmRequestInputBound(request)).toBe(10000)
    expect(llmHoldBaseCredits("claude-fable-5", { request })).toBe(348)
  })

  it("hold H4: Gemini 3.8 Flash, 3000 chars, asked 8192 = 10", () => {
    // in 1000, out 16384: 0.000225 + 0.018432 = 0.018657 → 9.3285 → 10
    expect(llmHoldBaseCredits("gemini-3.8-flash", { request: req({ chars: 3000, maxTokens: 8192 }) })).toBe(10)
  })

  it("hold H5: Opus 5.5, 600 chars + 2 images, asked 1000 = 134", () => {
    // in 200 + 3200 = 3400, out 32768: 0.00544 + 0.262144 = 0.267584 → 133.792 → 134
    expect(llmHoldBaseCredits("claude-opus-5.5", { request: req({ chars: 600, maxTokens: 1000, images: 2 }) })).toBe(134)
  })

  it("a direct pin (Advanced mode) is held at the direct rate", () => {
    // Fable pinned direct, no effort: in 2667, out 32768 at 10/50 → 833 (as H2)
    expect(llmHoldBaseCredits("claude-fable-5", { request: req({ chars: 8000, maxTokens: 2000, requireLane: "direct" }) })).toBe(833)
  })

  it("media of unknown length is held at 60 s per block; a known length replaces it", () => {
    const video: LlmRequest = { modelId: "", system: "", maxTokens: 1000, messages: [{ role: "user", content: [{ type: "video", url: "https://example.com/v.mp4" }] }] }
    // gemini-3.8-flash KIE, out raised to 16384 (0.018432 USD).
    // unknown: 18000 in → 0.00405 + 0.018432 = 0.022482 → 11.241 → 12
    expect(llmHoldBaseCredits("gemini-3.8-flash", { request: video })).toBe(12)
    // 600 s: 180000 in → 0.0405 + 0.018432 = 0.058932 → 29.466 → 30
    expect(llmHoldBaseCredits("gemini-3.8-flash", { request: video, mediaSeconds: 600 })).toBe(30)
  })

  it("cheapLanesOnly never moves the primary lane (it only removes fallbacks, which a D1 hold does not price)", () => {
    const high = req({ chars: 8000, maxTokens: 2000, reasoningEffort: "high" })
    expect(llmHoldBaseCredits("claude-fable-5", { request: high, cheapLanesOnly: true })).toBe(833)
    // a directOnly model has no KIE row: a cheap-lanes run must still be priced, not refused
    expect(llmHoldBaseCredits("gemini-4-argon", { request: req({ chars: 3000, maxTokens: 1000 }), cheapLanesOnly: true }))
      .toBe(llmHoldBaseCredits("gemini-4-argon", { request: req({ chars: 3000, maxTokens: 1000 }) }))
  })

  it("a primary lane with no rate of its own is refused — the direct→KIE row fallback never prices a hold", () => {
    // gpt-5.2 carries only a KIE row; pinned direct it must not be held at its KIE rate.
    try {
      llmHoldBaseCredits("gpt-5.2", { request: req({ chars: 10, maxTokens: 10, requireLane: "direct" }) })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LlmUnpricedModelError)
      expect((err as LlmUnpricedModelError).lane).toBe("direct")
    }
  })

  it("an unpriced model throws LlmUnpricedModelError carrying the model id", () => {
    try {
      llmHoldBaseCredits("no-such-model", { request: req({ chars: 1, maxTokens: 1 }) })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(LlmUnpricedModelError)
      expect((err as LlmUnpricedModelError).modelId).toBe("no-such-model")
      expect((err as LlmUnpricedModelError).code).toBe("llm_model_unpriced")
    }
  })

  it("every registry model can be held (no model runs unpriced)", () => {
    for (const m of LLM_MODELS) {
      for (const reasoningEffort of [undefined, "high"] as const) {
        expect(llmHoldBaseCredits(m.id, { request: req({ chars: 100, reasoningEffort }) }), m.id).toBeGreaterThan(0)
      }
    }
  })
})

describe("llmEstimateBaseCredits", () => {
  it("estimate: llm-chat on Gemini 3.8 Flash is at least 1 credit", () => {
    expect(llmEstimateBaseCredits("llm-chat", "gemini-3.8-flash")).toBe(1)
  })

  it("estimate: llm-chat on Opus 5.5 (KIE, 1k/1k) = 5 base", () => {
    expect(llmEstimateBaseCredits("llm-chat", "claude-opus-5.5")).toBe(5)
  })

  it("prices the primary lane: an effort that serves Opus 5.5 direct prices it at the direct rate", () => {
    // direct 4/20 × 1k/1k = 0.024 USD → 12 base
    expect(llmEstimateBaseCredits("llm-chat", "claude-opus-5.5", "high")).toBe(12)
  })

  it("an unpriced model throws LlmUnpricedModelError", () => {
    expect(() => llmEstimateBaseCredits("llm-chat", "no-such-model")).toThrow(LlmUnpricedModelError)
  })

  it("Advanced mode pins direct (Opus 5.5: 12) but does not apply to a model with no direct lane", () => {
    expect(llmEstimateBaseCredits("llm-chat", "claude-opus-5.5", undefined, true)).toBe(12)
    // gpt-5.2 has only a KIE rate: Advanced mode is unavailable on it, so it is
    // priced on its primary lane (as the route serves it), never refused.
    expect(llmEstimateBaseCredits("llm-chat", "gpt-5.2", undefined, true)).toBe(llmEstimateBaseCredits("llm-chat", "gpt-5.2"))
  })

  it("refuses a feature with no typical usage instead of pricing NaN", () => {
    expect(() => llmEstimateBaseCredits("no-such-feature" as MeteredLlmFeature, "claude-opus-5.5")).toThrow(/typical usage/)
  })
})

describe("LLM_TYPICAL_USAGE / METERED_LLM_FEATURES", () => {
  it("every metered feature has a typical usage", () => {
    for (const f of METERED_LLM_FEATURES) expect(LLM_TYPICAL_USAGE[f]).toBeDefined()
  })

  it("covers every LlmFeature (pick-best-llm under its reduce: credit id) but the tier-billed ones, plus the non-LlmFeature callers", () => {
    const expected = [
      ...Object.keys(LLM_FEATURE_DEFAULTS).filter((f) => f !== "pick-best-llm" && !isTierBilledLlmFeature(f)),
      "llm-structured",
      "text-to-picker",
      "reduce:pick-best-llm",
    ].sort()
    expect([...METERED_LLM_FEATURES].sort()).toEqual(expected)
    expect(Object.keys(LLM_TYPICAL_USAGE).sort()).toEqual(expected)
  })

  it("carries the spec's measured sizes", () => {
    expect(LLM_TYPICAL_USAGE["describe-to-picker"]).toEqual({ inputTokens: 35000, outputTokens: 1500 })
    expect(LLM_TYPICAL_USAGE["text-to-picker"]).toEqual({ inputTokens: 99000, outputTokens: 4000 })
    expect(LLM_TYPICAL_USAGE["llm-structured"]).toEqual({ inputTokens: 10000, outputTokens: 12000 })
    expect(LLM_TYPICAL_USAGE["llm-chat"]).toEqual({ inputTokens: 1000, outputTokens: 1000 })
    expect(LLM_TYPICAL_USAGE["ai-writer"]).toEqual({ inputTokens: 2000, outputTokens: 2000 })
  })
})

describe("llmChargeId", () => {
  it("is <feature>:<modelId>", () => {
    expect(llmChargeId("llm-chat", "claude-opus-5.5")).toBe("llm-chat:claude-opus-5.5")
    expect(llmChargeId("reduce:pick-best-llm", "gemini-3.8-flash")).toBe("reduce:pick-best-llm:gemini-3.8-flash")
  })
})

/**
 * The oracle: the router's unpinned primary choice (`llmComplete` / `llmStream`
 * in lib/llm/router.ts), restated from the registry flags with every key set
 * (Anthropic, Gemini, KIE — the production posture; a missing key flips the
 * primary). A pin wins outright (`requireLane`, which is how Advanced mode
 * reaches the router). `cheapLanesOnly` is not read: it removes fallbacks only.
 */
function routerPrimaryLane(model: LlmModelDef, request: Pick<LlmRequest, "reasoningEffort" | "jsonSchema" | "requireLane">): "kie" | "direct" {
  if (request.requireLane) return request.requireLane
  const r = { system: "", messages: [], ...request } as unknown as LlmRequest
  if (model.directFallbackModel) return !model.preferKie || claudeMustServeDirect(model, r) ? "direct" : "kie"
  if (model.directOnly) return "direct"
  if (model.directGeminiModel) return model.preferDirect ? "direct" : "kie"
  return "kie"
}

const EFFORTS = [undefined, "low", "high", "xhigh"] as const
const SCHEMA = { name: "out", schema: { type: "object" } }

describe("llmPrimaryLane agrees with the router", () => {
  for (const model of LLM_MODELS) {
    it(model.id, () => {
      for (const reasoningEffort of EFFORTS) {
        for (const jsonSchema of [undefined, SCHEMA]) {
          const r = { reasoningEffort, jsonSchema }
          expect(llmPrimaryLane(model, r), `${reasoningEffort} ${jsonSchema ? "structured" : "plain"}`).toBe(routerPrimaryLane(model, r))
          expect(llmPrimaryLane(model, { ...r, cheapLanesOnly: true })).toBe(routerPrimaryLane(model, r))
        }
      }
    })
  }

  it("requireLane kie → kie; requireLane direct → direct, whatever the registry prefers", () => {
    for (const model of LLM_MODELS) {
      expect(llmPrimaryLane(model, { requireLane: "kie", reasoningEffort: "high" })).toBe("kie")
      expect(llmPrimaryLane(model, { requireLane: "direct" })).toBe("direct")
    }
  })

  it("reads preferKie and preferDirect (a Claude without preferKie, a Gemini with preferDirect serve direct first)", () => {
    const { preferKie: _preferKie, ...claude } = getLlmModel("claude-opus-5.5")!
    const gemini: LlmModelDef = { ...getLlmModel("gemini-3.8-flash")!, preferDirect: true }
    for (const model of [claude as LlmModelDef, gemini]) {
      expect(llmPrimaryLane(model, {})).toBe("direct")
      expect(llmPossibleLanes(model)).toEqual(["direct", "kie"])
    }
  })
})

describe("llmPossibleLanes[0] === llmPrimaryLane for every registry model with no pin", () => {
  for (const model of LLM_MODELS) {
    it(model.id, () => {
      for (const reasoningEffort of EFFORTS) {
        expect(llmPossibleLanes(model.id, reasoningEffort)[0], `${reasoningEffort}`).toBe(llmPrimaryLane(model, { reasoningEffort }))
      }
    })
  }
})
