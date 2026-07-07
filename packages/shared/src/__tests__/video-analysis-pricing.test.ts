import { describe, it, expect } from "vitest"
import {
  VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC,
  VIDEO_ANALYSIS_BUCKET_CREDITS,
  pickVideoAnalysisBucket, buildVideoAnalysisCreditId, bucketSecondsFromCreditId,
  videoAnalysisNumWindows,
} from "../video-analysis-pricing.js"
import { VIDEO_ANALYSIS_LLM_MODELS } from "../llm-models.js"

// The measured-rate constants and the $-derived `videoAnalysisBucketCredits`
// formula moved to backend/src/lib/pricing/video-analysis-cost.ts (S5) — its
// tests (including the worked-example bucket-credit values and the
// cross-check against VIDEO_ANALYSIS_BUCKET_CREDITS below) live in
// backend/src/lib/pricing/__tests__/video-analysis-cost.test.ts. This file
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
