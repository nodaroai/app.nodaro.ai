import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * `runKling4` sends every reference video through the size check before the
 * task is created (`../reference-video-size.ts`), and the body carries what
 * the check returned — the shrunk copy, not the over-size original.
 */

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  ensureVideoFitsSize: vi.fn(),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.runKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

vi.mock("../reference-video-size.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../reference-video-size.js")>()),
  ensureVideoFitsSize: mocks.ensureVideoFitsSize,
}))

import { KieVideoProvider } from "../video.js"

const ORIGINAL = "https://cdn.nodaro.ai/tmp/provider-input/run/preview-wide.mp4"
const SHRUNK = "https://cdn.nodaro.ai/tmp/provider-input/job/provider-shrunk-1.mp4"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.ensureVideoFitsSize.mockResolvedValue(SHRUNK)
  mocks.runKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://x/out.mp4"] }, taskId: "t1", providerMs: 1 })
})

describe("Kling 4 reference videos", () => {
  it("are checked against the Kling 4 size limit and the body carries the checked URL", async () => {
    await new KieVideoProvider().textToVideo("edit @video_1 as follows: make it sharp", "kling-4", 4, "auto", {
      referenceVideoUrls: [ORIGINAL],
      keepOriginalSound: true,
    })
    expect(mocks.ensureVideoFitsSize).toHaveBeenCalledWith(ORIGINAL, { maxDimension: 2048, maxPixels: 1920 * 1080 }, "Video generation", expect.any(String), "reference video #1")
    const [model, input] = mocks.runKieTask.mock.calls[0] as [string, Record<string, unknown>]
    expect(model).toBe("kling-4.0/reference-to-video")
    expect(input.video_urls).toEqual([SHRUNK])
    expect(input.keep_original_sound).toBe(true)
  })

  it("a run with no reference video makes no check", async () => {
    await new KieVideoProvider().textToVideo("a cat on a roof", "kling-4", 4, "16:9")
    expect(mocks.ensureVideoFitsSize).not.toHaveBeenCalled()
  })
})
