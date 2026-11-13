import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Grok Extend (`grok-extend`) in the worker: a native extend of Grok's own
// clips, delivered AS IT IS.
//
// The contract this file pins, in order of importance:
//   1. The deliverable is Grok's output as it is (its own render of the source,
//      then the new seconds): nothing is cut, stitched or re-encoded of the
//      user's — the clip goes to storage as the other provider results do.
//   2. Grok is asked for the source's task the check matched, the prompt as
//      written, the seconds the run was priced at, from the source's exact
//      picture length, with the source's resolution named to the egress seam.
//   3. New seconds = Grok's output picture − the source's. Under half the paid
//      seconds fails the run, final on this attempt (a DeterministicJobError,
//      refunded in full) before anything is stored. A probe that fails is a
//      plain, retryable error.
//   4. The job's own row records provider `grok-extend` (never the Grok model it
//      extends), so an extension is never taken as a source to extend again.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  mockRunGrokExtend: vi.fn(),
  mockResolveGrokExtendSource: vi.fn(),
  mockMakeOnTaskCreated: vi.fn(),
  mockImageToVideo: vi.fn(),
  mockStitchExtension: vi.fn(),
  mockCreateWorkDir: vi.fn(),
  mockCleanupWorkDir: vi.fn(),
  mockDownloadFile: vi.fn(),
  mockFinalizeJobWithMedia: vi.fn(),
  mockWatermarkLocalVideoAndUpload: vi.fn(),
  mockUploadVideoMaybeWatermark: vi.fn(),
  mockGenerateAndUploadThumbnail: vi.fn(),
  mockProbeMatchedOrThrow: vi.fn(),
  mockRunVeoExtendTask: vi.fn(),
  mockRunRunwayExtendTask: vi.fn(),
  mockRunPixverseExtend: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("@/lib/storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
  uploadToR2: vi.fn(),
  uploadBufferToR2: vi.fn().mockResolvedValue("https://r2.example.com/videos/buf.mp4"),
}))
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: vi.fn() }))
vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({ findChainedMovReference: vi.fn(), cutChainedMovTail: vi.fn(), isMovUrl: () => false }))
vi.mock("@/providers/video/extract-tail.js", () => ({ extractTailToFile: vi.fn() }))
vi.mock("@/providers/video/extract-frame.js", () => ({ extractFrame: vi.fn() }))
vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.mockImageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))
vi.mock("@/providers/video/combine-videos.js", () => ({ combineVideos: vi.fn() }))
// The real `extensionPictureSeconds` / `pictureSecondsOf`; the stitch is mocked (and never called).
vi.mock("@/providers/video/extend-stitch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/extend-stitch.js")>()),
  stitchExtension: mocks.mockStitchExtension,
}))
vi.mock("@/providers/video/matched-encode.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/matched-encode.js")>()),
  probeMatched: vi.fn(),
  // Grok's clip's probe, which throws when ffprobe fails (`extensionPictureSeconds`).
  probeMatchedOrThrow: mocks.mockProbeMatchedOrThrow,
}))
vi.mock("@/providers/kie/grok-extend.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/grok-extend.js")>()),
  runGrokExtend: mocks.mockRunGrokExtend,
}))
vi.mock("@/lib/grok-extend-source.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/grok-extend-source.js")>()),
  resolveGrokExtendSource: mocks.mockResolveGrokExtendSource,
}))
vi.mock("@/lib/reconcile/persistence.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reconcile/persistence.js")>()),
  makeOnTaskCreated: mocks.mockMakeOnTaskCreated,
}))
vi.mock("@/providers/kie/pixverse-extend.js", () => ({ runPixverseExtend: mocks.mockRunPixverseExtend }))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn() }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: mocks.mockCleanupWorkDir,
  createWorkDir: mocks.mockCreateWorkDir,
  downloadFile: mocks.mockDownloadFile,
  stripAudio: vi.fn().mockResolvedValue(undefined),
  probeVideoSource: vi.fn(),
}))
vi.mock("@/providers/kie/client.js", () => ({
  runVeoExtendTask: mocks.mockRunVeoExtendTask,
  runVeo1080pTask: vi.fn(),
  runVeo4kTask: vi.fn(),
  KieError: class KieError extends Error {},
}))
vi.mock("@/providers/kie/runway-client.js", () => ({ runRunwayExtendTask: mocks.mockRunRunwayExtendTask }))
vi.mock("@/providers/kie/video.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/providers/kie/video.js")>()
  return { ...actual, KieVideoProvider: class {} }
})
vi.mock("../../shared.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../shared.js")>()
  return {
    ...actual,
    commitJobCredits: vi.fn().mockResolvedValue(undefined),
    shouldSaveJobResult: vi.fn().mockResolvedValue(true),
    markJobCompleted: vi.fn().mockResolvedValue(true),
    uploadVideoMaybeWatermark: mocks.mockUploadVideoMaybeWatermark,
    watermarkLocalVideoAndUpload: mocks.mockWatermarkLocalVideoAndUpload,
    generateAndUploadThumbnail: mocks.mockGenerateAndUploadThumbnail,
    setJobProgress: vi.fn(async () => {}),
    startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
    withProgressRamp: vi.fn(async (_j: unknown, _i: unknown, _o: unknown, fn: () => Promise<unknown>) => fn()),
  }
})
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.mockFinalizeJobWithMedia }))
vi.mock("@/lib/discard-job-copies.js", () => ({ discardFailedRunCopies: vi.fn().mockResolvedValue(undefined) }))

import { videoAIHandlers } from "../video-ai.js"
import { extensionTooShortMessage } from "../../../lib/extend-recipe.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"
import { GROK_EXTEND_SOURCE_MESSAGE } from "../../../lib/grok-extend-source.js"
import type { MatchedProbe } from "@/providers/video/matched-encode.js"

const GROK_URL = "https://tempfile.kie.example/grok-joined.mp4"
const WORK_DIR = "/tmp/extend-grok-x"
const GROK_PATH = `${WORK_DIR}/grok.mp4`
const R2_URL = "https://r2.example.com/videos/job-1.mp4"
const ON_TASK_CREATED = async () => undefined

/** Grok's output: its render of the source, then the new seconds. */
let grokProbe: MatchedProbe | Error

function makeJob(data: Record<string, unknown> = {}) {
  return {
    name: "extend-video",
    data: {
      jobId: "job-1",
      provider: "grok-extend",
      kieTaskId: "task-grok-src",
      prompt: "the fox turns and runs into the snow",
      duration: 6,
      resolution: "480p",
      sourceSec: 6.041667,
      usageLogId: "usage-1",
      ...data,
    },
    id: "bull-1",
    updateProgress: vi.fn(),
  }
}

const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false }
const run = (data: Record<string, unknown> = {}) => videoAIHandlers["extend-video"]!(makeJob(data) as never, ctx as never)
const failureOf = (data: Record<string, unknown> = {}) => run(data).then(() => undefined, (err: unknown) => err)

/** Grok's output with `seconds` of picture in all. */
const grokWith = (seconds: number | undefined): void => {
  grokProbe = seconds === undefined
    ? { audioCodec: "aac", durationSec: 6 }
    : { width: 854, height: 480, videoCodec: "h264", audioCodec: "aac", durationSec: seconds + 0.02, videoDurationSec: seconds }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.mockCreateWorkDir.mockResolvedValue(WORK_DIR)
  mocks.mockCleanupWorkDir.mockResolvedValue(undefined)
  mocks.mockDownloadFile.mockResolvedValue(undefined)
  mocks.mockMakeOnTaskCreated.mockReturnValue(ON_TASK_CREATED)
  mocks.mockRunGrokExtend.mockResolvedValue({ url: GROK_URL, kieTaskId: "task-grok-ext-1", providerMs: 52_000 })
  mocks.mockWatermarkLocalVideoAndUpload.mockResolvedValue(R2_URL)
  mocks.mockUploadVideoMaybeWatermark.mockResolvedValue(R2_URL)
  mocks.mockGenerateAndUploadThumbnail.mockResolvedValue("https://r2.example.com/images/thumb.png")
  mocks.mockFinalizeJobWithMedia.mockResolvedValue({ ok: true })
  // 6.04 s of the source, then 6.04 s of new footage.
  grokWith(12.083333)
  mocks.mockProbeMatchedOrThrow.mockImplementation(async () => {
    if (grokProbe instanceof Error) throw grokProbe
    return grokProbe
  })
})

describe("grok-extend — what Grok is asked for", () => {
  it("sends the source's task, the prompt as written, the seconds, from the source's exact length, naming its resolution", async () => {
    grokWith(20.083333)
    await run({ prompt: "  keep the lantern swinging  ", duration: 10, resolution: "720p", sourceSec: 10.041667 })
    expect(mocks.mockRunGrokExtend).toHaveBeenCalledTimes(1)
    const [args, reconcileOpts] = mocks.mockRunGrokExtend.mock.calls[0]!
    expect(args).toEqual({ taskId: "task-grok-src", prompt: "  keep the lantern swinging  ", extendAtSec: 10.041667, extendSec: 10 })
    expect(reconcileOpts).toMatchObject({ dimensions: { resolution: "720p" } })
    // Never another extend lane.
    expect(mocks.mockImageToVideo).not.toHaveBeenCalled()
    expect(mocks.mockRunPixverseExtend).not.toHaveBeenCalled()
    expect(mocks.mockRunVeoExtendTask).not.toHaveBeenCalled()
    expect(mocks.mockRunRunwayExtendTask).not.toHaveBeenCalled()
  })

  it("persists its task as the job's, as VEO's extend does (its result is the deliverable)", async () => {
    await run()
    expect(mocks.mockMakeOnTaskCreated).toHaveBeenCalledWith("job-1", "kie-standard")
    expect(mocks.mockRunGrokExtend.mock.calls[0]![1]).toMatchObject({ onTaskCreated: ON_TASK_CREATED })
  })

  it("holds a hand-queued length to 6 or 10 s, its default 6", async () => {
    for (const [sent, seconds] of [[undefined, 6], [6, 6], [10, 10], [8, 6], [15, 10], ["10", 10]] as const) {
      mocks.mockRunGrokExtend.mockClear()
      grokWith(6.041667 + seconds)
      await run({ duration: sent })
      expect(mocks.mockRunGrokExtend.mock.calls[0]![0].extendSec, String(sent)).toBe(seconds)
    }
  })

  it("a job queued without its checked source checks it now, and fails — refunded — on a source Grok cannot extend", async () => {
    mocks.mockResolveGrokExtendSource.mockResolvedValue({ ok: true, sourceSec: 6.08, resolution: "720p", taskId: "task-grok-src" })
    await run({ sourceSec: undefined, resolution: undefined, kieTaskId: " task-grok-src " })
    expect(mocks.mockResolveGrokExtendSource).toHaveBeenCalledWith({ taskId: " task-grok-src ", userId: "user-1" })
    expect(mocks.mockRunGrokExtend.mock.calls[0]![0]).toMatchObject({ taskId: "task-grok-src", extendAtSec: 6.08 })
    expect(mocks.mockRunGrokExtend.mock.calls[0]![1]).toMatchObject({ dimensions: { resolution: "720p" } })

    mocks.mockRunGrokExtend.mockClear()
    mocks.mockResolveGrokExtendSource.mockResolvedValue({ ok: false, code: "grok_extend_source", message: GROK_EXTEND_SOURCE_MESSAGE })
    const err = await failureOf({ sourceSec: undefined })
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(GROK_EXTEND_SOURCE_MESSAGE)
    expect(mocks.mockRunGrokExtend).not.toHaveBeenCalled()
  })
})

describe("grok-extend — the deliverable", () => {
  it("a grok-extend job delivers Grok's output as is", async () => {
    await run()
    // Grok's clip is downloaded once, measured, and stored as it is: no cut, no stitch, no source download.
    expect(mocks.mockDownloadFile).toHaveBeenCalledTimes(1)
    expect(mocks.mockDownloadFile).toHaveBeenCalledWith(GROK_URL, GROK_PATH)
    expect(mocks.mockStitchExtension).not.toHaveBeenCalled()
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(GROK_PATH, "job-1", "user-1", false)
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize).toMatchObject({ jobId: "job-1", jobType: "extend-video", mediaUrl: R2_URL })
    expect(finalize.result).toMatchObject({ url: GROK_URL, cost: null, providerUsed: "grok-extend", kieTaskId: "task-grok-ext-1", providerMs: 52_000 })
    expect(finalize.extraOutputData).toEqual({ thumbnailUrl: "https://r2.example.com/images/thumb.png" })
    // The work folder is removed.
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith(WORK_DIR)
  })

  it("records its own row as a grok-extend run, never as the Grok model it extends", async () => {
    await run()
    const finalize = mocks.mockFinalizeJobWithMedia.mock.calls[0]![0]
    expect(finalize.result.providerUsed).toBe("grok-extend")
    // No task on its output for a node after it to extend: Grok extends only a text- or image-to-video run.
    expect(finalize.extraOutputData).not.toHaveProperty("kieTaskId")
    expect(finalize.extraOutputData).not.toHaveProperty("providerTaskId")
  })

  it("watermarks a free run's output, as every other result", async () => {
    await videoAIHandlers["extend-video"]!(makeJob() as never, { ...ctx, shouldWatermark: true } as never)
    expect(mocks.mockWatermarkLocalVideoAndUpload).toHaveBeenCalledWith(GROK_PATH, "job-1", "user-1", true)
  })
})

describe("grok-extend — a short extension", () => {
  it("fails with a full refund when Grok's new seconds are under half the paid length, before anything is stored", async () => {
    // 6.04 s of source, then 2.0 s new: under half of 6.
    grokWith(8.08)
    const err = await failureOf()
    expect(isDeterministicJobError(err)).toBe(true)
    expect((err as Error).message).toBe(extensionTooShortMessage(8.08 - 6.041667, 6))
    expect((err as Error).message).toBe("The model returned only 2.0s of the 6s extension, so nothing was charged. Try again.")
    expect(mocks.mockWatermarkLocalVideoAndUpload).not.toHaveBeenCalled()
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    expect(mocks.mockCleanupWorkDir).toHaveBeenCalledWith(WORK_DIR)
  })

  it("fails the same way when Grok returns only the source, or a clip with no picture", async () => {
    for (const seconds of [6.041667, 5.9, undefined]) {
      mocks.mockFinalizeJobWithMedia.mockClear()
      grokWith(seconds)
      const err = await failureOf()
      expect(isDeterministicJobError(err), String(seconds)).toBe(true)
      expect((err as Error).message, String(seconds)).toMatch(/^The model returned only 0\.0s of the 6s extension/)
      expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
    }
  })

  it("delivers exactly half the paid length (10 s billed, 5 s new)", async () => {
    grokWith(6.041667 + 5)
    await expect(run({ duration: 10 })).resolves.toBeUndefined()
    expect(mocks.mockFinalizeJobWithMedia).toHaveBeenCalledTimes(1)
  })

  it("a probe of Grok's output that fails is a plain error, retried", async () => {
    grokProbe = Object.assign(new Error("ffprobe failed: timeout"), { timedOut: true })
    const err = await failureOf()
    expect(err).toBeInstanceOf(Error)
    expect(isDeterministicJobError(err)).toBe(false)
    expect(mocks.mockFinalizeJobWithMedia).not.toHaveBeenCalled()
  })
})
