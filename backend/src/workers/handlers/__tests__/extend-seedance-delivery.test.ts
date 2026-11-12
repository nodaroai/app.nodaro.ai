/**
 * The Seedance extend's deliverable, end to end on the worker with real
 * ffmpeg: the real handler, the real extend stitch and the real upload step
 * (`watermarkLocalVideoAndUpload`, its browser-safe check included). Only the
 * generation, the storage writes and the job bookkeeping are stubbed.
 *
 * What it pins: the stitched result is what the upload stores, as it is. A
 * 4:4:4 PCM MOV source (a chained raw clip, the case most unlike a browser's
 * video) is stitched to H.264 4:2:0 AAC in an MP4, which `needsTranscode`
 * passes, so the upload never encodes the picture a second time (it would
 * store `<path>-norm.mp4`, re-encoded at a fixed quality).
 *
 * Skips when ffmpeg is not on PATH, like the stitch's own real-ffmpeg tests.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest"
import { execFileSync } from "node:child_process"
import { copyFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const mocks = vi.hoisted(() => ({
  fixtures: new Map<string, string>(),
  uploaded: [] as Array<{ path: string; transcodeNeeded: boolean; probe: string }>,
  imageToVideo: vi.fn(),
  finalize: vi.fn(),
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn(async () => ({ data: null, error: null })) })),
    })),
  },
}))

vi.mock("@/providers/index.js", () => ({
  imageToVideo: mocks.imageToVideo,
  textToVideo: vi.fn(),
  videoToVideo: vi.fn(),
  lipSync: vi.fn(),
  lipSyncVideo: vi.fn(),
  motionTransfer: vi.fn(),
  videoUpscale: vi.fn(),
  speechToVideo: vi.fn(),
}))

// The upload: what it is handed is recorded with what the browser-safe check
// (`needsTranscode`, the real one) says of it at that moment.
vi.mock("@/lib/storage.js", async () => {
  const { needsTranscode, runFfprobe } = await vi.importActual<typeof import("@/providers/video/ffmpeg-utils.js")>("@/providers/video/ffmpeg-utils.js")
  return {
    uploadFileToR2: vi.fn(async (path: string) => {
      mocks.uploaded.push({
        path,
        transcodeNeeded: await needsTranscode(path),
        probe: (await runFfprobe([
          "-v", "error", "-show_entries", "stream=codec_name,pix_fmt:format_tags=major_brand", "-of", "csv=p=0", path,
        ])).trim(),
      })
      return "https://r2.example.com/videos/job-1.mp4"
    }),
    uploadToR2: vi.fn(async () => "https://r2.example.com/videos/raw.mov"),
    uploadBufferToR2: vi.fn(),
    mediaObjectKey: vi.fn(() => "key"),
  }
})
vi.mock("@/lib/job-scratch.js", () => ({ uploadJobScratchFile: vi.fn(async (_p: string, name: string) => `https://r2.example.com/tmp/${name}.bin`) }))

// The downloads read the local fixtures their URLs name; everything else in
// ffmpeg-utils (the probes, runFfmpeg, the work dirs) is real.
vi.mock("@/providers/video/ffmpeg-utils.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/providers/video/ffmpeg-utils.js")>()),
  downloadFile: vi.fn(async (url: string, dest: string) => {
    const from = mocks.fixtures.get(url)
    if (!from) throw new Error(`no fixture for ${url}`)
    await copyFile(from, dest)
  }),
}))
// The generation inputs (the tail and the last frame) are not what this test is about.
vi.mock("@/providers/video/extract-tail.js", () => ({ extractTailToFile: vi.fn(async (p: string) => `${p}.tail.mp4`) }))
vi.mock("@/providers/video/extract-frame.js", () => ({ extractFrame: vi.fn(async () => ({ imagePath: join(tmpdir(), "extend-delivery-frame-none", "f.png") })) }))
vi.mock("@/providers/video/source-matched-aspect.js", () => ({ resolveSourceMatchedAspect: vi.fn(async () => "adaptive") }))
vi.mock("@/lib/seedance-extend-mov-chain.js", () => ({ findChainedMovReference: vi.fn(async () => undefined), isMovUrl: vi.fn(() => false) }))
vi.mock("@/lib/job-finalize.js", () => ({ finalizeJobWithMedia: mocks.finalize }))

vi.mock("@/workers/shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/workers/shared.js")>()),
  // The real watermarkLocalVideoAndUpload runs; the bookkeeping around it does not.
  generateAndUploadThumbnail: vi.fn(async () => null),
  setJobProgress: vi.fn(async () => {}),
  startProgressRamp: vi.fn(() => ({ stop: vi.fn() })),
}))

import { videoAIHandlers } from "@/workers/handlers/video-ai.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const SOURCE_URL = "https://r2.example.com/videos/source-444.mov"
const EXTENSION_URL = "https://kie.example.com/extension.mp4"

describe.skipIf(!isFfmpegAvailable())("the Seedance extend's deliverable (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "extend-delivery-test-"))
    const source = join(dir, "source-444.mov")
    const extension = join(dir, "extension.mp4")
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2.5",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2.5:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-b:v", "300k", "-c:a", "pcm_s16le", "-shortest",
      source,
    ])
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=2:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      extension,
    ])
    mocks.fixtures.set(SOURCE_URL, source)
    mocks.fixtures.set(EXTENSION_URL, extension)
  }, 60_000)

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  beforeEach(() => {
    mocks.uploaded.length = 0
    mocks.imageToVideo.mockResolvedValue({ url: EXTENSION_URL, cost: 0.1, providerUsed: "kie" })
    mocks.finalize.mockResolvedValue({ ok: true })
  })

  it("uploads the stitched result as it is: no second encode of a 4:4:4 PCM MOV source", async () => {
    await videoAIHandlers["extend-video"]!(
      {
        name: "extend-video",
        data: { jobId: "job-1", provider: "seedance-2-0-extend", video: SOURCE_URL, prompt: "keep going" },
        id: "b1",
        updateProgress: vi.fn(async () => {}),
      } as never,
      { jobId: "job-1", jobUserId: "user-1", usageLogId: "usage-1", shouldWatermark: false } as never,
    )

    expect(mocks.uploaded).toHaveLength(1)
    const [upload] = mocks.uploaded
    // The stitch's own file, not a browser-safe re-encode of it.
    expect(upload!.path).toMatch(/[\\/]stitched\.mp4$/)
    expect(upload!.transcodeNeeded).toBe(false)
    // H.264 4:2:0 and AAC, in an MP4 (major brand isom, never qt).
    expect(upload!.probe.split("\n")).toEqual(["h264,yuv420p", "aac", "isom"])
    expect(mocks.finalize).toHaveBeenCalledWith(expect.objectContaining({ mediaUrl: "https://r2.example.com/videos/job-1.mp4" }))
  }, 120_000)
})
