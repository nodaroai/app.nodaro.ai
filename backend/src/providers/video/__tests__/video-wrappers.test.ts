/**
 * Video wrapper tests.
 *
 * Eight FFmpeg wrappers in providers/video/, all following the same shape:
 *   1. createWorkDir(prefix)
 *   2. downloadFile(url, tmpPath)
 *   3. build ffmpeg args
 *   4. runFfmpeg(args)
 *   5. return output path; cleanupWorkDir on error
 *
 * The interesting per-wrapper logic is the args generation and conditional
 * branching. ffmpeg-utils itself was tested in round 12, so here we mock
 * it at the module boundary and verify each wrapper's argument shape +
 * dispatch behaviour.
 *
 * Files covered:
 *   - extract-frame.ts      (first/last/timestamp modes)
 *   - fade-video.ts         (in/out/color + audio-fallback retry)
 *   - resize-video.ts       (crop/pad/stretch + aspect dimensions + padColor)
 *   - mix-audio.ts          (per-track volume + filter_complex)
 *   - trim-video.ts         (time vs frame trim, fps probe, silent output)
 *   - trim-audio.ts         (codec map, social-media URL → yt-dlp)
 *   - adjust-volume.ts      (video vs audio mode, volume + normalize + fades)
 *   - loop-video.ts         (repeat vs duration mode, single-quote escape)
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const downloadFile = vi.fn().mockResolvedValue(undefined)
  const runFfmpeg = vi.fn().mockResolvedValue("")
  const runFfprobe = vi.fn().mockResolvedValue("")
  const getVideoDuration = vi.fn().mockResolvedValue(10)
  const createWorkDir = vi.fn().mockResolvedValue("/tmp/work")
  const cleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const fsWriteFile = vi.fn().mockResolvedValue(undefined)
  const youtubedl = vi.fn().mockResolvedValue({})
  const smartLoopCut = vi.fn().mockResolvedValue({
    videoPath: "/tmp/work/slc.mp4",
    chosenFrameIndex: 100,
    psnr: 32.5,
    sourceFrameCount: 240,
    fps: 24,
  })
  return {
    downloadFile, runFfmpeg, runFfprobe, getVideoDuration,
    createWorkDir, cleanupWorkDir, fsWriteFile, youtubedl, smartLoopCut,
  }
})

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  getVideoDuration: mocks.getVideoDuration,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
}))

vi.mock("node:fs", () => ({
  promises: { writeFile: mocks.fsWriteFile },
}))

vi.mock("youtube-dl-exec", () => ({
  default: mocks.youtubedl,
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

import { extractFrame } from "../extract-frame.js"
import { fadeVideo } from "../fade-video.js"
import { resizeVideo } from "../resize-video.js"
import { mixAudio } from "../mix-audio.js"
import { trimVideo } from "../trim-video.js"
import { trimAudio } from "../trim-audio.js"
import { adjustVolume } from "../adjust-volume.js"
import { loopVideo } from "../loop-video.js"

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.runFfprobe.mockResolvedValue("10\n")
  mocks.getVideoDuration.mockResolvedValue(10)
  mocks.fsWriteFile.mockResolvedValue(undefined)
  mocks.youtubedl.mockResolvedValue({})
  mocks.smartLoopCut.mockResolvedValue({
    videoPath: "/tmp/work/slc.mp4",
    chosenFrameIndex: 100,
    psnr: 32.5,
    sourceFrameCount: 240,
    fps: 24,
  })
})

/** Get the args of the Nth runFfmpeg call. */
function ffargs(index = 0): string[] {
  return mocks.runFfmpeg.mock.calls[index][0] as string[]
}

// ===========================================================================
// 1) extract-frame.ts
// ===========================================================================

describe("extractFrame", () => {
  it("returns the imagePath under the work directory", async () => {
    const result = await extractFrame({ videoUrl: "https://v/x.mp4", mode: "first" })
    expect(result.imagePath).toBe("/tmp/work/frame.jpg")
  })

  it("downloads the video before running ffmpeg", async () => {
    await extractFrame({ videoUrl: "https://v/x.mp4", mode: "first" })
    expect(mocks.downloadFile).toHaveBeenCalledWith("https://v/x.mp4", "/tmp/work/input.mp4")
  })

  it("first mode: ffmpeg args have no -ss / -sseof flag", async () => {
    await extractFrame({ videoUrl: "u", mode: "first" })
    const args = ffargs()
    expect(args).not.toContain("-sseof")
    expect(args).not.toContain("-ss")
  })

  // Frame-exact end seeks. Regression coverage for three defects found
  // 2026-06-11 (user video: 48 frames @ 24fps, duration 2.000s):
  //   - "last" used `-sseof -1` + first-frame-out → returned the frame ~1s
  //     before the end (PSNR 18.2dB vs the true last frame).
  //   - frame-from-end seeked to duration-(k+0.5)/fps → off by one (k
  //     returned (k-1)-from-end) and k=0 decoded ZERO frames whenever
  //     duration = N/fps (last PTS is duration - 1/fps, before the target).
  const probeFor48at24 = (a: string[]) =>
    a.includes("stream=r_frame_rate") ? "24/1"
    : a.includes("stream=nb_frames") ? "48"
    : ""

  it("last mode: frame-exact seek half a frame before the final frame's PTS", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) => probeFor48at24(a))
    await extractFrame({ videoUrl: "u", mode: "last" })
    const args = ffargs()
    expect(args).not.toContain("-sseof")
    const idx = args.indexOf("-ss")
    expect(idx).toBeGreaterThan(-1)
    expect(parseFloat(args[idx + 1]!)).toBeCloseTo((47 - 0.5) / 24, 6) // 1.9375 < last PTS 1.95833
  })

  it("frame-from-end 0 = the last frame (same seek as mode last)", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) => probeFor48at24(a))
    await extractFrame({ videoUrl: "u", mode: "frame-from-end", framesFromEnd: 0 })
    const args = ffargs()
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBeCloseTo(1.9375, 6)
  })

  it("frame-from-end 1 = second-to-last (off-by-one regression)", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) => probeFor48at24(a))
    await extractFrame({ videoUrl: "u", mode: "frame-from-end", framesFromEnd: 1 })
    const args = ffargs()
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBeCloseTo((46 - 0.5) / 24, 6)
  })

  it("frame-from-end beyond the clip clamps to frame 0 (seek 0, no negative)", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) => probeFor48at24(a))
    await extractFrame({ videoUrl: "u", mode: "frame-from-end", framesFromEnd: 500 })
    const args = ffargs()
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBe(0)
  })

  it("falls back to stream-duration×fps when nb_frames is unavailable", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) =>
      a.includes("stream=r_frame_rate") ? "24/1"
      : a.includes("stream=nb_frames") ? "N/A"
      : a.includes("stream=duration") ? "2.000000"
      : "")
    await extractFrame({ videoUrl: "u", mode: "last" })
    const args = ffargs()
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBeCloseTo(1.9375, 6)
  })

  it("timestamp mode: uses -ss <timestamp>", async () => {
    await extractFrame({ videoUrl: "u", mode: "timestamp", timestamp: 5.5 })
    const args = ffargs()
    const idx = args.indexOf("-ss")
    expect(idx).toBeGreaterThan(-1)
    expect(args[idx + 1]).toBe("5.5")
  })

  it("timestamp mode default = 0 when omitted", async () => {
    await extractFrame({ videoUrl: "u", mode: "timestamp" })
    const args = ffargs()
    const idx = args.indexOf("-ss")
    expect(args[idx + 1]).toBe("0")
  })

  it("always passes -vframes 1 and -q:v 2", async () => {
    await extractFrame({ videoUrl: "u", mode: "first" })
    const args = ffargs()
    expect(args).toContain("-vframes")
    expect(args[args.indexOf("-vframes") + 1]).toBe("1")
    expect(args).toContain("-q:v")
    expect(args[args.indexOf("-q:v") + 1]).toBe("2")
  })

  it("cleans up workDir on download failure", async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error("404"))
    await expect(extractFrame({ videoUrl: "u", mode: "first" })).rejects.toThrow()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })

  it("keyframe mode: uses -ss <timestamp> -skip_frame nokey to snap to nearest keyframe", async () => {
    await extractFrame({ videoUrl: "u", mode: "keyframe", timestamp: 5 })
    const args = ffargs()
    expect(args[args.indexOf("-ss") + 1]).toBe("5")
    expect(args).toContain("-skip_frame")
    expect(args[args.indexOf("-skip_frame") + 1]).toBe("nokey")
  })

  it("keyframe mode: timestamp defaults to 0 (= first keyframe)", async () => {
    await extractFrame({ videoUrl: "u", mode: "keyframe" })
    const args = ffargs()
    expect(args[args.indexOf("-ss") + 1]).toBe("0")
    expect(args).toContain("-skip_frame")
  })

  it("frame-index mode: probes fps and seeks half a frame before frameIndex/fps", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("24/1") // fps probe
    await extractFrame({ videoUrl: "u", mode: "frame-index", frameIndex: 48 })
    const args = ffargs()
    // (48 - 0.5) / 24 — half-frame-early avoids float-equality fragility at
    // exact PTS boundaries; the first frame at/after the target is frame 48.
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBeCloseTo(47.5 / 24, 6)
    expect(args).not.toContain("-sseof")
  })

  it("frame-index mode: defaults to frame 0", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("24/1")
    await extractFrame({ videoUrl: "u", mode: "frame-index" })
    const args = ffargs()
    expect(args[args.indexOf("-ss") + 1]).toBe("0")
  })

  it("frame-index mode: hard-fails when fps probe returns invalid value", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("not-a-fraction")
    await expect(extractFrame({ videoUrl: "u", mode: "frame-index", frameIndex: 10 })).rejects.toThrow(/probe fps/)
  })

  it("frame-from-end mode: frame-exact seek from fps + frame count (240f @ 24fps, k=11 → frame 228)", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) =>
      a.includes("stream=r_frame_rate") ? "24/1"
      : a.includes("stream=nb_frames") ? "240"
      : "")
    await extractFrame({ videoUrl: "u", mode: "frame-from-end", framesFromEnd: 11 })
    const args = ffargs()
    // wanted = 240 - 1 - 11 = 228 → seek (228 - 0.5) / 24
    expect(parseFloat(args[args.indexOf("-ss") + 1]!)).toBeCloseTo(227.5 / 24, 6)
  })

  it("frame-from-end mode: hard-fails when neither nb_frames nor stream duration is usable", async () => {
    mocks.runFfprobe.mockImplementation(async (a: string[]) =>
      a.includes("stream=r_frame_rate") ? "24/1" : "N/A")
    await expect(
      extractFrame({ videoUrl: "u", mode: "frame-from-end", framesFromEnd: 0 }),
    ).rejects.toThrow(/frame count/)
  })
})

// ===========================================================================
// 2) fade-video.ts
// ===========================================================================

describe("fadeVideo", () => {
  it("emits fade=t=in for fadeIn at start", async () => {
    await fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1.5,
      fadeOut: false, fadeOutDuration: 0, color: "black",
    })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("fade=t=in:st=0:d=1.5:color=black")
  })

  it("computes fade-out start as duration - fadeOutDuration", async () => {
    mocks.getVideoDuration.mockResolvedValueOnce(10)
    await fadeVideo({
      videoUrl: "u", fadeIn: false, fadeInDuration: 0,
      fadeOut: true, fadeOutDuration: 2, color: "black",
    })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("fade=t=out:st=8.000:d=2:color=black")
  })

  it("emits combined audio fade chain (afade) parallel to video fade", async () => {
    await fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1,
      fadeOut: true, fadeOutDuration: 1, color: "black",
    })
    const args = ffargs()
    const afIdx = args.indexOf("-af")
    expect(afIdx).toBeGreaterThan(-1)
    expect(args[afIdx + 1]).toContain("afade=t=in")
    expect(args[afIdx + 1]).toContain("afade=t=out")
  })

  it("supports white color", async () => {
    await fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1,
      fadeOut: false, fadeOutDuration: 0, color: "white",
    })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("color=white")
  })

  it("clamps fadeOutStart to >= 0 when duration < fadeOutDuration", async () => {
    mocks.getVideoDuration.mockResolvedValueOnce(0.5)
    await fadeVideo({
      videoUrl: "u", fadeIn: false, fadeInDuration: 0,
      fadeOut: true, fadeOutDuration: 5, color: "black",
    })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("st=0.000")
  })

  it("retries without -af when audio filter fails (no audio track)", async () => {
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("audio filter failed"))
      .mockResolvedValueOnce("")

    await fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1,
      fadeOut: false, fadeOutDuration: 0, color: "black",
    })

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const fallbackArgs = ffargs(1)
    expect(fallbackArgs).toContain("-an")
    expect(fallbackArgs).not.toContain("-af")
  })

  it("returns the output path", async () => {
    const out = await fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1,
      fadeOut: false, fadeOutDuration: 0, color: "black",
    })
    expect(out).toBe("/tmp/work/output.mp4")
  })

  it("cleans up workDir on terminal failure (both attempts fail)", async () => {
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("fallback fail"))

    await expect(fadeVideo({
      videoUrl: "u", fadeIn: true, fadeInDuration: 1,
      fadeOut: false, fadeOutDuration: 0, color: "black",
    })).rejects.toThrow()
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })
})

// ===========================================================================
// 3) resize-video.ts
// ===========================================================================

describe("resizeVideo", () => {
  it.each([
    ["1:1", 1080, 1080],
    ["16:9", 1920, 1080],
    ["9:16", 1080, 1920],
    ["4:5", 1080, 1350],
  ] as const)("targetAspect %s → %dx%d", async (aspect, w, h) => {
    await resizeVideo({ videoUrl: "u", targetAspect: aspect, method: "stretch" })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain(`${w}:${h}`)
  })

  it("falls back to 1920x1080 for unknown aspect ratio", async () => {
    await resizeVideo({ videoUrl: "u", targetAspect: "21:9", method: "stretch" })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("1920:1080")
  })

  it("crop method uses force_original_aspect_ratio=increase + crop", async () => {
    await resizeVideo({ videoUrl: "u", targetAspect: "16:9", method: "crop" })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("force_original_aspect_ratio=increase")
    expect(args[vfIdx + 1]).toContain("crop=1920:1080")
  })

  it("pad method uses force_original_aspect_ratio=decrease + pad with color", async () => {
    await resizeVideo({
      videoUrl: "u", targetAspect: "16:9", method: "pad", padColor: "#FF00FF",
    })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("force_original_aspect_ratio=decrease")
    expect(args[vfIdx + 1]).toContain("color=0xFF00FF") // # → 0x conversion
  })

  it("pad method default color is #000000 → 0x000000", async () => {
    await resizeVideo({ videoUrl: "u", targetAspect: "16:9", method: "pad" })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toContain("color=0x000000")
  })

  it("stretch method uses bare scale (no force_original_aspect_ratio)", async () => {
    await resizeVideo({ videoUrl: "u", targetAspect: "16:9", method: "stretch" })
    const args = ffargs()
    const vfIdx = args.indexOf("-vf")
    expect(args[vfIdx + 1]).toBe("scale=1920:1080")
  })

  it("stream-copies the audio (-c:a copy)", async () => {
    await resizeVideo({ videoUrl: "u", targetAspect: "16:9", method: "stretch" })
    const args = ffargs()
    const idx = args.indexOf("-c:a")
    expect(args[idx + 1]).toBe("copy")
  })
})

// ===========================================================================
// 4) mix-audio.ts
// ===========================================================================

describe("mixAudio", () => {
  it("downloads each input audio in order", async () => {
    await mixAudio({ audioUrls: ["a.mp3", "b.mp3", "c.mp3"] })
    expect(mocks.downloadFile).toHaveBeenCalledTimes(3)
  })

  it("detects file extension by URL substring (.wav, .aac, default mp3)", async () => {
    await mixAudio({ audioUrls: ["x.wav", "y.aac", "z.mp3"] })
    const calls = mocks.downloadFile.mock.calls
    expect(calls[0][1]).toMatch(/input_0\.wav$/)
    expect(calls[1][1]).toMatch(/input_1\.aac$/)
    expect(calls[2][1]).toMatch(/input_2\.mp3$/)
  })

  it("default per-track volume is 1.0 (=100%)", async () => {
    await mixAudio({ audioUrls: ["a.mp3", "b.mp3"] })
    const args = ffargs()
    const fcIdx = args.indexOf("-filter_complex")
    expect(args[fcIdx + 1]).toContain("[0:a]volume=1[a0]")
    expect(args[fcIdx + 1]).toContain("[1:a]volume=1[a1]")
  })

  it("respects custom trackVolumes (50, 200) → 0.5, 2", async () => {
    await mixAudio({ audioUrls: ["a.mp3", "b.mp3"], trackVolumes: [50, 200] })
    const args = ffargs()
    const fcIdx = args.indexOf("-filter_complex")
    expect(args[fcIdx + 1]).toContain("[0:a]volume=0.5[a0]")
    expect(args[fcIdx + 1]).toContain("[1:a]volume=2[a1]")
  })

  it("filter_complex chains volume → amix with duration=longest", async () => {
    await mixAudio({ audioUrls: ["a.mp3", "b.mp3", "c.mp3"] })
    const args = ffargs()
    const fcIdx = args.indexOf("-filter_complex")
    expect(args[fcIdx + 1]).toContain("[a0][a1][a2]amix=inputs=3:duration=longest[aout]")
  })

  it("maps the [aout] output", async () => {
    await mixAudio({ audioUrls: ["a.mp3"] })
    const args = ffargs()
    const idx = args.indexOf("-map")
    expect(args[idx + 1]).toBe("[aout]")
  })

  it("returns workDir/output.mp3", async () => {
    const out = await mixAudio({ audioUrls: ["a.mp3"] })
    expect(out).toBe("/tmp/work/output.mp3")
  })
})

// ===========================================================================
// 5) trim-video.ts
// ===========================================================================

describe("trimVideo", () => {
  it("time-based trim: -ss <startTime> + -t <duration>", async () => {
    await trimVideo({ videoUrl: "u", startTime: 2, endTime: 7 })
    const args = ffargs()
    const ssIdx = args.indexOf("-ss")
    expect(args[ssIdx + 1]).toBe("2")
    const tIdx = args.indexOf("-t")
    expect(args[tIdx + 1]).toBe("5") // 7 - 2
  })

  it("omits -t when endTime is undefined", async () => {
    await trimVideo({ videoUrl: "u", startTime: 1 })
    const args = ffargs()
    expect(args).not.toContain("-t")
  })

  it("frame-based trimStartFrames overrides startTime", async () => {
    // probe returns "30/1" fps + 10s duration; 60 frames at 30fps = 2s
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n10\n")

    await trimVideo({ videoUrl: "u", startTime: 999, trimStartFrames: 60 })

    const args = ffargs()
    const ssIdx = args.indexOf("-ss")
    expect(args[ssIdx + 1]).toBe("2")
  })

  it("frame-based trimEndFrames sets endTime = duration - frames/fps", async () => {
    // 30fps, 10s, trim 60 end frames → end = 10 - 2 = 8
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n10\n")

    await trimVideo({ videoUrl: "u", startTime: 0, trimEndFrames: 60 })

    const args = ffargs()
    const tIdx = args.indexOf("-t")
    expect(args[tIdx + 1]).toBe("8")
  })

  it("parses fractional fps (e.g. 30000/1001)", async () => {
    // 29.97fps, 100s, trim 30 frames from start → ~1.001s
    mocks.runFfprobe.mockResolvedValueOnce("30000/1001\n100\n")

    await trimVideo({ videoUrl: "u", startTime: 0, trimStartFrames: 30 })

    const args = ffargs()
    const ssIdx = args.indexOf("-ss")
    expect(parseFloat(args[ssIdx + 1] as string)).toBeCloseTo(1.001, 2)
  })

  it("throws when fps probe fails (no silent miscut)", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("garbage\n")

    await expect(
      trimVideo({ videoUrl: "u", startTime: 0, trimStartFrames: 60 }),
    ).rejects.toThrow(/probe fps\/duration/)
  })

  it("outputSilentVideo true → -an, no audio codec", async () => {
    await trimVideo({ videoUrl: "u", startTime: 0, outputSilentVideo: true })
    const args = ffargs()
    expect(args).toContain("-an")
    expect(args).not.toContain("aac")
  })

  it("outputSilentVideo false → AAC audio re-encode", async () => {
    await trimVideo({ videoUrl: "u", startTime: 0, outputSilentVideo: false })
    const args = ffargs()
    expect(args).toContain("aac")
    expect(args).not.toContain("-an")
  })

  it("seconds mode: trimStartSeconds sets -ss directly, no fps probe", async () => {
    // probeTrimMetadata is invoked, but only the duration line matters; mock
    // returns "30/1\n10\n" anyway so the parser is happy.
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n10\n")
    await trimVideo({ videoUrl: "u", startTime: 999, trimStartSeconds: 3 })
    const args = ffargs()
    expect(args[args.indexOf("-ss") + 1]).toBe("3")
  })

  it("seconds mode: trimEndSeconds sets endTime = duration - trimEndSeconds", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n10\n")
    await trimVideo({ videoUrl: "u", startTime: 0, trimEndSeconds: 2 })
    const args = ffargs()
    // duration 10s - 2 = 8 → -t (8 - 0) = 8
    expect(args[args.indexOf("-t") + 1]).toBe("8")
  })

  it("keep-last-seconds: probes duration, seeks (duration - N) seconds", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n20\n") // 20s duration
    await trimVideo({ videoUrl: "u", startTime: 0, keepLastSeconds: 5 })
    const args = ffargs()
    // start = 20 - 5 = 15, end = 20 → -t (20 - 15) = 5
    expect(args[args.indexOf("-ss") + 1]).toBe("15")
    expect(args[args.indexOf("-t") + 1]).toBe("5")
  })

  it("keep-last-seconds: clamps to source length when N exceeds duration", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n3\n") // 3s source
    await trimVideo({ videoUrl: "u", startTime: 0, keepLastSeconds: 30 })
    const args = ffargs()
    // start = max(0, 3 - 30) = 0, end = 3 → -t 3
    expect(args[args.indexOf("-ss") + 1]).toBe("0")
    expect(args[args.indexOf("-t") + 1]).toBe("3")
  })

  it("keep-first-seconds: -ss 0 + -t N (clamped to duration)", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n20\n")
    await trimVideo({ videoUrl: "u", startTime: 999, keepFirstSeconds: 5 })
    const args = ffargs()
    expect(args[args.indexOf("-ss") + 1]).toBe("0")
    expect(args[args.indexOf("-t") + 1]).toBe("5")
  })

  it("keep-first-seconds: clamps to source length", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("30/1\n3\n")
    await trimVideo({ videoUrl: "u", startTime: 0, keepFirstSeconds: 30 })
    const args = ffargs()
    // start = 0, end = min(3, 30) = 3 → -t 3
    expect(args[args.indexOf("-t") + 1]).toBe("3")
  })
})

// ===========================================================================
// 6) trim-audio.ts
// ===========================================================================

describe("trimAudio", () => {
  it("uses downloadFile for non-social-media URLs", async () => {
    await trimAudio({ videoUrl: "https://r2.example/video.mp4" })
    expect(mocks.downloadFile).toHaveBeenCalled()
    expect(mocks.youtubedl).not.toHaveBeenCalled()
  })

  it.each([
    "https://youtube.com/watch?v=x",
    "https://youtu.be/x",
    "https://tiktok.com/@x/video/123",
    "https://instagram.com/reel/x/",
    "https://twitter.com/x/status/1",
    "https://x.com/x/status/1",
    "https://facebook.com/watch?v=x",
    "https://fb.watch/x/",
  ])("uses yt-dlp for social media URL %s", async (url) => {
    await trimAudio({ videoUrl: url })
    expect(mocks.youtubedl).toHaveBeenCalled()
    expect(mocks.downloadFile).not.toHaveBeenCalled()
  })

  it("default audioFormat is mp3 with libmp3lame codec", async () => {
    await trimAudio({ videoUrl: "https://r2/x.mp4" })
    const args = ffargs()
    const idx = args.indexOf("-acodec")
    expect(args[idx + 1]).toBe("libmp3lame")
  })

  it.each([
    ["mp3", "libmp3lame"],
    ["wav", "pcm_s16le"],
    ["aac", "aac"],
  ] as const)("audioFormat %s → codec %s", async (format, codec) => {
    await trimAudio({ videoUrl: "https://r2/x.mp4", audioFormat: format })
    const args = ffargs()
    const idx = args.indexOf("-acodec")
    expect(args[idx + 1]).toBe(codec)
  })

  it("includes -ss + -to when startTime + endTime set", async () => {
    await trimAudio({ videoUrl: "https://r2/x.mp4", startTime: 5, endTime: 15 })
    const args = ffargs()
    expect(args).toContain("-ss")
    expect(args[args.indexOf("-ss") + 1]).toBe("5")
    expect(args).toContain("-to")
    expect(args[args.indexOf("-to") + 1]).toBe("15")
  })

  it("strips video stream with -vn", async () => {
    await trimAudio({ videoUrl: "https://r2/x.mp4" })
    expect(ffargs()).toContain("-vn")
  })

  it("wraps yt-dlp errors with stderr context", async () => {
    const err = new Error("download failed") as Error & { stderr: string }
    err.stderr = "video unavailable"
    mocks.youtubedl.mockRejectedValueOnce(err)

    await expect(trimAudio({ videoUrl: "https://youtube.com/x" }))
      .rejects.toThrow(/yt-dlp download failed/)
  })

  it("returns audioPath with the chosen extension", async () => {
    const result = await trimAudio({
      videoUrl: "https://r2/x.mp4", audioFormat: "wav",
    })
    expect(result.audioPath).toMatch(/output\.wav$/)
  })
})

// ===========================================================================
// 7) adjust-volume.ts
// ===========================================================================

describe("adjustVolume", () => {
  it("throws when neither audioUrl nor videoUrl provided", async () => {
    await expect(adjustVolume({})).rejects.toThrow(
      /audioUrl or videoUrl is required/,
    )
  })

  it("default volume is 100 → filter volume=1", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3" })
    const args = ffargs()
    const idx = args.indexOf("-af")
    expect(args[idx + 1]).toContain("volume=1")
  })

  it("custom volume 50 → volume=0.5", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3", volume: 50 })
    const args = ffargs()
    expect(args[args.indexOf("-af") + 1]).toContain("volume=0.5")
  })

  it("normalize true → adds loudnorm filter", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3", normalize: true })
    expect(ffargs()[ffargs().indexOf("-af") + 1]).toContain("loudnorm")
  })

  it("normalize false (default) omits loudnorm", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3" })
    expect(ffargs()[ffargs().indexOf("-af") + 1]).not.toContain("loudnorm")
  })

  it("fadeIn > 0 adds afade=t=in:d=...", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3", fadeIn: 2 })
    expect(ffargs()[ffargs().indexOf("-af") + 1]).toContain("afade=t=in:d=2")
  })

  it("fadeOut > 0 adds afade=t=out:d=...", async () => {
    await adjustVolume({ audioUrl: "https://r2/a.mp3", fadeOut: 3 })
    expect(ffargs()[ffargs().indexOf("-af") + 1]).toContain("afade=t=out:d=3")
  })

  it("video mode: streams-copy video, applies audio filters", async () => {
    const result = await adjustVolume({ videoUrl: "https://r2/v.mp4", volume: 80 })
    expect(result.inputType).toBe("video")
    const args = ffargs()
    const idx = args.indexOf("-c:v")
    expect(args[idx + 1]).toBe("copy")
    expect(args).toContain("-af")
  })

  it("audio mode: only -af, no -c:v", async () => {
    const result = await adjustVolume({ audioUrl: "https://r2/a.mp3" })
    expect(result.inputType).toBe("audio")
    expect(ffargs()).not.toContain("-c:v")
  })

  it("video URL takes precedence when both provided", async () => {
    const result = await adjustVolume({
      videoUrl: "https://r2/v.mp4",
      audioUrl: "https://r2/a.mp3",
    })
    expect(result.inputType).toBe("video")
  })

  it("detects extension from video URL (.mov)", async () => {
    await adjustVolume({ videoUrl: "https://r2/clip.mov" })
    const downloadCall = mocks.downloadFile.mock.calls[0]
    expect(downloadCall[1]).toMatch(/input\.mov$/)
  })

  it("falls back to mp4/mp3 default extension when URL has none", async () => {
    await adjustVolume({ videoUrl: "https://r2/no-ext" })
    const downloadCall = mocks.downloadFile.mock.calls[0]
    expect(downloadCall[1]).toMatch(/input\.mp4$/)
  })
})

// ===========================================================================
// 8) loop-video.ts
// ===========================================================================

describe("loopVideo", () => {
  it("repeat mode: writes a filelist with N copies and stream-copies", async () => {
    await loopVideo({
      videoUrl: "u", mode: "repeat", repeatCount: 3,
    })

    expect(mocks.fsWriteFile).toHaveBeenCalledOnce()
    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    const lines = written.split("\n")
    expect(lines).toHaveLength(3)
    expect(lines[0]).toMatch(/^file '\/tmp\/work\/input\.mp4'$/)

    const args = ffargs()
    expect(args).toContain("concat")
    expect(args).toContain("-c")
    expect(args[args.indexOf("-c") + 1]).toBe("copy")
  })

  it("repeat mode: default repeatCount = 2", async () => {
    await loopVideo({ videoUrl: "u", mode: "repeat" })
    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(written.split("\n")).toHaveLength(2)
  })

  it("escapes single quotes in input path for the filelist", async () => {
    mocks.createWorkDir.mockResolvedValueOnce("/tmp/work's-dir")
    await loopVideo({ videoUrl: "u", mode: "repeat", repeatCount: 1 })

    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(written).toContain("work'\\''s-dir")
  })

  it("duration mode: probes clip duration, computes timesNeeded = ceil(target/clip)", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("3.5\n") // 3.5s clip

    await loopVideo({
      videoUrl: "u", mode: "duration", targetDuration: 10,
    })

    // ceil(10 / 3.5) = 3 repeats
    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(written.split("\n")).toHaveLength(3)
  })

  it("duration mode: trims output to exact targetDuration with -t", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("3.5\n")

    await loopVideo({
      videoUrl: "u", mode: "duration", targetDuration: 10,
    })

    const args = ffargs()
    const tIdx = args.indexOf("-t")
    expect(args[tIdx + 1]).toBe("10")
  })

  it("duration mode: re-encodes with libx264 (not stream-copy)", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("5\n")

    await loopVideo({ videoUrl: "u", mode: "duration", targetDuration: 8 })

    const args = ffargs()
    expect(args).toContain("libx264")
  })

  it("duration mode: throws when clip duration cannot be parsed", async () => {
    mocks.runFfprobe.mockResolvedValueOnce("garbage\n")

    await expect(
      loopVideo({ videoUrl: "u", mode: "duration", targetDuration: 10 }),
    ).rejects.toThrow(/Could not determine clip duration/)
  })

  it("smartLoopCutBeforeRepeat: replaces input path with smart-cut output before concat", async () => {
    mocks.smartLoopCut.mockResolvedValueOnce({
      videoPath: "/tmp/work/smart-cut.mp4",
      chosenFrameIndex: 200,
      psnr: 35,
      sourceFrameCount: 240,
      fps: 24,
    })

    const result = await loopVideo({
      videoUrl: "u", mode: "repeat", repeatCount: 2,
      smartLoopCutBeforeRepeat: true, smartLoopCutLookback: 16,
    })

    expect(mocks.smartLoopCut).toHaveBeenCalledWith({
      videoUrl: "u", lookbackFrames: 16,
    })
    const written = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(written).toContain("smart-cut.mp4")
    expect(result.smartLoopCutMeta).toEqual({
      chosenFrameIndex: 200,
      psnr: 35,
      sourceFrameCount: 240,
      fps: 24,
    })
  })

  it("returns LoopVideoResult with no smartLoopCutMeta when feature off", async () => {
    const result = await loopVideo({
      videoUrl: "u", mode: "repeat", repeatCount: 2,
    })
    expect(result.outputPath).toBe("/tmp/work/output.mp4")
    expect(result.smartLoopCutMeta).toBeUndefined()
  })
})
