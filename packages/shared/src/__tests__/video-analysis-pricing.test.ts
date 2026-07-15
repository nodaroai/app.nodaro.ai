import { describe, it, expect } from "vitest"
import {
  VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC,
  VIDEO_ANALYSIS_BUCKET_CREDITS,
  pickVideoAnalysisBucket, buildVideoAnalysisCreditId, bucketSecondsFromCreditId,
  videoAnalysisNumWindows,
} from "../video-analysis-pricing.js"
import {
  VIDEO_ANALYSIS_LLM_MODELS, VIDEO_ANALYSIS_TIERS, VIDEO_ANALYSIS_TIER_ORDER,
  DEFAULT_VIDEO_ANALYSIS_TIER, DEFAULT_VIDEO_ANALYSIS_MODEL, resolveVideoAnalysisModel,
} from "../llm-models.js"

// The measured-rate constants and the $-derived `videoAnalysisBucketCredits`
// formula are PRIVATE, in @nodaroai/cloud-plugins
// (src/plugins/video-analysis/cost.ts) — its tests (the worked-example
// bucket-credit values and the cross-check against VIDEO_ANALYSIS_BUCKET_CREDITS
// below) live in that private package's __tests__/cost.test.ts. This file
// covers only the NON-monetary duration-bucketing, window-batching, and
// credit-id-construction logic that stays in the published package.

describe("video-analysis-pricing", () => {
  it("buckets and ids", () => {
    expect(VIDEO_ANALYSIS_DURATION_BUCKETS).toEqual([60, 180, 360, 600])
    expect(pickVideoAnalysisBucket(59.6)).toBe(60)
    expect(pickVideoAnalysisBucket(60.4)).toBe(180)
    expect(buildVideoAnalysisCreditId("gemini-3-flash", 170)).toBe("video-analysis:gemini-3-flash:180s")
    expect(buildVideoAnalysisCreditId("gemini-3.1-pro")).toBe("video-analysis:gemini-3.1-pro:600s") // unknown → ceiling
    expect(bucketSecondsFromCreditId("video-analysis:gemini-3-flash:180s")).toBe(180)
  })

  it("numWindows matches the segmentation stop condition", () => {
    expect(videoAnalysisNumWindows(60)).toBe(1)
    expect(videoAnalysisNumWindows(180)).toBe(1)
    expect(videoAnalysisNumWindows(360)).toBe(3)
    expect(videoAnalysisNumWindows(600)).toBe(5)
  })

  it("tolerance constant is exported for the worker re-check", () => {
    expect(VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC).toBe(3)
  })

  it("model SSOT is capability-derived and Gemini-only today", () => {
    expect(VIDEO_ANALYSIS_LLM_MODELS).toEqual(["gemini-3-flash", "gemini-3.1-pro"])
  })

  it("tier layer: every tier maps to a real model AND every model is tier-reachable (no vendor leak)", () => {
    // Adding a video-analysis model without a tier would silently leave it
    // unreachable / unnamed — this fails until a tier decision is made.
    const tierTargets = Object.values(VIDEO_ANALYSIS_TIERS)
    for (const m of tierTargets) expect(VIDEO_ANALYSIS_LLM_MODELS).toContain(m)
    for (const m of VIDEO_ANALYSIS_LLM_MODELS) expect(tierTargets).toContain(m)
    expect(new Set(VIDEO_ANALYSIS_TIER_ORDER)).toEqual(new Set(Object.keys(VIDEO_ANALYSIS_TIERS)))
  })

  it("resolveVideoAnalysisModel: tier → model, raw model passthrough, default pro on empty/unknown", () => {
    expect(DEFAULT_VIDEO_ANALYSIS_TIER).toBe("pro")
    expect(DEFAULT_VIDEO_ANALYSIS_MODEL).toBe("gemini-3.1-pro")
    expect(resolveVideoAnalysisModel("pro")).toBe("gemini-3.1-pro")
    expect(resolveVideoAnalysisModel("fast")).toBe("gemini-3-flash")
    expect(resolveVideoAnalysisModel("gemini-3-flash")).toBe("gemini-3-flash") // raw passthrough
    expect(resolveVideoAnalysisModel(undefined)).toBe("gemini-3.1-pro") // default → pro
    expect(resolveVideoAnalysisModel("")).toBe("gemini-3.1-pro")
    expect(resolveVideoAnalysisModel("nonsense")).toBe("gemini-3.1-pro") // unknown → default, never throws
  })

  // Full drift-detection against the live $-formula lives in
  // backend/src/lib/pricing/__tests__/video-analysis-cost.test.ts (this
  // package cannot see the formula post-S5). This is a lightweight shape
  // check that the precomputed table covers every legal id.
  it("VIDEO_ANALYSIS_BUCKET_CREDITS has a positive-integer entry for every model × bucket id", () => {
    for (const model of VIDEO_ANALYSIS_LLM_MODELS) {
      for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
        const id = buildVideoAnalysisCreditId(model, bucketSec)
        const credits = VIDEO_ANALYSIS_BUCKET_CREDITS[id]
        expect(credits, `missing entry for ${id}`).toBeDefined()
        expect(Number.isInteger(credits)).toBe(true)
        expect(credits).toBeGreaterThan(0)
      }
    }
  })
})
