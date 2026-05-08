/**
 * Video wrapper tests — batch 2.
 *
 * Seven more FFmpeg wrappers in providers/video/, plus the smart-loop-cut
 * R2 wrapper. Same shape as batch 1 (createWorkDir → downloadFile → ffmpeg
 * → cleanupWorkDir on error) with per-file branching:
 *
 * - apply-smart-loop-cut.ts → smartLoopCut + R2 upload + cleanup-dir
 * - combine-audio.ts        → trim-then-concat with WAV intermediate
 * - add-captions.ts         → drawtext filter with text-escape + position
 * - social-media-format.ts  → image vs video output, crop/pad/stretch
 * - speed-ramp.ts           → speed clamp [0.25, 4.0], atempo chain
 * - split-media.ts          → segment-based chunking, video + audio
 * - merge-video-audio.ts    → audioTracks vs single audioUrl, adelay
 *                              chain, codec probe, keepOriginalAudio fallback
 *
 * Mocks ffmpeg-utils, node:fs/promises, node:fs, node:child_process at
 * module boundaries.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const downloadFile = vi.fn().mockResolvedValue(undefined)
  const runFfmpeg = vi.fn().mockResolvedValue("")
  // runFfprobe returns Promise<string> (stdout from execFile). merge-video-audio
  // uses it to detect VP8/VP9 inputs that need re-encoding to H.264 for MP4 mux.
  const runFfprobe = vi.fn().mockResolvedValue("h264")
  const createWorkDir = vi.fn().mockResolvedValue("/tmp/work")
  const cleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const fsWriteFile = vi.fn().mockResolvedValue(undefined)
  const fsReaddirSync = vi.fn(() => [] as string[])
  // execSync is mocked at the node:child_process boundary in case other
  // wrappers reach for it; merge-video-audio no longer uses it directly.
  const execSync = vi.fn(() => "h264")
  const uploadFileToR2 = vi.fn()
  const smartLoopCut = vi.fn()
  return {
    downloadFile, runFfmpeg, runFfprobe, createWorkDir, cleanupWorkDir,
    fsWriteFile, fsReaddirSync, execSync,
    uploadFileToR2, smartLoopCut,
  }
})

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

vi.mock("node:fs/promises", () => ({
  writeFile: mocks.fsWriteFile,
}))

vi.mock("node:fs", () => ({
  readdirSync: mocks.fsReaddirSync,
}))

vi.mock("node:child_process", () => ({
  execSync: mocks.execSync,
}))

vi.mock("@/lib/storage.js", () => ({
  uploadFileToR2: mocks.uploadFileToR2,
}))

vi.mock("../smart-loop-cut.js", () => ({
  smartLoopCut: mocks.smartLoopCut,
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", NODE_ENV: "test" },
  hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
  isBusiness: () => false, hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports under test (after mocks)
// ---------------------------------------------------------------------------

import { applySmartLoopCutToR2Url } from "../apply-smart-loop-cut.js"
import { combineAudio } from "../combine-audio.js"
import { addCaptions } from "../add-captions.js"
import { socialMediaFormat } from "../social-media-format.js"
import { speedRamp } from "../speed-ramp.js"
import { splitMedia } from "../split-media.js"
import { mergeVideoAudio } from "../merge-video-audio.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.runFfprobe.mockResolvedValue("h264")
  mocks.fsWriteFile.mockResolvedValue(undefined)
  mocks.fsReaddirSync.mockReturnValue([])
  mocks.execSync.mockReturnValue("h264")
  mocks.uploadFileToR2.mockResolvedValue("https://r2/result.mp4")
  mocks.smartLoopCut.mockResolvedValue({
    videoPath: "/tmp/work-slc/cut.mp4",
    chosenFrameIndex: 100,
    psnr: 32,
    sourceFrameCount: 240,
    fps: 24,
  })
})

/** Get the args of the Nth runFfmpeg call. */
function ffargs(index = 0): string[] {
  return mocks.runFfmpeg.mock.calls[index][0] as string[]
}

// ===========================================================================
// 1) apply-smart-loop-cut.ts
// ===========================================================================

describe("applySmartLoopCutToR2Url", () => {
  it("runs smartLoopCut, uploads result to R2, cleans up the work dir", async () => {
    mocks.smartLoopCut.mockResolvedValueOnce({
      videoPath: "/tmp/slc-work/cut.mp4",
      chosenFrameIndex: 50, psnr: 33, sourceFrameCount: 100, fps: 24,
    })
    mocks.uploadFileToR2.mockResolvedValueOnce("https://r2/job-1-loop-cut.mp4")

    const url = await applySmartLoopCutToR2Url(
      "https://r2/in.mp4", "job-1", "user-7", { lookbackFrames: 16 },
    )

    expect(url).toBe("https://r2/job-1-loop-cut.mp4")
    expect(mocks.smartLoopCut).toHaveBeenCalledWith({
      videoUrl: "https://r2/in.mp4",
      lookbackFrames: 16,
    })
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith(
      "/tmp/slc-work/cut.mp4", "job-1-loop-cut", "video", "user-7",
    )
    // Cleanup uses the parent dir of the smart-cut output
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/slc-work")
  })

  it("forwards undefined userId without coercing to string", async () => {
    await applySmartLoopCutToR2Url("u", "j", undefined, {})
    expect(mocks.uploadFileToR2).toHaveBeenCalledWith(
      expect.any(String), "j-loop-cut", "video", undefined,
    )
  })

  it("still cleans up work dir if upload fails (finally block)", async () => {
    mocks.uploadFileToR2.mockRejectedValueOnce(new Error("R2 down"))

    await expect(
      applySmartLoopCutToR2Url("u", "j", undefined, {}),
    ).rejects.toThrow(/R2 down/)
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })

  it("propagates smartLoopCut errors without uploading or cleaning", async () => {
    mocks.smartLoopCut.mockRejectedValueOnce(new Error("psnr too low"))

    await expect(
      applySmartLoopCutToR2Url("u", "j", undefined, {}),
    ).rejects.toThrow(/psnr too low/)
    expect(mocks.uploadFileToR2).not.toHaveBeenCalled()
    expect(mocks.cleanupWorkDir).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 2) combine-audio.ts
// ===========================================================================

describe("combineAudio", () => {
  it("throws when segments array is empty", async () => {
    await expect(combineAudio({ segments: [] })).rejects.toThrow(
      /No audio segments/,
    )
  })

  it("downloads and trims each segment to WAV pcm_s16le @ 44.1kHz stereo", async () => {
    await combineAudio({
      segments: [{ url: "https://r2/a.mp3" }, { url: "https://r2/b.mp3" }],
    })

    expect(mocks.downloadFile).toHaveBeenCalledTimes(2)

    // Each segment gets its own ffmpeg trim call (plus one final concat).
    // First trim call:
    const trimArgs = ffargs(0)
    expect(trimArgs).toContain("-acodec")
    expect(trimArgs[trimArgs.indexOf("-acodec") + 1]).toBe("pcm_s16le")
    expect(trimArgs).toContain("-ar")
    expect(trimArgs[trimArgs.indexOf("-ar") + 1]).toBe("44100")
    expect(trimArgs).toContain("-ac")
    expect(trimArgs[trimArgs.indexOf("-ac") + 1]).toBe("2")
  })

  it("detects .wav extension; defaults to mp3", async () => {
    await combineAudio({
      segments: [{ url: "https://r2/song.wav" }, { url: "https://r2/clip.mp3" }],
    })

    const calls = mocks.downloadFile.mock.calls
    expect(calls[0][1]).toMatch(/raw_0\.wav$/)
    expect(calls[1][1]).toMatch(/raw_1\.mp3$/)
  })

  it("forwards startTime/endTime as -ss / -to flags", async () => {
    await combineAudio({
      segments: [{ url: "https://r2/a.mp3", startTime: 1.5, endTime: 4 }],
    })

    const args = ffargs(0)
    expect(args).toContain("-ss")
    expect(args[args.indexOf("-ss") + 1]).toBe("1.5")
    expect(args).toContain("-to")
    expect(args[args.indexOf("-to") + 1]).toBe("4")
  })

  it("does NOT add -ss when startTime is 0 or unset", async () => {
    await combineAudio({
      segments: [{ url: "https://r2/a.mp3", startTime: 0 }],
    })
    expect(ffargs(0)).not.toContain("-ss")
  })

  it("writes a concat list with one 'file <path>' per segment", async () => {
    await combineAudio({
      segments: [{ url: "a.mp3" }, { url: "b.mp3" }, { url: "c.mp3" }],
    })

    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(written.split("\n")).toHaveLength(3)
    expect(written).toMatch(/file '\/tmp\/work\/seg_0\.wav'/)
  })

  it("encodes final output as MP3 with -q:a 2 (VBR high)", async () => {
    await combineAudio({ segments: [{ url: "a.mp3" }] })

    const finalArgs = ffargs(1) // 0 = trim, 1 = concat
    expect(finalArgs).toContain("-c:a")
    expect(finalArgs[finalArgs.indexOf("-c:a") + 1]).toBe("libmp3lame")
    expect(finalArgs).toContain("-q:a")
    expect(finalArgs[finalArgs.indexOf("-q:a") + 1]).toBe("2")
  })

  it("returns the output path", async () => {
    const out = await combineAudio({ segments: [{ url: "a.mp3" }] })
    expect(out).toBe("/tmp/work/output.mp3")
  })
})

// ===========================================================================
// 3) add-captions.ts
// ===========================================================================

describe("addCaptions", () => {
  it("emits a drawtext filter with the caption text", async () => {
    await addCaptions({ videoUrl: "u", text: "Hello world" })

    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("drawtext=text='Hello world'")
  })

  it("escapes colons in text (FFmpeg drawtext metacharacter)", async () => {
    await addCaptions({ videoUrl: "u", text: "Time: 12:34" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("Time\\: 12\\:34")
  })

  it("substitutes typographic apostrophe for straight quote (delimits filter)", async () => {
    await addCaptions({ videoUrl: "u", text: "Don't stop" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    // Straight quote replaced with U+2019; the filter is single-quoted so
    // an unescaped quote would terminate the string early.
    expect(vf).toContain("Don’t stop")
    expect(vf).not.toContain("Don't")
  })

  it("converts newlines to FFmpeg \\n escape", async () => {
    await addCaptions({ videoUrl: "u", text: "line1\nline2" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("line1\\nline2")
  })

  it("default position bottom uses h-th-40 y coordinate", async () => {
    await addCaptions({ videoUrl: "u", text: "x" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("y=h-th-40")
  })

  it("position top uses y=40", async () => {
    await addCaptions({ videoUrl: "u", text: "x", position: "top" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("y=40")
  })

  it("position center uses (h-th)/2", async () => {
    await addCaptions({ videoUrl: "u", text: "x", position: "center" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("y=(h-th)/2")
  })

  it("converts # color to 0x for FFmpeg", async () => {
    await addCaptions({ videoUrl: "u", text: "x", color: "#FF00FF" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("fontcolor=0xFF00FF")
  })

  it("default color #FFFFFF → 0xFFFFFF", async () => {
    await addCaptions({ videoUrl: "u", text: "x" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("fontcolor=0xFFFFFF")
  })

  it("style 'word-highlight' adds box=1 with semi-transparent background", async () => {
    await addCaptions({ videoUrl: "u", text: "x", style: "word-highlight" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("box=1")
    expect(vf).toContain("boxcolor=black@0.7")
  })

  it("style 'karaoke' also adds box=1", async () => {
    await addCaptions({ videoUrl: "u", text: "x", style: "karaoke" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("box=1")
  })

  it("style 'subtitle' (default) does NOT add box opts", async () => {
    await addCaptions({ videoUrl: "u", text: "x" })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).not.toContain("box=1")
  })

  it("respects custom fontSize", async () => {
    await addCaptions({ videoUrl: "u", text: "x", fontSize: 48 })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("fontsize=48")
  })

  it("stream-copies audio (-c:a copy)", async () => {
    await addCaptions({ videoUrl: "u", text: "x" })
    const args = ffargs()
    expect(args[args.indexOf("-c:a") + 1]).toBe("copy")
  })
})

// ===========================================================================
// 4) social-media-format.ts
// ===========================================================================

describe("socialMediaFormat", () => {
  it("image mode: outputs JPG with -q:v 2 (no codec args)", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "image",
      width: 1080, height: 1080, method: "stretch",
    })

    const args = ffargs()
    expect(args).toContain("-q:v")
    expect(args).not.toContain("libx264")
    expect(args[args.length - 1]).toMatch(/output\.jpg$/)
  })

  it("video mode: encodes h264/yuv420p/30fps with AAC + faststart", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "video",
      width: 1080, height: 1920, method: "stretch",
    })

    const args = ffargs()
    expect(args).toContain("libx264")
    expect(args).toContain("yuv420p")
    expect(args).toContain("aac")
    expect(args).toContain("+faststart")
    expect(args[args.indexOf("-r") + 1]).toBe("30")
  })

  it("crop method uses force_original_aspect_ratio=increase + crop", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "video",
      width: 1080, height: 1920, method: "crop",
    })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("force_original_aspect_ratio=increase")
    expect(vf).toContain("crop=1080:1920")
  })

  it("pad method uses force_original_aspect_ratio=decrease + colored pad", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "video",
      width: 1080, height: 1080, method: "pad", padColor: "#FFFFFF",
    })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("force_original_aspect_ratio=decrease")
    expect(vf).toContain("color=0xFFFFFF")
  })

  it("default padColor is #000000 → 0x000000", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "video",
      width: 1080, height: 1080, method: "pad",
    })
    const vf = ffargs()[ffargs().indexOf("-vf") + 1]
    expect(vf).toContain("color=0x000000")
  })

  it("downloads to .png for image, .mp4 for video", async () => {
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "image",
      width: 1, height: 1, method: "stretch",
    })
    expect(mocks.downloadFile.mock.calls[0][1]).toMatch(/input\.png$/)

    mocks.downloadFile.mockClear()
    await socialMediaFormat({
      mediaUrl: "u", mediaType: "video",
      width: 1, height: 1, method: "stretch",
    })
    expect(mocks.downloadFile.mock.calls[0][1]).toMatch(/input\.mp4$/)
  })
})

// ===========================================================================
// 5) speed-ramp.ts
// ===========================================================================

describe("speedRamp", () => {
  it("uses setpts=PTS/speed for video filter", async () => {
    await speedRamp({ videoUrl: "u", speed: 2, adjustAudio: false })
    const args = ffargs()
    const idx = args.indexOf("-filter:v")
    expect(args[idx + 1]).toBe("setpts=PTS/2")
  })

  it("clamps speed to [0.25, 4.0]: 0.1 → 0.25", async () => {
    await speedRamp({ videoUrl: "u", speed: 0.1, adjustAudio: false })
    const args = ffargs()
    expect(args[args.indexOf("-filter:v") + 1]).toBe("setpts=PTS/0.25")
  })

  it("clamps speed to [0.25, 4.0]: 100 → 4", async () => {
    await speedRamp({ videoUrl: "u", speed: 100, adjustAudio: false })
    const args = ffargs()
    expect(args[args.indexOf("-filter:v") + 1]).toBe("setpts=PTS/4")
  })

  it("adjustAudio false: drops audio with -an", async () => {
    await speedRamp({ videoUrl: "u", speed: 2, adjustAudio: false })
    const args = ffargs()
    expect(args).toContain("-an")
    expect(args).not.toContain("-filter:a")
  })

  it("adjustAudio true: chains atempo filters when needed", async () => {
    // 0.25 (after clamp) → atempo=0.5, atempo=0.5 (chain to land at 0.25)
    await speedRamp({ videoUrl: "u", speed: 0.25, adjustAudio: true })
    const args = ffargs()
    const af = args[args.indexOf("-filter:a") + 1]
    // 0.25 = 0.5 × 0.5 → should produce 2 atempo=0.5 filters and a final atempo=1
    expect(af).toContain("atempo=0.5")
  })

  it("adjustAudio true: single atempo filter for in-range speed", async () => {
    await speedRamp({ videoUrl: "u", speed: 1.5, adjustAudio: true })
    const af = ffargs()[ffargs().indexOf("-filter:a") + 1]
    expect(af).toBe("atempo=1.5")
  })

  it("adjustAudio true: AAC re-encode for audio", async () => {
    await speedRamp({ videoUrl: "u", speed: 2, adjustAudio: true })
    const args = ffargs()
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
  })
})

// ===========================================================================
// 6) split-media.ts
// ===========================================================================

describe("splitMedia", () => {
  it("returns videoPaths only when only videoUrl given", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce(["video-chunk-000.mp4", "video-chunk-001.mp4"])

    const result = await splitMedia({ videoUrl: "u", chunkDuration: 5 })

    expect(result.videoPaths).toEqual([
      "/tmp/work/video-chunk-000.mp4",
      "/tmp/work/video-chunk-001.mp4",
    ])
    expect(result.audioPaths).toBeUndefined()
  })

  it("returns audioPaths only when only audioUrl given", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce(["audio-chunk-000.mp3"])

    const result = await splitMedia({ audioUrl: "u", chunkDuration: 5 })

    expect(result.audioPaths).toEqual(["/tmp/work/audio-chunk-000.mp3"])
    expect(result.videoPaths).toBeUndefined()
  })

  it("returns both when both URLs given", async () => {
    mocks.fsReaddirSync
      .mockReturnValueOnce(["video-chunk-000.mp4"])
      .mockReturnValueOnce(["audio-chunk-000.mp3"])

    const result = await splitMedia({
      videoUrl: "v", audioUrl: "a", chunkDuration: 5,
    })

    expect(result.videoPaths).toHaveLength(1)
    expect(result.audioPaths).toHaveLength(1)
  })

  it("video: emits segment muxer with chunkDuration + reset_timestamps", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce([])
    await splitMedia({ videoUrl: "u", chunkDuration: 8 })

    const args = ffargs()
    expect(args).toContain("segment")
    expect(args).toContain("-segment_time")
    expect(args[args.indexOf("-segment_time") + 1]).toBe("8")
    expect(args).toContain("-reset_timestamps")
    expect(args[args.indexOf("-reset_timestamps") + 1]).toBe("1")
  })

  it("video: outputs to chunk-NNN pattern", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce([])
    await splitMedia({ videoUrl: "u", chunkDuration: 5 })

    const args = ffargs()
    expect(args[args.length - 1]).toMatch(/video-chunk-%03d\.mp4$/)
  })

  it("audio default codec is libmp3lame (mp3)", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce([])
    await splitMedia({ audioUrl: "u", chunkDuration: 5 })

    const args = ffargs()
    expect(args[args.indexOf("-acodec") + 1]).toBe("libmp3lame")
    expect(args[args.length - 1]).toMatch(/audio-chunk-%03d\.mp3$/)
  })

  it("audio: respects audioFormat 'wav' → pcm_s16le codec + .wav pattern", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce([])
    await splitMedia({
      audioUrl: "u", chunkDuration: 5, audioFormat: "wav",
    })

    const args = ffargs()
    expect(args[args.indexOf("-acodec") + 1]).toBe("pcm_s16le")
    expect(args[args.length - 1]).toMatch(/audio-chunk-%03d\.wav$/)
  })

  it("audio: aac format uses aac codec", async () => {
    mocks.fsReaddirSync.mockReturnValueOnce([])
    await splitMedia({
      audioUrl: "u", chunkDuration: 5, audioFormat: "aac",
    })

    const args = ffargs()
    expect(args[args.indexOf("-acodec") + 1]).toBe("aac")
  })
})

// ===========================================================================
// 7) merge-video-audio.ts
// ===========================================================================

describe("mergeVideoAudio", () => {
  it("throws when no audio sources are provided", async () => {
    await expect(
      mergeVideoAudio({ videoUrl: "u" }),
    ).rejects.toThrow(/No audio tracks/)
  })

  it("single audioUrl → single track at startTime: 0", async () => {
    await mergeVideoAudio({ videoUrl: "v", audioUrl: "a" })

    // Final ffmpeg call has -filter_complex
    const args = ffargs() // single ffmpeg call (no video extraction)
    const fcIdx = args.indexOf("-filter_complex")
    expect(fcIdx).toBeGreaterThan(-1)
    // Single track without keepOriginalAudio uses [aout] label directly
    expect(args[fcIdx + 1]).toContain("[aout]")
  })

  it("multiple audioTracks → adelay per track + amix", async () => {
    await mergeVideoAudio({
      videoUrl: "v",
      audioTracks: [
        { url: "a.mp3", startTime: 0 },
        { url: "b.mp3", startTime: 2 },
      ],
    })

    // The final merge call (after any extraction) is the last runFfmpeg call
    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const fcIdx = args.indexOf("-filter_complex")
    const filter = args[fcIdx + 1]
    expect(filter).toContain("amix=inputs=2")
    expect(filter).toContain("adelay=delays=2000:all=1") // 2s × 1000 = 2000ms
  })

  it("voiceoverVolume 50 → volume=0.5 on each track", async () => {
    await mergeVideoAudio({
      videoUrl: "v",
      audioTracks: [{ url: "a.mp3", startTime: 0 }],
      voiceoverVolume: 50,
    })
    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("volume=0.5")
  })

  it("track-specific volume overrides voiceoverVolume default", async () => {
    await mergeVideoAudio({
      videoUrl: "v",
      audioTracks: [
        { url: "a.mp3", startTime: 0, volume: 75 },
        { url: "b.mp3", startTime: 0 }, // uses voiceoverVolume default
      ],
      voiceoverVolume: 100,
    })
    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("volume=0.75")
    expect(fc).toContain("volume=1")
  })

  it("keepOriginalAudio true → mixes [0:a] background with backgroundVolume", async () => {
    await mergeVideoAudio({
      videoUrl: "v", audioUrl: "a",
      keepOriginalAudio: true,
      backgroundVolume: 30,
    })
    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("[0:a]volume=0.3[orig]")
    expect(fc).toContain("amix=inputs=2") // orig + 1 track
  })

  it("video sourceType: extracts audio first, then merges", async () => {
    await mergeVideoAudio({
      videoUrl: "v",
      audioTracks: [
        { url: "video-with-audio.mp4", startTime: 0, sourceType: "video" },
      ],
    })

    // First call: extract audio from video; second call: final merge
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const extractArgs = ffargs(0)
    expect(extractArgs).toContain("-vn")
    expect(extractArgs[extractArgs.indexOf("-acodec") + 1]).toBe("pcm_s16le")
  })

  it("re-encodes video for VP9 input (cannot mux into MP4)", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("vp9\n")

    await mergeVideoAudio({ videoUrl: "v", audioUrl: "a" })

    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const idx = args.indexOf("-c:v")
    expect(args[idx + 1]).toBe("libx264")
  })

  it("stream-copies video for h264 input", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("h264\n")

    await mergeVideoAudio({ videoUrl: "v", audioUrl: "a" })

    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const idx = args.indexOf("-c:v")
    expect(args[idx + 1]).toBe("copy")
  })

  it("falls back to copy when codec probe throws", async () => {
    mocks.runFfprobe.mockRejectedValueOnce(new Error("ffprobe missing"))

    await mergeVideoAudio({ videoUrl: "v", audioUrl: "a" })

    const args = mocks.runFfmpeg.mock.calls[mocks.runFfmpeg.mock.calls.length - 1][0] as string[]
    const idx = args.indexOf("-c:v")
    expect(args[idx + 1]).toBe("copy")
  })

  it("retries without keepOriginalAudio when initial merge fails (no audio stream)", async () => {
    // First merge call fails; fallback should succeed.
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("audio stream missing"))
      .mockResolvedValueOnce("")

    await mergeVideoAudio({
      videoUrl: "v", audioUrl: "a", keepOriginalAudio: true,
    })

    // 2 calls: failed merge + retry merge
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const fallbackArgs = mocks.runFfmpeg.mock.calls[1][0] as string[]
    const fc = fallbackArgs[fallbackArgs.indexOf("-filter_complex") + 1]
    // Fallback should not include the [orig] background mix
    expect(fc).not.toContain("[orig]")
  })

  it("propagates merge failure when keepOriginalAudio is already false", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("merge bad"))

    await expect(
      mergeVideoAudio({
        videoUrl: "v", audioUrl: "a", keepOriginalAudio: false,
      }),
    ).rejects.toThrow(/FFmpeg merge failed/)
  })
})
