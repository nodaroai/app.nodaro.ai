/**
 * combineVideos tests.
 *
 * combine-videos.ts is the most logic-dense video wrapper. Beyond the
 * standard download+normalize+trim flow it owns:
 *
 *   - Cut transition (concat demuxer with stream-copy)
 *   - xfade transition family (fade/dissolve/dip-to-black/dip-to-white)
 *     with chained xfade filter graph
 *   - Audio handling per audioMode:
 *       "remove"    → -an
 *       "crossfade" → acrossfade chain + video-only fallback when any
 *                      clip lacks audio
 *       "keep"      → concat audio with silent placeholders for clips
 *                      without an audio stream
 *   - Dip-to-color: interleave a solid color clip between each input
 *   - Per-clip frame trim with "would exceed clip length" skip
 *   - safeDuration = min(transitionDuration, minDur * 0.9) clamp
 *
 * Tests mock ffmpeg-utils + node:fs/promises and verify the resulting
 * ffmpeg argument shapes per branch.
 */

import { describe, it, expect, vi, beforeEach } from "vitest"

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  const downloadFile = vi.fn().mockResolvedValue(undefined)
  const runFfmpeg = vi.fn().mockResolvedValue("")
  const runFfprobe = vi.fn().mockResolvedValue("")
  const getVideoDuration = vi.fn().mockResolvedValue(5)
  const createWorkDir = vi.fn().mockResolvedValue("/tmp/work")
  const cleanupWorkDir = vi.fn().mockResolvedValue(undefined)
  const normalizeVideoForCombine = vi.fn().mockResolvedValue("")
  const fsWriteFile = vi.fn().mockResolvedValue(undefined)
  return {
    downloadFile, runFfmpeg, runFfprobe, getVideoDuration,
    createWorkDir, cleanupWorkDir, normalizeVideoForCombine, fsWriteFile,
  }
})

vi.mock("../ffmpeg-utils.js", () => ({
  downloadFile: mocks.downloadFile,
  runFfmpeg: mocks.runFfmpeg,
  runFfprobe: mocks.runFfprobe,
  getVideoDuration: mocks.getVideoDuration,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  normalizeVideoForCombine: mocks.normalizeVideoForCombine,
}))

vi.mock("node:fs", () => ({
  promises: { writeFile: mocks.fsWriteFile },
}))

vi.mock("@/lib/config.js", () => ({
  config: { EDITION: "cloud", NODE_ENV: "test" },
  hasCredits: () => true, isCloud: () => true, isCommunity: () => false,
  isBusiness: () => false, hasAdmin: () => true,
}))

// ---------------------------------------------------------------------------
// Imports under test
// ---------------------------------------------------------------------------

import { combineVideos } from "../combine-videos.js"

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

interface CombineCallOpts {
  videoUrls?: string[]
  transition?: string
  transitionDuration?: number
  audioMode?: "keep" | "crossfade" | "remove"
  audioCrossfadeCurve?: string
  trimStartFrames?: number
  trimEndFrames?: number
}

function defaultOptions(over: CombineCallOpts = {}): Parameters<typeof combineVideos>[0] {
  return {
    videoUrls: over.videoUrls ?? ["https://r2/a.mp4", "https://r2/b.mp4"],
    transition: over.transition ?? "cut",
    transitionDuration: over.transitionDuration ?? 1,
    audioMode: over.audioMode ?? "keep",
    audioCrossfadeCurve: over.audioCrossfadeCurve,
    trimStartFrames: over.trimStartFrames ?? 0,
    trimEndFrames: over.trimEndFrames ?? 0,
  }
}

/** Get the args of the Nth runFfmpeg call. */
function ffargs(index: number): string[] {
  return mocks.runFfmpeg.mock.calls[index][0] as string[]
}

/** Get the args of the LAST runFfmpeg call (typically the merge). */
function lastArgs(): string[] {
  const i = mocks.runFfmpeg.mock.calls.length - 1
  return ffargs(i)
}

/** Stub ffprobe responses for the standard flow:
 *  hasAudioStream calls for each clip → return "audio" (truthy).
 *  Other ffprobe calls (fps, resolution) handled per test. */
function stubAudioStreamProbes(count: number, hasAudio = true) {
  for (let i = 0; i < count; i++) {
    mocks.runFfprobe.mockResolvedValueOnce(hasAudio ? "audio\n" : "")
  }
}

/** Stub the resolution probes combineVideos runs up front (one per input
 *  clip, to pick a uniform target). Call this first when a test queues other
 *  runFfprobe responses, so it doesn't consume the resolution stubs. */
function stubResolutionProbes(count: number, res = "1280x720") {
  for (let i = 0; i < count; i++) {
    mocks.runFfprobe.mockResolvedValueOnce(res)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createWorkDir.mockResolvedValue("/tmp/work")
  mocks.cleanupWorkDir.mockResolvedValue(undefined)
  mocks.downloadFile.mockResolvedValue(undefined)
  mocks.runFfmpeg.mockResolvedValue("")
  mocks.runFfprobe.mockResolvedValue("")
  mocks.getVideoDuration.mockResolvedValue(5)
  mocks.normalizeVideoForCombine.mockImplementation(async (_in: string, out: string) => out)
  mocks.fsWriteFile.mockResolvedValue(undefined)
})

// ===========================================================================
// 1) Pre-processing
// ===========================================================================

describe("combineVideos — pre-processing", () => {
  it("downloads each clip and normalizes it before any combine work", async () => {
    await combineVideos(defaultOptions({ videoUrls: ["a.mp4", "b.mp4", "c.mp4"] }))

    expect(mocks.downloadFile).toHaveBeenCalledTimes(3)
    expect(mocks.normalizeVideoForCombine).toHaveBeenCalledTimes(3)
  })

  it("downloads to input_<i>.mp4 and normalizes to normalized_<i>.mp4 in workDir", async () => {
    await combineVideos(defaultOptions({ videoUrls: ["a.mp4", "b.mp4"] }))

    expect(mocks.downloadFile.mock.calls[0][1]).toBe("/tmp/work/input_0.mp4")
    expect(mocks.downloadFile.mock.calls[1][1]).toBe("/tmp/work/input_1.mp4")
    expect(mocks.normalizeVideoForCombine.mock.calls[0][1]).toBe("/tmp/work/normalized_0.mp4")
  })

  it("normalizes every clip to the most common resolution (so xfade/concat see uniform inputs)", async () => {
    // 2 clips at 1280x720, one odd 864x496 → target is the majority.
    mocks.runFfprobe.mockImplementation(async (probeArgs: unknown) => {
      const args = probeArgs as string[]
      const path = args[args.length - 1]
      return path.endsWith("input_1.mp4") ? "864x496" : "1280x720"
    })

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"], transition: "cut",
    }))

    expect(mocks.normalizeVideoForCombine).toHaveBeenCalledTimes(3)
    for (const call of mocks.normalizeVideoForCombine.mock.calls) {
      expect(call[2]).toBe(1280) // targetWidth
      expect(call[3]).toBe(720) // targetHeight
    }
  })

  it("cleans up workDir on download failure", async () => {
    mocks.downloadFile.mockRejectedValueOnce(new Error("404"))
    await expect(combineVideos(defaultOptions())).rejects.toThrow()
    expect(mocks.cleanupWorkDir).toHaveBeenCalledWith("/tmp/work")
  })
})

// ===========================================================================
// 2) Frame-trim helper (trimClipFrames, exercised through public flow)
// ===========================================================================

describe("combineVideos — frame trim", () => {
  it("trims start and end when trimStartFrames + trimEndFrames > 0 (fps probe + ffmpeg trim)", async () => {
    // Order: 2 resolution probes (target pick) → then 2 clips × (fps probe,
    // then duration probe before trim). 'cut' doesn't probe durations again.
    stubResolutionProbes(2)
    mocks.runFfprobe
      .mockResolvedValueOnce("30/1") // fps for clip 0
      .mockResolvedValueOnce("30/1") // fps for clip 1
    mocks.getVideoDuration
      .mockResolvedValueOnce(10) // duration for clip 0 trim
      .mockResolvedValueOnce(10) // duration for clip 1 trim

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      trimStartFrames: 30, // 1s @ 30fps
      trimEndFrames: 30,    // 1s @ 30fps
      transition: "cut",
    }))

    // The first 2 ffmpeg calls are the trims; expect -ss 1 and -to 9.
    const trim0 = ffargs(0)
    expect(trim0[trim0.indexOf("-ss") + 1]).toBe("1")
    expect(trim0[trim0.indexOf("-to") + 1]).toBe("9")
  })

  it("skips trim when start+end exceeds clip duration (no extra ffmpeg call)", async () => {
    stubResolutionProbes(2)
    mocks.runFfprobe
      .mockResolvedValueOnce("30/1")
      .mockResolvedValueOnce("30/1")
    mocks.getVideoDuration
      .mockResolvedValueOnce(0.5) // 0.5s clip
      .mockResolvedValueOnce(0.5)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      trimStartFrames: 30, // 1s @ 30fps — exceeds clip
      trimEndFrames: 30,
      transition: "cut",
    }))

    // Cut path with no trims → 1 ffmpeg call (the concat).
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("falls back to fps=24 when fps probe yields invalid fraction", async () => {
    stubResolutionProbes(2)
    mocks.runFfprobe
      .mockResolvedValueOnce("invalid") // fps clip 0
      .mockResolvedValueOnce("invalid") // fps clip 1
    mocks.getVideoDuration
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      trimStartFrames: 24, // 1s @ 24fps fallback
      trimEndFrames: 0,
      transition: "cut",
    }))

    // -ss should equal 24/24 = 1
    const trim0 = ffargs(0)
    expect(trim0[trim0.indexOf("-ss") + 1]).toBe("1")
  })
})

// ===========================================================================
// 3) Cut transition
// ===========================================================================

describe("combineVideos — cut transition", () => {
  it("writes a concat filelist and runs concat demuxer with -c copy", async () => {
    await combineVideos(defaultOptions({ transition: "cut", audioMode: "keep" }))

    // Filelist written
    expect(mocks.fsWriteFile).toHaveBeenCalledOnce()
    const list = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(list).toMatch(/file '\/tmp\/work\/normalized_0\.mp4'/)
    expect(list).toMatch(/file '\/tmp\/work\/normalized_1\.mp4'/)

    // ffmpeg concat with -c copy
    const args = lastArgs()
    expect(args).toContain("concat")
    expect(args[args.indexOf("-c") + 1]).toBe("copy")
  })

  it("audioMode=remove: uses -c:v copy + -an", async () => {
    await combineVideos(defaultOptions({ transition: "cut", audioMode: "remove" }))

    const args = lastArgs()
    expect(args).toContain("-an")
    expect(args[args.indexOf("-c:v") + 1]).toBe("copy")
    expect(args).not.toContain("-c") // generic -c key not used in this branch
  })

  it("escapes single quotes in filelist paths", async () => {
    // The source builds normalizedPath = join(workDir, `normalized_${i}.mp4`)
    // and ignores normalize's return value, so to inject an apostrophe we
    // override the workDir path itself.
    mocks.createWorkDir.mockResolvedValueOnce("/tmp/it's-work")

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"], transition: "cut",
    }))
    const list = mocks.fsWriteFile.mock.calls[0][1] as string
    // Source uses p.replace(/'/g, "'\\''") — every apostrophe → '\''
    // resulting filelist path: /tmp/it'\''s-work/normalized_0.mp4
    expect(list).toContain("it'\\''s-work")
  })

  it("cut + audioMode=crossfade: takes filter-graph path with concat video + acrossfade audio + apad", async () => {
    // Regression: previously the concat-demuxer fast path swallowed the
    // audioMode=crossfade flag by stream-copying audio. Now we route this
    // combo through a filter graph so the crossfade actually runs.
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0.5,
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    // Video: hard-cut concat filter, not xfade
    expect(fc).toContain("[0:v][1:v]concat=n=2:v=1:a=0[vout]")
    expect(fc).not.toContain("xfade=")
    // Audio: acrossfade with default linear curve
    expect(fc).toContain("acrossfade=d=0.5")
    expect(fc).toContain("c1=tri:c2=tri")
    // Pad audio with silence to match total video duration (5+5=10s)
    expect(fc).toContain("apad=whole_dur=10")
    expect(fc).toContain("[aout_padded]")
    // Map padded audio, not raw acrossfade output
    const mapCalls = args.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(args[i + 1])
      return acc
    }, [])
    expect(mapCalls).toContain("[vout]")
    expect(mapCalls).toContain("[aout_padded]")
    // Not stream-copy: re-encodes through filter graph
    expect(args[args.indexOf("-c:v") + 1]).toBe("libx264")
    expect(args[args.indexOf("-c:a") + 1]).toBe("aac")
  })

  it("cut + audioMode=crossfade: falls back to concat demuxer when filter fails (e.g. clip without audio)", async () => {
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    // First ffmpeg call (the filter-graph attempt) rejects; fallback succeeds.
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("acrossfade failed: no audio in clip 1"))
      .mockResolvedValueOnce("")

    await combineVideos(defaultOptions({
      transition: "cut", audioMode: "crossfade",
    }))

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const fallbackArgs = mocks.runFfmpeg.mock.calls[1][0] as string[]
    // Fallback is concat demuxer with stream copy — preserves existing audio
    // even though crossfade can no longer run.
    expect(fallbackArgs).toContain("concat")
    expect(fallbackArgs[fallbackArgs.indexOf("-c") + 1]).toBe("copy")
    expect(fallbackArgs).not.toContain("-an")
  })
})

// ===========================================================================
// 4) Dip-to-black / dip-to-white — route through FFmpeg's built-in
// `fadeblack` / `fadewhite` xfade transitions (no intermediate color clip).
// ===========================================================================

describe("combineVideos — dip transitions", () => {
  it("dip-to-black: emits xfade transition='fadeblack' with no lavfi color clip", async () => {
    stubResolutionProbes(2, "1920x1080")
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "dip-to-black",
      transitionDuration: 0.5,
      audioMode: "remove",
    }))

    // No ffmpeg call should generate a lavfi color clip anymore.
    for (let i = 0; i < mocks.runFfmpeg.mock.calls.length; i++) {
      const args = ffargs(i)
      expect(args.some((a) => typeof a === "string" && a.startsWith("color=c="))).toBe(false)
    }

    const last = lastArgs()
    const fc = last[last.indexOf("-filter_complex") + 1]
    expect(fc).toContain("transition=fadeblack")
  })

  it("dip-to-white: emits xfade transition='fadewhite'", async () => {
    stubResolutionProbes(2, "1280x720")
    mocks.getVideoDuration.mockResolvedValueOnce(5).mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "dip-to-white",
      transitionDuration: 0.5,
      audioMode: "remove",
    }))

    const last = lastArgs()
    const fc = last[last.indexOf("-filter_complex") + 1]
    expect(fc).toContain("transition=fadewhite")
  })
})

// ===========================================================================
// 5) xfade transitions (fade / dissolve)
// ===========================================================================

describe("combineVideos — xfade transitions", () => {
  it("fade: chains xfade across all clips with output [vout]", async () => {
    stubResolutionProbes(3)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(3, true)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"],
      transition: "fade", transitionDuration: 1, audioMode: "remove",
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    // 3 clips → 2 xfade stages
    expect(fc).toContain("[0:v][1:v]xfade=transition=fade")
    expect(fc).toContain("[v1][2:v]xfade=transition=fade")
    expect(fc).toContain("[vout]")
  })

  it("dissolve: maps to xfade transition='dissolve' (real pixel-noise dissolve, not aliased to fade)", async () => {
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      transition: "dissolve", audioMode: "remove",
    }))

    const args = lastArgs()
    expect(args[args.indexOf("-filter_complex") + 1]).toContain("transition=dissolve")
  })

  it("each new xfade transition id is forwarded verbatim into the filter graph", async () => {
    // Spot-check a representative set across all groups to prove the catalog
    // → ffmpeg mapping holds. If we add a new transition we want at least the
    // generic path (id passes through resolveXfadeName) to be covered.
    const samples = [
      ["wipe-left", "wipeleft"],
      ["slide-up", "slideup"],
      ["circle-open", "circleopen"],
      ["pixelize", "pixelize"],
      ["radial", "radial"],
      ["squeeze-h", "squeezeh"],
    ] as const

    for (const [id, xfadeName] of samples) {
      mocks.runFfmpeg.mockClear()
      stubResolutionProbes(2)
      mocks.getVideoDuration.mockResolvedValueOnce(5).mockResolvedValueOnce(5)
      stubAudioStreamProbes(2, true)

      await combineVideos(defaultOptions({ transition: id, audioMode: "remove" }))
      const args = lastArgs()
      const fc = args[args.indexOf("-filter_complex") + 1]
      expect(fc, `${id} → ${xfadeName}`).toContain(`transition=${xfadeName}`)
    }
  })

  it("clamps transition duration to 90% of shortest clip", async () => {
    // Shortest clip is 0.5s → 0.5*0.9 = 0.45s allowed.
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(0.5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      transition: "fade", transitionDuration: 5, audioMode: "remove",
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("duration=0.45")
  })

  it("uses requested transition duration when shorter than 90% of min clip", async () => {
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(10)
      .mockResolvedValueOnce(10)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      transition: "fade", transitionDuration: 0.5, audioMode: "remove",
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("duration=0.5")
  })

  it("computes xfade offset = runningDuration - transitionDuration", async () => {
    // 3 clips, all 5s, transition 1s
    // offset 0 = 5 - 1 = 4
    // offset 1 = (4 + 5) - 1 = 8
    stubResolutionProbes(3)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(3, true)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"],
      transition: "fade", transitionDuration: 1, audioMode: "remove",
    }))

    const fc = lastArgs()[lastArgs().indexOf("-filter_complex") + 1]
    expect(fc).toContain("offset=4")
    expect(fc).toContain("offset=8")
  })
})

// ===========================================================================
// 6) Audio modes
// ===========================================================================

describe("combineVideos — audioMode for xfade transitions", () => {
  it("audioMode=remove: no audio filter, -an in output", async () => {
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "remove",
    }))

    const args = lastArgs()
    expect(args).toContain("-an")
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).not.toContain("acrossfade")
    expect(fc).not.toContain("aevalsrc")
  })

  it("audioMode=crossfade: chains acrossfade alongside xfade with default linear curve", async () => {
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "crossfade", transitionDuration: 0.5,
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("acrossfade=d=0.5")
    expect(fc).toContain("c1=tri:c2=tri") // linear default
    expect(fc).toContain("[aout]")
    const mapCalls = args.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(args[i + 1])
      return acc
    }, [])
    expect(mapCalls).toContain("[vout]")
    expect(mapCalls).toContain("[aout]")
  })

  it("audioMode=crossfade: each curve id resolves to its acrossfade curve in the filter graph", async () => {
    const samples = [
      ["linear", "tri"],
      ["equal-power", "qsin"],
      ["smooth", "hsin"],
      ["logarithmic", "log"],
      ["exponential", "exp"],
    ] as const

    for (const [id, curve] of samples) {
      mocks.runFfmpeg.mockClear()
      mocks.getVideoDuration.mockResolvedValueOnce(5).mockResolvedValueOnce(5)

      await combineVideos(defaultOptions({
        transition: "fade", audioMode: "crossfade", audioCrossfadeCurve: id,
      }))

      const fc = lastArgs()[lastArgs().indexOf("-filter_complex") + 1]
      expect(fc, `${id} → ${curve}`).toContain(`c1=${curve}:c2=${curve}`)
    }
  })

  it("audioMode=crossfade: falls back to video-only when ffmpeg fails (no audio in some clips)", async () => {
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    // First merge call rejects; fallback succeeds.
    mocks.runFfmpeg
      .mockResolvedValueOnce("") // (no normalize/trim ffmpeg in this flow since trimStart=0)
      .mockRejectedValueOnce(new Error("audio crossfade failed"))
      .mockResolvedValueOnce("")

    // Wait — the flow has zero pre-merge ffmpeg calls when trimStart=0.
    // Let me reset the mock to fail on first attempt.
    mocks.runFfmpeg.mockReset()
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("audio crossfade failed"))
      .mockResolvedValueOnce("")

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "crossfade",
    }))

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)
    const fallbackArgs = mocks.runFfmpeg.mock.calls[1][0] as string[]
    expect(fallbackArgs).toContain("-an")
  })

  it("audioMode=keep: concats audio streams with concat filter", async () => {
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "keep",
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("concat=n=2:v=0:a=1[aout]")
    expect(fc).not.toContain("acrossfade")
  })

  it("audioMode=keep: generates silent placeholder for clips without audio", async () => {
    mocks.runFfprobe.mockReset()
    mocks.getVideoDuration.mockReset()

    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(3)
    // First clip has audio, second does NOT.
    // Dispatch by filePath to avoid Promise.all race between audio probes.
    mocks.runFfprobe.mockImplementation(async (probeArgs: unknown) => {
      const args = probeArgs as string[]
      const path = args[args.length - 1]
      if (path.endsWith("normalized_0.mp4")) return "audio\n"
      if (path.endsWith("normalized_1.mp4")) return ""
      return ""
    })

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "keep",
    }))

    const fc = lastArgs()[lastArgs().indexOf("-filter_complex") + 1]
    // Silent placeholder generated for clip 1 with its duration
    expect(fc).toContain("aevalsrc=0:c=stereo:s=44100:d=3")
    expect(fc).toContain("[silent_1]")
    // Concat uses [0:a] for clip 0 and [silent_1] for clip 1
    expect(fc).toContain("[0:a][silent_1]concat=n=2:v=0:a=1[aout]")
  })

  it("audioMode=keep: hasAudioStream tolerates ffprobe rejection (treated as no audio)", async () => {
    // Reset clears both call history AND any queued mockResolvedValueOnce
    // entries from prior tests that might leak through clearAllMocks.
    mocks.runFfprobe.mockReset()
    mocks.getVideoDuration.mockReset()

    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    // Both ffprobe calls reject — hasAudioStream returns false for each.
    mocks.runFfprobe.mockImplementation(async () => {
      throw new Error("ffprobe error")
    })

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "keep",
    }))

    const fc = lastArgs()[lastArgs().indexOf("-filter_complex") + 1]
    expect(fc).toContain("[silent_0]")
    expect(fc).toContain("[silent_1]")
  })
})

// ===========================================================================
// 7) Output return + cleanup
// ===========================================================================

describe("combineVideos — return + cleanup", () => {
  it("returns the workDir/output.mp4 path on success", async () => {
    const out = await combineVideos(defaultOptions({ transition: "cut" }))
    expect(out).toBe("/tmp/work/output.mp4")
  })

  it("cleans up workDir on terminal ffmpeg failure", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("xfade exploded"))
    await expect(
      combineVideos(defaultOptions({ transition: "cut" })),
    ).rejects.toThrow()
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })
})
