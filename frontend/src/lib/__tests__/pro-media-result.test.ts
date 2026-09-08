import { describe, expect, it } from "vitest"
import { proMediaCompletionPatch } from "../scene3d/pro-media-result"

describe("Pro render media completion", () => {
  const timestamp = "2026-09-08T02:10:00.000Z"

  it("preserves results already in the live node and records the settling job", () => {
    const existing = Object.freeze({ url: "prior.mp4", jobId: "prior", timestamp })
    const history = Object.freeze([existing])
    const patch = proMediaCompletionPatch(
      { videoUrl: "new.mp4", jobId: "untrusted-output-job" },
      { jobId: "settling-job", liveNode: { generatedResults: history } },
      timestamp,
    )
    expect(patch).toEqual({
      generatedVideoUrl: "new.mp4",
      generatedResults: [existing, { url: "new.mp4", jobId: "settling-job", timestamp }],
      activeResultIndex: 1,
    })
    expect(history).toEqual([existing])
  })

  it("selects a previously recorded job without duplicating or altering it", () => {
    const history = [{ url: "saved.mp4", jobId: "job", timestamp }]
    expect(proMediaCompletionPatch(
      { videoUrl: "replayed.mp4" },
      { jobId: "job", liveNode: { generatedResults: history } },
    )).toEqual({ generatedVideoUrl: "saved.mp4", generatedResults: history, activeResultIndex: 0 })
  })

  it("creates the first result with a valid timestamp", () => {
    const patch = proMediaCompletionPatch({ videoUrl: "first.mp4" }, { jobId: "first", liveNode: {} })
    expect(patch).toMatchObject({ activeResultIndex: 0, generatedResults: [{ url: "first.mp4", jobId: "first" }] })
    const result = (patch.generatedResults as Array<{ timestamp: string }>)[0]
    expect(Number.isFinite(Date.parse(result.timestamp))).toBe(true)
  })

  it.each([undefined, null, "", 42])("leaves media untouched without a video URL (%s)", (videoUrl) => {
    expect(proMediaCompletionPatch({ videoUrl }, { jobId: "job", liveNode: {} })).toEqual({})
  })
})
