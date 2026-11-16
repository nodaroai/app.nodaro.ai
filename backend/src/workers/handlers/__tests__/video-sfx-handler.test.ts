/**
 * The Video SFX handler sends the model the file its cap cut (`capVideoSfxSource`,
 * run for real here): a run asked for the 300-second cap whose clip measures
 * 300.03 s sends the cut copy, and any other run sends its link as it is.
 * Only the I/O is mocked: the jobs row, the probe, ffmpeg, the scratch upload,
 * the provider call and the finalize.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({
  inputData: {} as Record<string, unknown>,
  probeClipLengthSec: vi.fn(async (_src: string, _opts?: unknown) => 300.03),
  generateVideoSfx: vi.fn(async (_req: { videoUrl: string; duration: number }, _opts?: unknown) => ({ outputUrl: "https://replicate.example/out.mp4", predictionId: "p1", predictTime: 1 })),
  uploadJobScratchFile: vi.fn(async (_path: string, _name: string, ext: string) => `https://cdn.example.com/jobs/scratch/cut.${ext}`),
  runFfmpeg: vi.fn(async (_args: string[]) => ""),
}))

vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { input_data: m.inputData }, error: null }) }) }) }),
  },
}))
vi.mock("../../../providers/replicate/sfx.js", () => ({ generateVideoSfx: m.generateVideoSfx }))
vi.mock("../../../lib/reconcile/persistence.js", () => ({ makeOnTaskCreated: () => async () => {} }))
vi.mock("../../shared.js", () => ({
  buildProviderMeta: () => ({}),
  generateAndUploadThumbnail: async () => "https://cdn.example.com/thumb.jpg",
  setJobProgress: async () => {},
  uploadVideoMaybeWatermark: async () => "https://cdn.example.com/out.mp4",
  withProgressRamp: async (_job: unknown, _jobId: string, _ramp: unknown, fn: () => Promise<unknown>) => fn(),
}))
vi.mock("../../../lib/job-finalize.js", () => ({ finalizeJobWithMedia: async () => ({ ok: true }) }))
// The cap's own I/O.
vi.mock("../../../lib/video-utility-probe.js", () => ({ probeClipLengthSec: m.probeClipLengthSec }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  BIG_MEDIA_DOWNLOAD_LIMITS: {},
  createWorkDir: async () => "/tmp/video-sfx-handler-test",
  cleanupWorkDir: async () => {},
  downloadFile: async () => {},
  runFfmpeg: m.runFfmpeg,
}))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: m.uploadJobScratchFile }))

import { videoSfxHandlers } from "../video-sfx.js"

const SOURCE = "https://cdn.example.com/u/clip.mp4"
const handler = videoSfxHandlers["video-sfx"]!
const run = () => handler({ id: "b1", data: {}, updateProgress: vi.fn() } as never, { jobId: "job-1", jobUserId: "user-1", usageLogId: "u1", shouldWatermark: false } as never)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "log").mockImplementation(() => {})
  vi.spyOn(console, "error").mockImplementation(() => {})
})

describe("the Video SFX handler sends the file its cap cut", () => {
  it("a run at the 300 s cap whose clip measures 300.03 s sends the cut copy, asked to score 300 s", async () => {
    m.inputData = { videoUrl: SOURCE, cfgStrength: 4.5, numSteps: 25, duration_seconds: 300 }
    await run()
    expect(m.runFfmpeg).toHaveBeenCalledTimes(1)
    const [req] = m.generateVideoSfx.mock.calls[0]!
    expect(req.videoUrl).toBe("https://cdn.example.com/jobs/scratch/cut.mp4")
    expect(req.duration).toBe(300)
  })

  it("a run under the cap sends its link as it is, unmeasured", async () => {
    m.inputData = { videoUrl: SOURCE, cfgStrength: 4.5, numSteps: 25, duration_seconds: 30 }
    await run()
    expect(m.probeClipLengthSec).not.toHaveBeenCalled()
    expect(m.generateVideoSfx.mock.calls[0]![0].videoUrl).toBe(SOURCE)
  })
})
