/**
 * merge-video-audio.ts tests — focused on the audio filter_complex shape.
 *
 * ffmpeg-utils + post-processing-error are mocked at the module boundary so we
 * can assert the generated filter string per option (the interesting logic).
 * The default (no sumTracks) MUST stay byte-identical for back-compat with the
 * combine-videos / merge-video-audio node / voice-changer callers.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn().mockResolvedValue(undefined),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  needsTranscode: vi.fn().mockResolvedValue(false),
  createWorkDir: vi.fn().mockResolvedValue("/tmp/work"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  needsTranscode: mocks.needsTranscode,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  BROWSER_SAFE_VIDEO_ARGS: ["-c:v", "libx264"],
}))

vi.mock("../../../lib/post-processing-error.js", () => ({
  runPostProcessing: (fn: () => unknown) => fn(),
}))

import { mergeVideoAudio } from "../merge-video-audio.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.needsTranscode.mockResolvedValue(false)
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
})

/** filter_complex string of the Nth runFfmpeg call. */
function filterOf(call = 0): string {
  const args = mocks.runFfmpeg.mock.calls[call][0] as string[]
  const idx = args.indexOf("-filter_complex")
  return args[idx + 1] as string
}

describe("mergeVideoAudio sumTracks", () => {
  const twoTracks = [
    { url: "https://r2/v0.mp3", startTime: 0, volume: 100, sourceType: "audio" as const },
    { url: "https://r2/v1.mp3", startTime: 0, volume: 100, sourceType: "audio" as const },
  ]

  it("does NOT add normalize=0 by default (back-compat amix average)", async () => {
    await mergeVideoAudio({ videoUrl: "https://r2/v.mp4", audioTracks: twoTracks })
    const f = filterOf()
    expect(f).toContain("amix=inputs=2:duration=longest[aout]")
    expect(f).not.toContain("normalize=0")
  })

  it("sumTracks:true adds normalize=0 + a brickwall limiter to the multi-track amix", async () => {
    await mergeVideoAudio({ videoUrl: "https://r2/v.mp4", audioTracks: twoTracks, sumTracks: true })
    const f = filterOf()
    expect(f).toContain("amix=inputs=2:duration=longest:normalize=0")
    expect(f).toContain("alimiter=level=disabled:limit=0.95")
  })

  it("sumTracks:true adds normalize=0 when keepOriginalAudio includes the original", async () => {
    await mergeVideoAudio({
      videoUrl: "https://r2/v.mp4",
      audioTracks: twoTracks,
      keepOriginalAudio: true,
    })
    // includeOriginal path: inputs = tracks + 1 (original).
    const f = filterOf()
    expect(f).toContain("[orig]")
    expect(f).not.toContain("normalize=0")

    mocks.runFfmpeg.mockClear()
    await mergeVideoAudio({
      videoUrl: "https://r2/v.mp4",
      audioTracks: twoTracks,
      keepOriginalAudio: true,
      sumTracks: true,
    })
    const f3 = filterOf()
    expect(f3).toContain("amix=inputs=3:duration=longest:normalize=0")
    expect(f3).toContain("alimiter=level=disabled:limit=0.95")
  })

  it("single track never uses amix, so sumTracks has no effect (lone track keeps level)", async () => {
    const oneTrack = [{ url: "https://r2/v0.mp3", startTime: 0, volume: 100, sourceType: "audio" as const }]
    await mergeVideoAudio({ videoUrl: "https://r2/v.mp4", audioTracks: oneTrack, sumTracks: true })
    const f = filterOf()
    expect(f).not.toContain("amix")
    expect(f).not.toContain("normalize=0")
    expect(f).toContain("[aout]")
  })
})
