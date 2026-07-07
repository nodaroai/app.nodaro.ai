import { describe, it, expect } from "vitest"
import { VIDEO_ANALYSIS_LLM_MODELS, VIDEO_ANALYSIS_DURATION_BUCKETS, VIDEO_ANALYSIS_BUCKET_CREDITS, buildVideoAnalysisCreditId } from "@nodaro/shared"
import { videoAnalysisBucketCredits, VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS } from "../video-analysis-cost.js"

// CROSS-CHECK RULE: these worked examples MUST equal the docs table
// (docs/nodes/processing-video/video-analysis.md), model-catalog.ts variants,
// AND the model_pricing DB rows (migrations 247+248) — regenerate ALL on any
// constant/rate change.
describe("videoAnalysisBucketCredits", () => {
  [econ-intel comment removed]
    expect([60, 180, 360, 600].map((b) => videoAnalysisBucketCredits("gemini-3-flash", b))).toEqual([1, 1, 2, 3])
    expect([60, 180, 360, 600].map((b) => videoAnalysisBucketCredits("gemini-3.1-pro", b))).toEqual([2, 3, 7, 11])
  })

  it("system prompt token count is measured, not a placeholder", () => {
    expect(VIDEO_ANALYSIS_SYSTEM_PROMPT_TOKENS).toBe(3_151)
  })
})

// [econ-intel comment removed]
// to the cent. Changing either pair shifts the bucket schedule above — if this
// [econ-intel comment removed]
describe("gemini rates are pinned to measured KIE billing", () => {
  it("gemini-3-flash and gemini-3.1-pro produce the documented bucket schedule", () => {
    // Rates themselves are private to this module (moved out of the published
    // @nodaro/shared package, S5) — assert via the bucket-credit OUTPUT instead
    // of reading a rate table directly.
    expect(videoAnalysisBucketCredits("gemini-3-flash", 60)).toBe(1)
    expect(videoAnalysisBucketCredits("gemini-3.1-pro", 60)).toBe(2)
  })
})

// Guards drift between the $-derived formula (here, core-only) and the
// precomputed public lookup table the frontend reads
// (`VIDEO_ANALYSIS_BUCKET_CREDITS` in `@nodaro/shared`, consumed by
// `estimateNodeCredits` in workflow-editor/types.ts). Mirrors the pattern
// `film-pricing.ts`'s `VIDEO_CLIP_CREDITS` uses against `STATIC_CREDIT_COSTS`.
describe("VIDEO_ANALYSIS_BUCKET_CREDITS (shared) matches the live formula (this module)", () => {
  it("every VIDEO_ANALYSIS_LLM_MODELS × bucket combination matches", () => {
    for (const model of VIDEO_ANALYSIS_LLM_MODELS) {
      for (const bucketSec of VIDEO_ANALYSIS_DURATION_BUCKETS) {
        const id = buildVideoAnalysisCreditId(model, bucketSec)
        const expected = videoAnalysisBucketCredits(model, bucketSec)
        expect(
          VIDEO_ANALYSIS_BUCKET_CREDITS[id],
          `VIDEO_ANALYSIS_BUCKET_CREDITS["${id}"] = ${VIDEO_ANALYSIS_BUCKET_CREDITS[id]}, expected ${expected} — regenerate the shared table`,
        ).toBe(expected)
      }
    }
  })

  it("has no stale entries beyond the current model × bucket cross product", () => {
    const expectedIds = new Set(
      VIDEO_ANALYSIS_LLM_MODELS.flatMap((model) =>
        VIDEO_ANALYSIS_DURATION_BUCKETS.map((bucketSec) => buildVideoAnalysisCreditId(model, bucketSec)),
      ),
    )
    expect(new Set(Object.keys(VIDEO_ANALYSIS_BUCKET_CREDITS))).toEqual(expectedIds)
  })
})
