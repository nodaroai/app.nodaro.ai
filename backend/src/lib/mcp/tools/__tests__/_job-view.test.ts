import { describe, it, expect } from "vitest"
import { jobView, resolveOutputUrl, assetKindOf } from "../_job-view.js"

// Audit 2026-09-06 fix #2 (A-5 / A-12): two job readers, two shapes — `get_job`
// returned the raw row as text with per-type output keys, `get_asset` a
// normalised object, and every verb pointed the agent at the weaker one. One
// envelope, built here, declared as the readers' outputSchema.
describe("jobView — the one job envelope", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    status: "completed",
    progress: 100,
    job_type: "generate-image",
    output_data: { imageUrl: "https://r2/x.png", prompt: "a cat" },
    error_message: null,
    error_hint: null,
    credits: 12,
    created_at: "2026-09-06T10:00:00Z",
    started_at: "2026-09-06T10:00:01Z",
    completed_at: "2026-09-06T10:00:20Z",
  }

  it("resolves the output url and asset kind from the per-type output keys", () => {
    expect(resolveOutputUrl({ imageUrl: "a" })).toBe("a")
    expect(resolveOutputUrl({ videoUrl: "v" })).toBe("v")
    expect(resolveOutputUrl({ audioUrl: "au" })).toBe("au")
    expect(resolveOutputUrl({ outputUrl: "o" })).toBe("o")
    expect(resolveOutputUrl({ url: "u" })).toBe("u")
    expect(resolveOutputUrl({})).toBeNull()
    expect(assetKindOf({ imageUrl: "a" })).toBe("image")
    expect(assetKindOf({ videoUrl: "v" })).toBe("video")
    expect(assetKindOf({ audioUrl: "au" })).toBe("audio")
    expect(assetKindOf({ text: "t" })).toBeNull()
  })

  it("maps a completed row to the envelope", () => {
    const v = jobView(base)
    expect(v).toEqual({
      jobId: base.id,
      status: "completed",
      progress: 100,
      jobType: "generate-image",
      assetKind: "image",
      outputUrl: "https://r2/x.png",
      outputData: { imageUrl: "https://r2/x.png", prompt: "a cat" },
      errorMessage: null,
      credits: 12,
      createdAt: base.created_at,
      startedAt: base.started_at,
      completedAt: base.completed_at,
    })
  })

  it("adds retryable + guidance on a failure, with the catalog fallback when the hint carries one", () => {
    const v = jobView({
      ...base,
      status: "failed",
      output_data: null,
      error_message: "Content policy violation: blocked",
      error_hint: { kind: "safety-block", suggestedProvider: "flux-2-pro" },
    })
    expect(v.status).toBe("failed")
    expect(v.retryable).toBe(false)
    expect(v.suggestedProvider).toBe("flux-2-pro")
    expect(typeof v.guidance).toBe("string")
    expect(v.outputUrl).toBeNull()
  })

  it("explains a held job as not retryable and tells the agent not to re-run it", () => {
    const v = jobView({ ...base, status: "pending_review", output_data: null })
    expect(v.status).toBe("pending_review")
    expect(v.retryable).toBe(false)
    expect(v.guidance).toContain("Do NOT re-run")
  })

  it("redacts private remux bases out of outputData", () => {
    const v = jobView({
      ...base,
      job_type: "generate-video-pro",
      output_data: { videoUrl: "https://public/final.mp4", pro: { unscoredUrl: "https://private/base.mp4?token=s", audio: { revision: "a2" } } },
    })
    expect(v.outputData).toEqual({ videoUrl: "https://public/final.mp4", pro: { audio: { revision: "a2" } } })
    expect(v.outputUrl).toBe("https://public/final.mp4")
  })
})
