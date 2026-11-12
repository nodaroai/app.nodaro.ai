import { describe, it, expect, vi } from "vitest"
import { NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES } from "../nodaro-video-upscale-sentences.js"
import { houseModelLane, houseModelLaneProblems } from "../house-model-lanes.js"
import { houseModelFailureError } from "../house-model-failure.js"

/**
 * Nodaro Video Upscale's failure sentences: one per class, each pointing to
 * another clip and to Topaz, never prompt advice (an upscale has no prompt)
 * and never an address. Its lane row carries them, so the seam's failure error
 * reads them (the worker's final catch and the reconcile keep that sentence).
 */
describe("Nodaro Video Upscale's failure sentences", () => {
  it("say what to do instead, and give no prompt advice", () => {
    for (const [cls, sentence] of Object.entries(NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES)) {
      expect(sentence, cls).toMatch(/Try another clip, or choose Topaz\.$/)
      expect(sentence, cls).not.toMatch(/prompt|https?:|provider/i)
    }
    expect(Object.keys(NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES).sort()).toEqual(["contentPolicy", "inputRefused"])
  })

  it("are the lane row's own, and the row is one the runner may use", () => {
    const lane = houseModelLane("nodaro-video-upscale")
    expect(lane?.failureSentences).toBe(NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES)
    expect(houseModelLaneProblems(lane)).toEqual([])
  })

  it("are what a failed run reads, by its class", () => {
    const ctx = { id: "nodaro-video-upscale", jobId: "job-1" }
    vi.spyOn(console, "warn").mockImplementation(() => {})
    expect(houseModelFailureError({ message: "x", contentPolicy: true }, ctx).message).toBe(NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES.contentPolicy)
    expect(houseModelFailureError({ message: "x", inputVideoRefused: true }, ctx).message).toBe(NODARO_VIDEO_UPSCALE_FAILURE_SENTENCES.inputRefused)
    // Any other failure: the seam's fixed sentence.
    expect(houseModelFailureError({ message: "x" }, ctx).message).toBe("Nodaro Video Upscale could not complete this run.")
  })
})
