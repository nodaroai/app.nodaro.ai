import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Seedance 2.5 decides SERVER-SIDE, from the prompt, whether a run carrying a
 * reference video is an ordinary generation or an EDIT of that clip. Edit mode
 * forbids the two shape levers the editor legitimately offers and KIE rejects
 * the task:
 *
 *   "The parameters `ratio` and `duration` specified in the request are not
 *    valid. Seedance identified your task as video editing based on your
 *    prompt. ... Issues: [0] `ratio` must be `adaptive`. [1] `duration` must
 *    be -1."
 *
 * Nothing in the payload predicts that verdict, so the provider's own words are
 * the only signal: recognise this rejection and resubmit once with the values
 * it asked for. The user sees a video, not a failure.
 *
 * Reported from the field 2026-09-10: a Generate Video node with a video wired
 * into Video Refs at 16:9 / 12 s, next to an identical node with no explicit
 * ratio that succeeded as `adaptive`.
 */

const mocks = vi.hoisted(() => ({
  mockRunKieTask: vi.fn(),
  mockRunVeoTask: vi.fn(),
  mockCreateSanitizedError: vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`)),
  mockKling3Generate: vi.fn(),
  mockUploadBufferToR2: vi.fn(),
  mockSafeFetch: vi.fn(),
}))

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
}))

vi.mock("../kling3-client.js", () => ({ kling3Generate: mocks.mockKling3Generate }))

// The reference-video re-encode is tested on its own
// (reference-video-reencode.test.ts); here every clip passes through as sent.
vi.mock("../reference-video-reencode.js", () => ({
  reencodeReferenceVideos: async (urls: string[]) => urls,
}))

vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))

vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))

vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ format: "jpeg", width: 1024, height: 1024 })
    chain.rotate = () => chain
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.webp = () => chain
    chain.png = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("converted-jpeg-data"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider, isSeedance2EditModeRejection, SEEDANCE_2_EDIT_MODE_PARAMS } from "../video.js"

/** KIE's message, verbatim from the field report. */
const EDIT_MODE_FAILMSG =
  "task failed: [500] The parameters `ratio` and `duration` specified in the request are not valid. " +
  "Seedance identified your task as video editing based on your prompt. For this task type, the output " +
  "ratio and duration follow the input video selected by the model for editing, and the video selected " +
  "must satisfy the duration requirement of 4 to 30 seconds. " +
  "Issues: [0] `ratio` must be `adaptive`. [1] `duration` must be -1."

const OK = { resultJson: { resultUrls: ["https://cdn.kie.ai/video.mp4"] }, taskId: "t-2" }

let provider: KieVideoProvider

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "warn").mockImplementation(() => {})
  mocks.mockUploadBufferToR2.mockResolvedValue("https://cdn.nodaro.ai/images/converted.jpg")
  mocks.mockSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  })
  provider = new KieVideoProvider()
})

/** The two payloads runKieTask was called with, in order. */
const sentInputs = () =>
  mocks.mockRunKieTask.mock.calls.map((c) => c[1] as Record<string, unknown>)

describe("isSeedance2EditModeRejection", () => {
  it("recognises the full message", () => {
    expect(isSeedance2EditModeRejection(EDIT_MODE_FAILMSG)).toBe(true)
  })

  it("recognises each issue on its own — KIE lists only the params that are wrong", () => {
    expect(isSeedance2EditModeRejection("Issues: [0] `ratio` must be `adaptive`.")).toBe(true)
    expect(isSeedance2EditModeRejection("Issues: [0] `duration` must be -1.")).toBe(true)
    expect(isSeedance2EditModeRejection("Seedance identified your task as video editing")).toBe(true)
  })

  it("survives the backticks being stripped somewhere in transit", () => {
    expect(isSeedance2EditModeRejection("ratio must be adaptive")).toBe(true)
    expect(isSeedance2EditModeRejection("duration must be -1")).toBe(true)
  })

  it("does NOT match unrelated provider failures", () => {
    for (const msg of [
      "task failed: [500] Internal server error",
      "task failed: [400] Invalid aspect ratio setting",
      "content policy violation: the prompt was blocked",
      "task failed: [429] rate limited",
      "createTask failed: 401 - unauthorized",
      // near-misses that must stay unmatched
      "duration must be 4 to 30 seconds",
      "ratio must be 16:9",
    ]) {
      expect(isSeedance2EditModeRejection(msg), msg).toBe(false)
    }
  })
})

describe("seedance-2-5 edit-mode retry (i2v entry path)", () => {
  it("resubmits once as adaptive / -1 and returns the video", async () => {
    mocks.mockRunKieTask
      .mockRejectedValueOnce(new Error(EDIT_MODE_FAILMSG))
      .mockResolvedValueOnce(OK)

    const result = await provider.imageToVideo(
      undefined,
      "remove the word motionsites",
      "seedance-2-5",
      12,
      undefined,
      {
        aspectRatio: "16:9",
        resolution: "720p",
        referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
      } as never,
    )

    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)

    const [first, second] = sentInputs()
    // The first attempt is unchanged — the user's choice is still tried first.
    expect(first.aspect_ratio).toBe("16:9")
    expect(second.aspect_ratio).toBe(SEEDANCE_2_EDIT_MODE_PARAMS.aspect_ratio)
    expect(second.duration).toBe(SEEDANCE_2_EDIT_MODE_PARAMS.duration)
    // Everything else rides along untouched — the retry is a shape fix, not a
    // different generation.
    expect(second.prompt).toBe(first.prompt)
    expect(second.reference_video_urls).toEqual(first.reference_video_urls)
    expect(second.resolution).toBe(first.resolution)
    // …and the first payload was not mutated on the way.
    expect(first.duration).not.toBe(-1)
  })

  it("recognises the rejection in the error runKieTask REALLY throws — a sanitized KieError", async () => {
    // Production never hands the provider layer a plain Error: runKieTask
    // throws createSanitizedError's KieError, whose `.message` is the user-safe
    // text ("the provider rejected these settings…") and whose
    // `.internalDetails` carries KIE's own words. A detector reading only
    // `.message` never fires — field report 2026-09-18, job 83e90e87, a 25s /
    // 9:16 "edit @video_1 …" run that failed with the retry code deployed.
    const actual = await vi.importActual<typeof import("../client.js")>("../client.js")
    vi.spyOn(console, "error").mockImplementation(() => {})
    const kieError = actual.createSanitizedError(EDIT_MODE_FAILMSG.replace("[500]", "[400]"), "Generation", true)
    expect(isSeedance2EditModeRejection(kieError.message)).toBe(false) // the trap

    mocks.mockRunKieTask.mockRejectedValueOnce(kieError).mockResolvedValueOnce(OK)

    const result = await provider.textToVideo("edit @video_1 as follows: …", "seedance-2-5", 25, {
      aspectRatio: "9:16",
      resolution: "480p",
      referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
    } as never)

    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
    expect(sentInputs()[1]).toMatchObject(SEEDANCE_2_EDIT_MODE_PARAMS)
  })

  it("retries at most once — a second edit-mode rejection surfaces", async () => {
    mocks.mockRunKieTask.mockRejectedValue(new Error(EDIT_MODE_FAILMSG))

    await expect(
      provider.imageToVideo(undefined, "edit it", "seedance-2-5", 12, undefined, {
        aspectRatio: "16:9",
        referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
      } as never),
    ).rejects.toThrow(/video editing/)

    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
  })

  it("still retries when only the duration is wrong — an adaptive ratio is not enough", async () => {
    // The node's ratio is already adaptive, but every payload carries a real
    // duration (the model's own default when the user picked none), and edit
    // mode refuses any number. Half-right must not read as "nothing to fix".
    mocks.mockRunKieTask
      .mockRejectedValueOnce(new Error("task failed: [500] Issues: [0] `duration` must be -1."))
      .mockResolvedValueOnce(OK)

    const result = await provider.imageToVideo(
      undefined,
      "edit it",
      "seedance-2-5",
      undefined,
      undefined,
      {
        aspectRatio: "adaptive",
        referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
      } as never,
    )

    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    const [first, second] = sentInputs()
    expect(first.aspect_ratio).toBe("adaptive")
    expect(Number(first.duration)).toBeGreaterThan(0)
    expect(second.duration).toBe(-1)
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)
  })

  it("does not retry an unrelated failure", async () => {
    mocks.mockRunKieTask.mockRejectedValue(new Error("task failed: [500] Internal server error"))

    await expect(
      provider.imageToVideo(undefined, "a cat", "seedance-2-5", 12, undefined, {
        aspectRatio: "16:9",
        referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
      } as never),
    ).rejects.toThrow(/Internal server error/)

    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
  })

  it("does not retry for a non-seedance provider that happens to say the same thing", async () => {
    mocks.mockRunKieTask.mockRejectedValue(new Error(EDIT_MODE_FAILMSG))

    // bytedance-pro takes the same standard createTask path, so the task really
    // is submitted — the gate under test is the provider check, not an early
    // "unsupported provider" throw.
    await expect(
      provider.imageToVideo(
        "https://cdn.nodaro.ai/images/frame.jpg",
        "a cat",
        "bytedance-pro",
        5,
        undefined,
        { aspectRatio: "16:9" } as never,
      ),
    ).rejects.toThrow()

    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
  })

  it("leaves the happy path at exactly one submit", async () => {
    mocks.mockRunKieTask.mockResolvedValue(OK)

    const result = await provider.imageToVideo(
      undefined,
      "a cat in a hat",
      "seedance-2-5",
      12,
      undefined,
      { aspectRatio: "16:9", referenceVideoUrls: ["https://cdn.nodaro.ai/videos/style.mp4"] } as never,
    )

    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
    // A style reference keeps the user's chosen shape — the coercion must never
    // fire on "a video is attached" alone.
    expect(sentInputs()[0].aspect_ratio).toBe("16:9")
  })
})

describe("seedance-2-5 edit-mode retry (t2v entry path)", () => {
  it("resubmits once as adaptive / -1", async () => {
    mocks.mockRunKieTask
      .mockRejectedValueOnce(new Error(EDIT_MODE_FAILMSG))
      .mockResolvedValueOnce(OK)

    const result = await provider.textToVideo(
      "remove the watermark",
      "seedance-2-5",
      12,
      "16:9",
      { referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"], aspectRatio: "16:9" } as never,
    )

    expect(result.url).toBe("https://cdn.kie.ai/video.mp4")
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(2)

    const [, second] = sentInputs()
    expect(second.aspect_ratio).toBe("adaptive")
    expect(second.duration).toBe(-1)
  })
})

describe("auto duration (-1) — sent up front, never snapped", () => {
  it("t2v: a Seedance run carries KIE's own sentinel instead of the shortest allowed clip", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce(OK)
    await provider.textToVideo("a quiet street at dawn", "seedance-2-5", -1, { aspectRatio: "16:9" } as never)
    expect(sentInputs()[0].duration).toBe(-1)
  })

  it("i2v: an explicit edit (adaptive + Auto) is already in edit shape — one submit, no retry", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce(OK)
    await provider.imageToVideo(undefined, "edit @video_1 as follows: …", "seedance-2-5", -1, undefined, {
      aspectRatio: "adaptive",
      referenceVideoUrls: ["https://cdn.nodaro.ai/videos/source.mp4"],
    } as never)
    expect(mocks.mockRunKieTask).toHaveBeenCalledTimes(1)
    expect(sentInputs()[0]).toMatchObject(SEEDANCE_2_EDIT_MODE_PARAMS)
  })

  it("a model without the capability keeps its render default", async () => {
    mocks.mockRunKieTask.mockResolvedValueOnce(OK)
    await provider.textToVideo("a quiet street at dawn", "minimax-h3", -1, {} as never)
    expect(sentInputs()[0].duration).not.toBe(-1)
    expect(Number(sentInputs()[0].duration)).toBeGreaterThan(0)
  })

  it("a BESPOKE builder never sees Auto — Kling 3.0 renders its default, not the shortest clip", async () => {
    // runKling3 snaps a truthy duration to the nearest allowed value; -1 would
    // have become 3s. Auto is neutralised once, at the entry point.
    mocks.mockKling3Generate.mockResolvedValueOnce({ videoUrl: "https://cdn.kie.ai/k3.mp4" })
    await provider.textToVideo("a quiet street at dawn", "kling-3.0", -1, {} as never)
    expect(mocks.mockKling3Generate.mock.calls[0]![0].duration).toBe("5")
  })
})
