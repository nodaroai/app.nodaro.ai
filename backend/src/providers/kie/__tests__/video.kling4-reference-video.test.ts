import { describe, it, expect, vi, beforeEach } from "vitest"
import sharp from "sharp"

/**
 * `runKling4` sends every reference video through the size check before the
 * task is created (`../reference-video-size.ts`), and the body carries what
 * the check returned — the shrunk copy, not the over-size original.
 */

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  ensureVideoFitsSize: vi.fn(),
  safeFetch: vi.fn(),
  uploadBufferToR2: vi.fn(),
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

// A start frame is fetched and normalized like any image the body carries.
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.safeFetch }))
vi.mock("../../../lib/storage.js", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  uploadBufferToR2: mocks.uploadBufferToR2,
}))

import { KieVideoProvider } from "../video.js"

const ORIGINAL = "https://cdn.nodaro.ai/tmp/provider-input/run/preview-wide.mp4"
const SHRUNK = "https://cdn.nodaro.ai/tmp/provider-input/job/provider-shrunk-1.mp4"

beforeEach(async () => {
  vi.clearAllMocks()
  const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: "#3a6" } }).png().toBuffer()
  mocks.safeFetch.mockResolvedValue({ ok: true, status: 200, body: { cancel: async () => {} }, arrayBuffer: async () => png })
  mocks.uploadBufferToR2.mockImplementation(async (_b: Buffer, key: string) => `https://cdn.test/${key}`)
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

/**
 * What Extend Video's Kling 4 run sends (the tail recipe, lib/extend-recipe.ts):
 * the source's last frame as the start frame and its 3 s tail as `@video_1`.
 * On Kling 4.0's reference endpoint the start frame joins the images (seated
 * `@image_1` and named the opening frame in a sentence after the prompt), and
 * the tail rides as the run's one reference video.
 */
describe("Kling 4 Extend's generation call", () => {
  const FRAME = "https://cdn.nodaro.ai/tmp/provider-input/job-1/extend-last-frame.png"
  const TAIL = "https://cdn.nodaro.ai/tmp/provider-input/job-1/extend-tail.mp4"
  const PROMPT = "Continue @video_1 as one continuous shot, starting exactly where it ends: she opens the door"

  it("takes the tail as its reference video and the last frame among its images", async () => {
    mocks.ensureVideoFitsSize.mockImplementation(async (u: string) => u)
    await new KieVideoProvider().imageToVideo(FRAME, PROMPT, "kling-4", 5, undefined, {
      resolution: "720p",
      referenceVideoUrls: [TAIL],
      aspectRatio: "16:9",
    })
    const [model, input] = mocks.runKieTask.mock.calls[0] as [string, Record<string, unknown>]
    expect(model).toBe("kling-4.0/reference-to-video")
    expect(input.video_urls).toEqual([TAIL])
    // The tail's own sound is not kept: Kling makes the continuation's sound.
    expect(input.keep_original_sound).toBe(false)
    expect((input.image_urls as string[]).length).toBe(1)
    expect(input).toMatchObject({ duration: 5, resolution: "720p", aspect_ratio: "16:9" })
    // The wrapper reaches Kling as written, `@video_1` declared; the opening
    // frame is named after it.
    expect(input.prompt).toBe(`${PROMPT}\n\nUse @image_1 as the opening (first) frame of the video.`)
  })
})
