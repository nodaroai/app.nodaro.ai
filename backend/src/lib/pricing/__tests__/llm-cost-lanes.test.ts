/**
 * Lane-aware LLM pricing.
 *
 * The same model id bills very differently depending on who served the call —
 * Google's list price for Gemini runs 3.3–4× what KIE resells it for. These
 * tests pin that separation, and the invariant that a model which CAN route
 * direct always has a direct rate row to be costed against.
 */
import { describe, it, expect } from "vitest"
import { LLM_MODELS } from "@nodaro/shared"
import { calculateLlmCost, directRatedModelIds } from "../llm-cost.js"

describe("serving lane selects the rate band", () => {
  it("defaults to the KIE band so every pre-existing call site is unchanged", () => {
    const withoutLane = calculateLlmCost("gemini-3.6-flash", { inputTokens: 1000, outputTokens: 500 })
    const explicitKie = calculateLlmCost("gemini-3.6-flash", { inputTokens: 1000, outputTokens: 500 }, "kie")
    // (1000 * 0.45 + 500 * 2.25) / 1e6
    expect(withoutLane).toBeCloseTo(0.001575, 10)
    expect(explicitKie).toBe(withoutLane)
  })

  it("costs the direct lane at Google list price, not KIE's resale", () => {
    // (1000 * 1.50 + 500 * 7.50) / 1e6 = 0.00525
    const direct = calculateLlmCost("gemini-3.6-flash", { inputTokens: 1000, outputTokens: 500 }, "direct")
    expect(direct).toBeCloseTo(0.00525, 10)
  })

  it("costs gemini-3.8-flash at Google's INTRO list price on the direct lane", () => {
    // Direct row is the launch INTRO rate ($0.75/$3.75) running through
    // 2026-12-31; standard $1.50/$7.50 lands 2027-01-01 and this expectation
    // is what will fail if the row is bumped without updating the KIE-vs-direct
    // story. (1000 * 0.75 + 500 * 3.75) / 1e6 = 0.002625
    const direct = calculateLlmCost("gemini-3.8-flash", { inputTokens: 1000, outputTokens: 500 }, "direct")
    expect(direct).toBeCloseTo(0.002625, 10)
    // ...and the KIE resale band is exactly 30% of that intro rate (15% of the
    // standard rate that lands 2027-01-01), which is why this model is
    // registered KIE-first with no `preferDirect`.
    expect(calculateLlmCost("gemini-3.8-flash", { inputTokens: 1000, outputTokens: 500 })).toBeCloseTo(0.0007875, 10)
  })

  it("never prices the direct lane BELOW the aggregator", () => {
    // A direct row cheaper than its KIE row would mean the two bands got
    // swapped — a vendor's own list price is never the discounted one.
    // Equality is legitimate: KIE resells claude-sonnet-4.6 at exactly
    // Anthropic list, with no markdown.
    for (const id of directRatedModelIds()) {
      const usage = { inputTokens: 10_000, outputTokens: 2_000 }
      expect(
        calculateLlmCost(id, usage, "direct"),
        `${id} direct must not undercut KIE`,
      ).toBeGreaterThanOrEqual(calculateLlmCost(id, usage, "kie"))
    }
  })

  it("prices every Gemini model strictly above KIE on the direct lane", () => {
    // The Gemini gap is the entire reason lane routing is a per-model
    // decision. If a copy-paste ever made these equal, the cost case for
    // KIE-first routing would vanish and nothing else would catch it.
    // gemini-3.7-flash is deliberately NOT here: KIE never published a list
    // price for it, so its KIE row is pinned to Google's own intro rate and the
    // two bands are equal BY CONSTRUCTION. gemini-3.8-flash does have a
    // published KIE price (45/225 credits per M), so the gap is real again.
    for (const id of ["gemini-3-flash", "gemini-3.6-flash", "gemini-3.8-flash", "gemini-3.1-pro"]) {
      const usage = { inputTokens: 10_000, outputTokens: 2_000 }
      expect(
        calculateLlmCost(id, usage, "direct"),
        `${id} direct must exceed KIE`,
      ).toBeGreaterThan(calculateLlmCost(id, usage, "kie"))
    }
  })
})

describe("long-context price bands", () => {
  it("uses the base band at or below the threshold", () => {
    // 200_000 input is exactly AT the threshold — still the base band.
    const cost = calculateLlmCost("gemini-3.1-pro", { inputTokens: 200_000, outputTokens: 1_000 }, "direct")
    // (200000 * 2.00 + 1000 * 12.00) / 1e6 = 0.412
    expect(cost).toBeCloseTo(0.412, 10)
  })

  it("steps up to the long-context band once the prompt clears the threshold", () => {
    const cost = calculateLlmCost("gemini-3.1-pro", { inputTokens: 200_001, outputTokens: 1_000 }, "direct")
    // (200001 * 4.00 + 1000 * 18.00) / 1e6 = 0.818004
    expect(cost).toBeCloseTo(0.818004, 10)
  })

  it("never applies a long-context band on the KIE lane (KIE bills one flat rate)", () => {
    const small = calculateLlmCost("gemini-3.1-pro", { inputTokens: 1_000, outputTokens: 0 }, "kie")
    const huge = calculateLlmCost("gemini-3.1-pro", { inputTokens: 1_000_000, outputTokens: 0 }, "kie")
    expect(huge / small).toBeCloseTo(1000, 6)
  })
})

describe("rate-table / registry invariants", () => {
  it("every model declaring directGeminiModel has a direct rate row", () => {
    const directCapable = LLM_MODELS.filter((m) => m.directGeminiModel).map((m) => m.id)
    const rated = new Set(directRatedModelIds())
    // Without this, a newly direct-enabled model would silently fall back to
    // the KIE rate and under-report provider_cost by ~3-4x on every call.
    expect(directCapable.filter((id) => !rated.has(id))).toEqual([])
  })

  it("falls back to the KIE rate rather than $0 when a direct row is missing", () => {
    // gpt-5.2 has no direct row and no direct lane; asking for one must not
    // zero out a real spend.
    const usage = { inputTokens: 1_000, outputTokens: 500 }
    expect(calculateLlmCost("gpt-5.2", usage, "direct")).toBe(calculateLlmCost("gpt-5.2", usage, "kie"))
  })

  it("still returns 0 for a model that is in no table at all", () => {
    expect(calculateLlmCost("not-a-real-model", { inputTokens: 1_000, outputTokens: 1 }, "direct")).toBe(0)
  })
})

describe("video-analysis tiers can be served direct-only", () => {
  it("every VIDEO_ANALYSIS_TIERS model declares a direct Google lane", async () => {
    const { VIDEO_ANALYSIS_TIERS, getLlmModel } = await import("@nodaro/shared")
    // The plugin toolkit pins video-analysis to `requireLane: "direct"` with NO
    // fallback, so a tier pointed at a model without a direct lane is not a
    // degraded run — it is a hard outage on every analysis job.
    for (const [tier, modelId] of Object.entries(VIDEO_ANALYSIS_TIERS)) {
      const model = getLlmModel(modelId)
      expect(model, `${tier} → ${modelId} must resolve`).toBeDefined()
      expect(model!.directGeminiModel, `${tier} → ${modelId} needs a direct lane`).toBeTruthy()
    }
  })

  it("every VIDEO_ANALYSIS_TIERS model has a direct rate row", async () => {
    const { VIDEO_ANALYSIS_TIERS } = await import("@nodaro/shared")
    const rated = new Set(directRatedModelIds())
    for (const modelId of Object.values(VIDEO_ANALYSIS_TIERS)) {
      expect(rated.has(modelId), `${modelId} must be costed on the direct band`).toBe(true)
    }
  })
})

describe("direct-Anthropic lane costing", () => {
  it("costs Claude models above the KIE band on the direct lane", () => {
    // Every Claude model with a direct-SDK fallback must have a direct row —
    // otherwise a fallback call silently bills at KIE's resale rate.
    for (const m of LLM_MODELS.filter((x) => x.directFallbackModel)) {
      const usage = { inputTokens: 10_000, outputTokens: 2_000 }
      const kie = calculateLlmCost(m.id, usage, "kie")
      const direct = calculateLlmCost(m.id, usage, "direct")
      expect(direct, `${m.id} needs a direct rate row`).toBeGreaterThanOrEqual(kie)
    }
  })

  it("every model with a direct-SDK fallback has a direct rate row", () => {
    const rated = new Set(directRatedModelIds())
    const missing = LLM_MODELS.filter((m) => m.directFallbackModel && !rated.has(m.id)).map((m) => m.id)
    expect(missing).toEqual([])
  })

  it("prices claude-opus-5 at Anthropic list on the direct lane", () => {
    // (10000 * 5.00 + 2000 * 25.00) / 1e6 = 0.10
    expect(calculateLlmCost("claude-opus-5", { inputTokens: 10_000, outputTokens: 2_000 }, "direct"))
      .toBeCloseTo(0.10, 10)
  })
})
