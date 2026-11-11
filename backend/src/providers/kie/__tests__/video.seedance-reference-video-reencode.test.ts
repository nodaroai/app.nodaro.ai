import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * A Seedance 2.x run sends every reference video re-encoded
 * (`../reference-video-reencode.ts`), on both entry paths (i2v and t2v), and
 * the task body carries the re-encoded copies, never the clips as they came.
 * Images and audio are untouched, and so is every other model.
 */

const mocks = vi.hoisted(() => ({
  runKieTask: vi.fn(),
  reencodeReferenceVideos: vi.fn(),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.runKieTask,
  runVeoTask: vi.fn(),
  createSanitizedError: (msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`),
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

vi.mock("../reference-video-reencode.js", () => ({ reencodeReferenceVideos: mocks.reencodeReferenceVideos }))

import { KieVideoProvider, SEEDANCE_2_EDIT_MODE_PARAMS } from "../video.js"

const SOURCE = "https://cdn.nodaro.ai/videos/seedance-output.mp4"
const SECOND = "https://cdn.nodaro.ai/videos/style.mp4"
const reencoded = (url: string) => url.replace("https://cdn.nodaro.ai/videos/", "https://cdn.nodaro.ai/tmp/provider-input/job/provider-reencoded-")
const OK = { resultJson: { resultUrls: ["https://cdn.kie.ai/video.mp4"] }, taskId: "t-1", providerMs: 1 }

/** KIE's answer when it reads the prompt as an edit and the shape is not the edit's. */
const EDIT_MODE_FAILMSG =
  "task failed: [500] Seedance identified your task as video editing based on your prompt. " +
  "Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1."

const sentInputs = () => mocks.runKieTask.mock.calls.map((c) => c[1] as Record<string, unknown>)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.reencodeReferenceVideos.mockImplementation(async (urls: string[]) => urls.map(reencoded))
  mocks.runKieTask.mockResolvedValue(OK)
})

describe("Seedance 2.x reference videos are sent re-encoded", () => {
  it("an edit (t2v entry: edit prompt, adaptive, Auto length) carries the re-encoded clip, not the original", async () => {
    await new KieVideoProvider().textToVideo("edit @video_1 as follows:\nrestyle it as a watercolour", "seedance-2-5", -1, "adaptive", {
      referenceVideoUrls: [SOURCE],
    })
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledTimes(1)
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledWith([SOURCE], "seedance-2-5")
    const [input] = sentInputs()
    expect(input!.reference_video_urls).toEqual([reencoded(SOURCE)])
    expect(JSON.stringify(input)).not.toContain(SOURCE)
    expect(input).toMatchObject(SEEDANCE_2_EDIT_MODE_PARAMS)
  })

  it("the i2v entry path does the same, for every clip in order", async () => {
    await new KieVideoProvider().imageToVideo(undefined, "edit @video_1 as follows: make it night", "seedance-2-5", -1, undefined, {
      aspectRatio: "adaptive",
      referenceVideoUrls: [SOURCE, SECOND],
    })
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledWith([SOURCE, SECOND], "seedance-2-5")
    expect(sentInputs()[0]!.reference_video_urls).toEqual([reencoded(SOURCE), reencoded(SECOND)])
  })

  it("the edit-mode resubmit reuses the same copy: one encode, both bodies carry it", async () => {
    mocks.runKieTask.mockRejectedValueOnce(new Error(EDIT_MODE_FAILMSG)).mockResolvedValueOnce(OK)
    await new KieVideoProvider().imageToVideo(undefined, "restyle @video_1 as follows: anime", "seedance-2-5", 12, undefined, {
      aspectRatio: "16:9",
      referenceVideoUrls: [SOURCE],
    })
    expect(mocks.runKieTask).toHaveBeenCalledTimes(2)
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledTimes(1)
    for (const input of sentInputs()) expect(input.reference_video_urls).toEqual([reencoded(SOURCE)])
  })

  it("covers the other Seedance 2 models on the same transport", async () => {
    await new KieVideoProvider().textToVideo("a dancer in the style of @video_1", "seedance-2", 8, "16:9", {
      referenceVideoUrls: [SOURCE],
    })
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledWith([SOURCE], "seedance-2")
    expect(sentInputs()[0]!.reference_video_urls).toEqual([reencoded(SOURCE)])
  })

  it("leaves reference audio as it is, and hands the encoder only the videos", async () => {
    // (Reference images keep their own preparation, normalizeReferenceImages.)
    const audio = "https://cdn.nodaro.ai/audio/ref.mp3"
    await new KieVideoProvider().textToVideo("edit @video_1 as follows: voice from @audio_1", "seedance-2-5", -1, "adaptive", {
      referenceVideoUrls: [SOURCE],
      referenceAudioUrls: [audio],
    })
    const [input] = sentInputs()
    expect(input!.reference_audio_urls).toEqual([audio])
    expect(mocks.reencodeReferenceVideos).toHaveBeenCalledWith([SOURCE], "seedance-2-5")
  })

  it("a run with no reference video makes no encode and sends no reference_video_urls", async () => {
    await new KieVideoProvider().textToVideo("a quiet street at dawn", "seedance-2-5", 8, "16:9")
    expect(mocks.reencodeReferenceVideos).not.toHaveBeenCalled()
    expect(sentInputs()[0]).not.toHaveProperty("reference_video_urls")
  })

  it("a failed encode fails the run before any task is created", async () => {
    mocks.reencodeReferenceVideos.mockRejectedValueOnce(new Error("[Video generation] Could not prepare reference video #1 for this model"))
    await expect(
      new KieVideoProvider().textToVideo("edit @video_1 as follows: restyle", "seedance-2-5", -1, "adaptive", { referenceVideoUrls: [SOURCE] }),
    ).rejects.toThrow(/Could not prepare reference video #1/)
    expect(mocks.runKieTask).not.toHaveBeenCalled()
  })
})

describe("other models are untouched", () => {
  it("MiniMax H3 (same input resolver, another transport) sends its clip as it is", async () => {
    await new KieVideoProvider().textToVideo("a dancer in the style of @video_1", "minimax-h3", 8, "16:9", {
      referenceVideoUrls: [SOURCE],
    })
    expect(mocks.reencodeReferenceVideos).not.toHaveBeenCalled()
    expect(sentInputs()[0]!.reference_video_urls).toEqual([SOURCE])
  })
})
