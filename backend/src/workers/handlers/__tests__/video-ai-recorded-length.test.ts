import { describe, it, expect, vi, beforeEach } from "vitest"
import { VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedOutputDurationSec } from "@nodaro/shared/models"

/**
 * Every lane that completes a video generation job records a length-following
 * run's real length the same way: `output_data.durationSec` = min(the
 * delivered video's measured length, the run's upper bound), through the REAL
 * finalize funnel (`finalizeJobWithMedia`). The lane hands finalize the
 * settlement's own measurement when the stored video is the measured take
 * (one probe, never two), and finalize probes the stored file when a
 * post-process changed it (a loop cut, an audio merge, a voice mux).
 *
 * Lanes: the image-to-video and text-to-video workers (Generate Video and the
 * older nodes, the Video to Video node's Seedance lane, `/v1/generate-video`,
 * `/v1/text-to-video`), the voiced lane (Generate Video with a voice), and the
 * reconcile cron's KIE recovery (also the stall re-pick's inline reconcile).
 */

const db = vi.hoisted(() => ({ row: {} as Record<string, unknown> }))
const m = vi.hoisted(() => ({
  imageToVideo: vi.fn(),
  textToVideo: vi.fn(),
  settle: vi.fn(),
  probe: vi.fn(async (_url: string): Promise<number> => 0),
  completed: vi.fn(async (_id: string, _fields: Record<string, unknown>) => "completed" as const),
  loopCut: vi.fn(),
  pollKieTask: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => {
  const chain = (data: unknown) => {
    const c: Record<string, unknown> = {}
    for (const k of ["select", "eq", "update", "in", "is", "order", "limit"]) c[k] = () => c
    c.single = async () => ({ data, error: null })
    c.maybeSingle = async () => ({ data, error: null })
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: [{ id: "log-1" }], error: null })
    return c
  }
  return {
    supabase: {
      from: (table: string) => chain(table === "jobs" ? db.row : null),
      rpc: async () => ({ data: "2026-11-11T10:00:00+00:00", error: null }),
    },
  }
})
vi.mock("@/lib/storage.js", () => ({
  uploadToR2: vi.fn(async () => "https://r2.example.com/videos/job-1-raw.mp4"),
  uploadBufferToR2: vi.fn(),
}))
vi.mock("@/providers/index.js", () => ({
  imageToVideo: m.imageToVideo,
  textToVideo: m.textToVideo,
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
}))
vi.mock("@/providers/video/merge-video-audio.js", () => ({ mergeVideoAudio: vi.fn(async () => "/tmp/merge/merged.mp4") }))
vi.mock("@/providers/video/apply-smart-loop-cut.js", () => ({ applySmartLoopCutToR2Url: m.loopCut }))
vi.mock("@/providers/video/ffmpeg-utils.js", () => ({
  cleanupWorkDir: vi.fn(async () => undefined),
  createWorkDir: vi.fn(async () => "/tmp/workdir"),
  downloadFile: vi.fn(async () => undefined),
  stripAudio: vi.fn(async () => undefined),
  probeMediaDuration: m.probe,
}))
vi.mock("@/lib/seedance2-ref-video-settle.js", () => ({ measureSeedance2Settle: m.settle }))
vi.mock("@/lib/seedance-draft-finalize.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seedance-draft-finalize.js")>()),
  measureSeedanceDraftRenderSec: async () => undefined,
}))
vi.mock("@/lib/character-auto-attach.js", () => ({ appendCharacterReferenceVideo: vi.fn() }))
vi.mock("@/lib/gpt-image-2-6-settle.js", () => ({ gptImage26AutoSettledBase: async () => undefined }))
vi.mock("@/lib/voice-gender.js", () => ({ judgeVoices: vi.fn(async () => []) }))
vi.mock("@/providers/kie/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/kie/client.js")>()),
  pollKieTask: m.pollKieTask,
}))
vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workers/shared.js")>()),
  uploadVideoMaybeWatermark: vi.fn(async () => "https://r2.example.com/videos/job-1.mp4"),
  watermarkLocalVideoAndUpload: vi.fn(async () => "https://r2.example.com/videos/job-1-merged.mp4"),
  generateAndUploadThumbnail: vi.fn(async () => "https://r2.example.com/thumbnails/job-1.png"),
  setJobProgress: vi.fn(async () => undefined),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
  markJobCompletedDetailed: m.completed,
  commitJobCredits: vi.fn(async () => undefined),
  refundLoopTrimAddon: vi.fn(async () => undefined),
  createAssetFromJob: vi.fn(async () => undefined),
}))

import { videoAIHandlers } from "../video-ai.js"
import { reconcileKieJob } from "@/lib/reconcile/kie.js"

const RAW = "https://kie.example/out.mp4"
const ctx = { jobId: "job-1", jobUserId: "user-1", usageLogId: "log-1", shouldWatermark: false }
const S25 = "seedance-2-5"
const AUTO_25 = pricedOutputDurationSec(S25, VIDEO_DURATION_AUTO)

/** The job's row (what finalize reads) and its queue payload (what the handler reads): one request. */
function job(rowType: string, queueName: string, request: Record<string, unknown>) {
  db.row = { id: "job-1", user_id: "user-1", should_watermark: false, is_public: true, job_type: rowType, workflow_execution_id: null, status: "processing", input_data: request }
  return { name: queueName, data: { jobId: "job-1", ...request }, id: "bull-1", updateProgress: vi.fn() } as never
}
/** The settlement measured the raw take at `sec` (its credits are not this test's). */
const measuredAt = (sec: number) => m.settle.mockResolvedValue({ baseCredits: undefined, seconds: { outputSec: Math.ceil(sec), inputSec: 0 }, deliveredSec: sec })
const recorded = () => (m.completed.mock.calls.at(-1)?.[1] as { output_data: Record<string, unknown> }).output_data

beforeEach(() => {
  vi.clearAllMocks()
  m.imageToVideo.mockResolvedValue({ url: RAW, providerUsed: S25, cost: null })
  m.textToVideo.mockResolvedValue({ url: RAW, providerUsed: S25, cost: null })
  m.settle.mockResolvedValue({ baseCredits: undefined, seconds: undefined })
  m.probe.mockResolvedValue(11.61)
})

describe("the image-to-video lane", () => {
  const handler = videoAIHandlers["image-to-video"]!
  const request = { imageUrl: "https://x.png", provider: S25, duration: VIDEO_DURATION_AUTO, resolution: "720p" }

  it("records the settlement's measurement of the take, at most the bound; no second probe", async () => {
    measuredAt(17.52)
    await handler(job("image-to-video", "image-to-video", request), ctx as never)
    expect(recorded().durationSec).toBe(17.52)
    expect(m.probe).not.toHaveBeenCalled()
    measuredAt(30.04)
    await handler(job("image-to-video", "image-to-video", request), ctx as never)
    expect(recorded().durationSec).toBe(AUTO_25)
  })

  it("a loop cut changed the stored file: its own length is probed and recorded", async () => {
    measuredAt(17.52)
    m.loopCut.mockResolvedValue("https://r2.example.com/videos/looped.mp4")
    m.probe.mockResolvedValue(14.6)
    await handler(job("image-to-video", "image-to-video", { ...request, loopTrim: { enabled: true, framesToTest: 16 } }), ctx as never)
    expect(recorded().durationSec).toBe(14.6)
    expect(m.probe).toHaveBeenCalledTimes(1)
    expect(m.probe).toHaveBeenCalledWith("https://r2.example.com/videos/job-1.mp4", { timeoutMs: 5_000 })
  })

  it("nothing measured (an edition with no credits): the stored file is probed once", async () => {
    await handler(job("image-to-video", "image-to-video", request), ctx as never)
    expect(recorded().durationSec).toBe(11.61)
    expect(m.probe).toHaveBeenCalledTimes(1)
  })

  it("a fixed-length run records nothing and is never probed", async () => {
    measuredAt(5.04)
    await handler(job("image-to-video", "image-to-video", { ...request, duration: 5 }), ctx as never)
    expect(recorded()).not.toHaveProperty("durationSec")
    expect(m.probe).not.toHaveBeenCalled()
  })
})

describe("the text-to-video lane (and the Video to Video node's Seedance edit)", () => {
  const handler = videoAIHandlers["text-to-video"]!

  it("a declared Edit: the take's measurement, at most the bound", async () => {
    measuredAt(24.3)
    const edit = { prompt: "edit @video_1", provider: S25, duration: VIDEO_DURATION_AUTO, aspectRatio: "adaptive", referenceVideoUrls: ["https://r2.example.com/videos/clip.mp4"], referenceTaskType: "edit" }
    await handler(job("text-to-video", "text-to-video", edit), ctx as never)
    expect(recorded().durationSec).toBe(24.3)
    expect(m.probe).not.toHaveBeenCalled()
  })

  it("a declared Extend at 8 s: a few hundredths over records 8", async () => {
    measuredAt(8.04)
    const extend = { prompt: "go on", provider: S25, duration: 8, aspectRatio: "adaptive", referenceVideoUrls: ["https://r2.example.com/videos/clip.mp4"], referenceTaskType: "extend" }
    await handler(job("text-to-video", "text-to-video", extend), ctx as never)
    expect(recorded().durationSec).toBe(8)
  })
})

describe("the voiced lane (Generate Video with a voice)", () => {
  const handler = videoAIHandlers["voiced-video"]!

  it("no voice muxed onto the take: the settlement's measurement", async () => {
    measuredAt(9.87)
    await handler(job("voiced-video", "voiced-video", { imageUrl: "https://x.png", prompt: "hi", provider: S25, duration: VIDEO_DURATION_AUTO }), ctx as never)
    expect(recorded().durationSec).toBe(9.87)
    expect(m.probe).not.toHaveBeenCalled()
  })
})

describe("the reconcile cron's KIE recovery", () => {
  it("a recovered Seedance 2.5 Auto run records the recovered clip's measurement, as the worker would", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultUrls: [RAW] }, providerMs: 1000, taskId: "t-1" })
    measuredAt(12.48)
    const request = { provider: S25, duration: VIDEO_DURATION_AUTO, resolution: "720p" }
    job("image-to-video", "image-to-video", request)
    await reconcileKieJob({ id: "job-1", provider_kind: "kie-standard", provider_task_id: "t-1", reconcile_attempts: 0, job_type: "image-to-video", input_data: request })
    expect(recorded().durationSec).toBe(12.48)
    expect(m.probe).not.toHaveBeenCalled()
  })

  it("a recovered fixed-length run records nothing", async () => {
    m.pollKieTask.mockResolvedValue({ resultJson: { resultUrls: [RAW] }, providerMs: 1000, taskId: "t-1" })
    measuredAt(5.04)
    const request = { provider: S25, duration: 5, resolution: "720p" }
    job("text-to-video", "text-to-video", request)
    await reconcileKieJob({ id: "job-1", provider_kind: "kie-standard", provider_task_id: "t-1", reconcile_attempts: 0, job_type: "text-to-video", input_data: request })
    expect(recorded()).not.toHaveProperty("durationSec")
    expect(m.probe).not.toHaveBeenCalled()
  })
})
