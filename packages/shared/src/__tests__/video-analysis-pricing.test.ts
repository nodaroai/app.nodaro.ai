import { describe, it, expect } from "vitest"
import {
  VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC,
  pickVideoAnalysisBucket, buildVideoAnalysisCreditId, bucketSecondsFromCreditId,
  videoAnalysisNumWindows, videoAnalysisBucketCredits,
} from "../video-analysis-pricing.js"
import { VIDEO_ANALYSIS_LLM_MODELS, getLlmModel } from "../llm-models.js"

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

  // CROSS-CHECK RULE: these worked examples MUST equal the docs table
  // (docs/nodes/processing-video/video-analysis.md), model-catalog.ts variants,
  // AND the model_pricing DB rows (migrations 247+248) — regenerate ALL on any
  // constant/rate change.
  [econ-intel comment removed]
    expect([60, 180, 360, 600].map((b) => videoAnalysisBucketCredits("gemini-3-flash", b))).toEqual([1, 1, 2, 3])
    expect([60, 180, 360, 600].map((b) => videoAnalysisBucketCredits("gemini-3.1-pro", b))).toEqual([2, 3, 7, 11])
  })

  // [econ-intel comment removed]
  // to the cent. Changing either pair shifts the bucket schedule above — if this
  // [econ-intel comment removed]
  it("gemini rates are pinned to measured KIE billing", () => {
    expect(getLlmModel("gemini-3-flash")).toMatchObject({ inputPricePerM: 0.15, outputPricePerM: 0.90 })
    expect(getLlmModel("gemini-3.1-pro")).toMatchObject({ inputPricePerM: 0.50, outputPricePerM: 3.50 })
  })

  it("tolerance constant is exported for the worker re-check", () => {
    expect(VIDEO_ANALYSIS_DURATION_TOLERANCE_SEC).toBe(3)
  })

  it("model SSOT is capability-derived and Gemini-only today", () => {
    expect(VIDEO_ANALYSIS_LLM_MODELS).toEqual(["gemini-3-flash", "gemini-3.1-pro"])
  })
})
