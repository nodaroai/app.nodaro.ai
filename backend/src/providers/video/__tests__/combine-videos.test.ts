/**
 * combineVideos tests.
 *
 * combine-videos.ts is the most logic-dense video wrapper. Beyond the
 * standard download+normalize+trim flow it owns:
 *
 *   - Cut transition (concat demuxer with stream-copy)
 *   - xfade transition family (fade/dissolve/dip-to-black/dip-to-white)
 *     with chained xfade filter graph
 *   - Up-front audio probe of every clip (skipped for "remove"): a MIXED
 *     set (some clips with audio, some without) gets silent AAC tracks
 *     injected into the soundless clips so every join strategy sees
 *     uniform stream layouts — concat -c copy otherwise silently ends the
 *     audio track at the first soundless segment.
 *   - Audio handling per audioMode (audioCrossfadeDuration is an
 *     AUDIO-ONLY knob — it must never alter the video stream):
 *       "remove"    → -an
 *       "crossfade" → hard-cut video (cut, or any transition at duration
 *                      0): overlapping acrossfade rendered in an audio-only
 *                      pass, muxed onto STREAM-COPIED video; xfade video:
 *                      anchored afade+adelay+amix with an independent audio
 *                      fade length; video-only when NO clip has audio
 *       "keep"      → adelay+amix anchored to each clip's video start;
 *                      video-only when NO clip has audio
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
  // Pass-through by default (mirrors normalizeVideoForCombine's default
  // above): trimEdgeFrames's own probe/skip/re-encode math is unit-tested in
  // ffmpeg-utils.test.ts. Here we only verify combine-videos.ts's delegation
  // — which (input, output, effStart, effEnd) it calls with per clip
  // position, and that it uses the returned path downstream.
  const trimEdgeFrames = vi.fn(async (input: string) => input)
  const fsWriteFile = vi.fn().mockResolvedValue(undefined)
  return {
    downloadFile, runFfmpeg, runFfprobe, getVideoDuration,
    createWorkDir, cleanupWorkDir, normalizeVideoForCombine, trimEdgeFrames, fsWriteFile,
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
  trimEdgeFrames: mocks.trimEdgeFrames,
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
  audioCrossfadeDuration?: number
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
    audioCrossfadeDuration: over.audioCrossfadeDuration,
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
  // mockReset (not just clear) drains mockResolvedValueOnce queues left by
  // tests whose flow didn't consume every stub — audio-mode gating is
  // probe-driven, so a leaked stub would silently flip a branch.
  mocks.runFfprobe.mockReset()
  mocks.runFfprobe.mockResolvedValue("")
  mocks.getVideoDuration.mockReset()
  mocks.getVideoDuration.mockResolvedValue(5)
  mocks.normalizeVideoForCombine.mockImplementation(async (_in: string, out: string) => out)
  mocks.trimEdgeFrames.mockImplementation(async (input: string) => input)
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
// 2) Frame-trim delegation (trimEdgeFrames, shared with assemble-narrated-
//    video.ts — its own probe/skip/re-encode math is unit-tested in
//    ffmpeg-utils.test.ts). combine-videos.ts's own responsibility is just
//    computing the per-clip effective (start, end) frame counts — protecting
//    the first clip's start and the last clip's end — and forwarding the
//    right paths.
// ===========================================================================

describe("combineVideos — frame trim (delegates to trimEdgeFrames)", () => {
  it("protects first clip's start and last clip's end (2-clip case)", async () => {
    stubResolutionProbes(2)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      trimStartFrames: 30,
      trimEndFrames: 30,
      transition: "cut",
    }))

    // Clip 0 (first): start protected → effStart=0, effEnd=30.
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      1, "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 30,
    )
    // Clip 1 (last): end protected → effStart=30, effEnd=0.
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 30, 0,
    )
  })

  it("middle clips get both start and end trim frames forwarded (3-clip case)", async () => {
    stubResolutionProbes(3)

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"],
      trimStartFrames: 30,
      trimEndFrames: 30,
      transition: "cut",
    }))

    // Clip 1 is the middle clip — no boundary protection, both ends forwarded.
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 30, 30,
    )
  })

  it("still delegates with (0, 0) when no trim is configured (helper owns the no-op)", async () => {
    stubResolutionProbes(1)

    await combineVideos(defaultOptions({ videoUrls: ["a.mp4"], transition: "cut" }))

    expect(mocks.trimEdgeFrames).toHaveBeenCalledWith(
      "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 0,
    )
    // Pass-through default → no extra ffmpeg call beyond the concat.
    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("uses trimEdgeFrames's returned path downstream (concat filelist)", async () => {
    stubResolutionProbes(1)
    mocks.trimEdgeFrames.mockResolvedValueOnce("/tmp/work/CUSTOM_trimmed_0.mp4")

    await combineVideos(defaultOptions({ videoUrls: ["a.mp4"], transition: "cut" }))

    const listContent = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(listContent).toContain("CUSTOM_trimmed_0.mp4")
  })

  it("logs a skip notice when trimEdgeFrames returns the input unchanged for a requested trim", async () => {
    stubResolutionProbes(2)
    // Simulate the helper's exceeds-duration skip: returns the SAME path it
    // was given instead of a freshly trimmed one.
    mocks.trimEdgeFrames.mockImplementation(async (input: string) => input)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      trimStartFrames: 30,
      trimEndFrames: 30,
      transition: "cut",
    }))

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Trim would exceed clip 0"))
    logSpy.mockRestore()
  })

  it("does NOT log a skip notice when no trim was requested (0,0 pass-through is not a skip)", async () => {
    stubResolutionProbes(1)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    await combineVideos(defaultOptions({ videoUrls: ["a.mp4"], transition: "cut" }))

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Trim would exceed"))
    logSpy.mockRestore()
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

  it("cut + audioMode=crossfade: overlapping acrossfade in an audio-only pass, muxed onto STREAM-COPIED video", async () => {
    // Deliberate reversal of PR #3307 (2026-07-12, user decision): the
    // overlapping blend is the point of "crossfade" — fading through
    // silence at every cut sounded broken. The accepted tradeoff (audio
    // leads video by d per boundary) is imperceptible on the ambient/music
    // tracks AI clips carry. What #3307 rightly demanded — and this keeps —
    // is that audio settings never alter the VIDEO stream: the video is
    // stream-copied byte-identical to the plain-cut fast path.
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0.5,
    }))

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(2)

    // Pass 1: audio-only — overlapping acrossfade chain, padded back to the
    // full video length, encoded at the pinned uniform params.
    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    expect(fc).toContain("[0:a][1:a]acrossfade=d=0.5:c1=tri:c2=tri[aout]")
    expect(fc).toContain("apad=whole_dur=10")
    expect(fc).not.toContain("concat")
    expect(fc).not.toContain("xfade")
    expect(audioArgs[audioArgs.indexOf("-map") + 1]).toBe("[aoutp]")
    expect(audioArgs[audioArgs.indexOf("-ar") + 1]).toBe("44100")
    expect(audioArgs[audioArgs.length - 1]).toBe("/tmp/work/blended_audio.m4a")

    // Pass 2: concat demuxer video (STREAM COPY — no re-encode) + blended track.
    const muxArgs = lastArgs()
    expect(muxArgs[muxArgs.indexOf("-f") + 1]).toBe("concat")
    expect(muxArgs).toContain("/tmp/work/blended_audio.m4a")
    expect(muxArgs[muxArgs.indexOf("-c") + 1]).toBe("copy")
    expect(muxArgs).not.toContain("libx264")
    expect(muxArgs).not.toContain("-filter_complex")
    const mapCalls = muxArgs.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(muxArgs[i + 1])
      return acc
    }, [])
    expect(mapCalls).toEqual(["0:v", "1:a"])
  })

  it("cut + crossfade: audioCrossfadeDuration overrides transitionDuration for the blend length", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0,
      audioCrossfadeDuration: 1.5,
    }))

    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    expect(fc).toContain("acrossfade=d=1.5")
  })

  it("fade transition at duration 0 IS a hard cut: stream-copied video + overlapping audio blend", async () => {
    // Regression (job bf65be3b): fade+0 used to build xfade/acrossfade with
    // d=0, which errored into the video-only fallback — the output lost ALL
    // audio. duration 0 must route through the hard-cut machinery.
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade",
      audioMode: "crossfade",
      transitionDuration: 0,
      audioCrossfadeDuration: 1,
    }))

    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    expect(fc).toContain("acrossfade=d=1")
    expect(fc).not.toContain("xfade")
    const muxArgs = lastArgs()
    expect(muxArgs[muxArgs.indexOf("-f") + 1]).toBe("concat")
    expect(muxArgs).not.toContain("libx264")
  })

  it("cut + crossfade with transitionDuration 0 degenerates to the stream-copy fast path", async () => {
    // d=0 fades are a plain cut; previously acrossfade d=0 errored and only
    // the catch-fallback produced output (job b17b3b86). Audio present on
    // both clips so the fast path is chosen by d=0 alone.
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0,
    }))
    const args = lastArgs()
    expect(args).toContain("-f")
    expect(args[args.indexOf("-f") + 1]).toBe("concat")
    expect(args).toContain("-c")
    expect(args).not.toContain("-filter_complex")
  })

  it("cut + crossfade when NO clip has audio: stream-copy fast path, no filter attempt", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, false)

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0.5,
    }))

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
    const args = lastArgs()
    expect(args[args.indexOf("-f") + 1]).toBe("concat")
    expect(args).not.toContain("-filter_complex")
  })

  it("cut + keep with a MIXED set: injects a silent track so concat -c copy can't drop audio mid-video", async () => {
    // Empirically proven corruption: concat demuxer stream-copy with one
    // soundless segment ends the output's audio track at that boundary —
    // the rest of the video plays MUTE (no error). The soundless clip must
    // get a silent AAC track before the filelist is written.
    mocks.runFfprobe.mockReset()
    mocks.runFfprobe.mockImplementation(async (probeArgs: unknown) => {
      const args = probeArgs as string[]
      const path = args[args.length - 1]
      if (path.endsWith("normalized_0.mp4")) return "audio\n"
      if (path.endsWith("normalized_1.mp4")) return ""
      return "1280x720" // resolution probes
    })

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "keep",
    }))

    // First ffmpeg call = the injection remux for clip 1.
    const injectArgs = ffargs(0)
    expect(injectArgs.join(" ")).toContain("anullsrc=channel_layout=stereo:sample_rate=44100")
    expect(injectArgs).toContain("-shortest")
    expect(injectArgs[injectArgs.indexOf("-c:v") + 1]).toBe("copy")
    expect(injectArgs[injectArgs.indexOf("-i") + 1]).toBe("/tmp/work/normalized_1.mp4")
    expect(injectArgs[injectArgs.length - 1]).toBe("/tmp/work/silenced_1.mp4")

    // Filelist references the silenced file, not the audio-less original.
    const list = mocks.fsWriteFile.mock.calls[0][1] as string
    expect(list).toContain("file '/tmp/work/normalized_0.mp4'")
    expect(list).toContain("file '/tmp/work/silenced_1.mp4'")
    expect(list).not.toContain("normalized_1.mp4")
  })

  it("cut + crossfade with 3 clips: chained acrossfade across every boundary", async () => {
    stubResolutionProbes(3)
    stubAudioStreamProbes(3, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(4)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      videoUrls: ["https://r2/a.mp4", "https://r2/b.mp4", "https://r2/c.mp4"],
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0.5,
    }))

    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    expect(fc).toContain("[0:a][1:a]acrossfade=d=0.5:c1=tri:c2=tri[a1]")
    expect(fc).toContain("[a1][2:a]acrossfade=d=0.5:c1=tri:c2=tri[aout]")
    expect(fc).toContain("apad=whole_dur=14")
  })

  it("cut + audioMode=crossfade: falls back to concat demuxer when filter fails (safety net)", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    // First ffmpeg call (the filter-graph attempt) rejects; fallback succeeds.
    mocks.runFfmpeg
      .mockRejectedValueOnce(new Error("acrossfade failed: probe missed"))
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

  it("audioMode=crossfade: anchored afade+adelay+amix alongside xfade (default linear curve)", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "crossfade", transitionDuration: 0.5,
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    // Each clip's audio is ANCHORED at its video start (sync-safe no matter
    // the audio fade length): clip 1's video starts at 5-0.5=4.5s.
    expect(fc).toContain("[0:a]afade=t=out:st=4.5:d=0.5:curve=tri[xa0]")
    expect(fc).toContain("[1:a]afade=t=in:st=0:d=0.5:curve=tri,adelay=4500:all=1[xa1]")
    expect(fc).toContain("[xa0][xa1]amix=inputs=2:normalize=0:duration=longest[aout]")
    expect(fc).not.toContain("acrossfade")
    const mapCalls = args.reduce<string[]>((acc, a, i) => {
      if (a === "-map") acc.push(args[i + 1])
      return acc
    }, [])
    expect(mapCalls).toContain("[vout]")
    expect(mapCalls).toContain("[aout]")
  })

  it("audioMode=crossfade + xfade: audio fade length decouples from the video fade (video untouched)", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade",
      audioMode: "crossfade",
      transitionDuration: 0.5,
      audioCrossfadeDuration: 2,
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    // Video fade stays 0.5s — the audio knob must not touch it.
    expect(fc).toContain("xfade=transition=fade:duration=0.5:offset=4.5")
    // Audio fades run 2s, still anchored at the 4.5s video start.
    expect(fc).toContain("[0:a]afade=t=out:st=3:d=2:curve=tri[xa0]")
    expect(fc).toContain("[1:a]afade=t=in:st=0:d=2:curve=tri,adelay=4500:all=1[xa1]")
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
      stubResolutionProbes(2)
      stubAudioStreamProbes(2, true)
      mocks.getVideoDuration.mockResolvedValueOnce(5).mockResolvedValueOnce(5)

      await combineVideos(defaultOptions({
        transition: "fade", audioMode: "crossfade", audioCrossfadeCurve: id,
      }))

      const fc = lastArgs()[lastArgs().indexOf("-filter_complex") + 1]
      expect(fc, `${id} → ${curve}`).toContain(`curve=${curve}`)
    }
  })

  it("audioMode=crossfade: falls back to video-only when ffmpeg fails (probe missed a bad stream)", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    // First merge call (the crossfade attempt) rejects; fallback succeeds.
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

  it("audioMode=crossfade: when NO clip has audio, emits video-only in ONE pass (no doomed attempt)", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, false)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "crossfade",
    }))

    expect(mocks.runFfmpeg).toHaveBeenCalledTimes(1)
    const args = lastArgs()
    expect(args).toContain("-an")
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("xfade=")
    expect(fc).not.toContain("acrossfade")
  })

  it("audioMode=keep: delays each clip's audio to its xfaded video start and mixes (no late concat)", async () => {
    // Regression 2026-06-11: xfade compresses the video timeline by D per
    // boundary, but keep-audio used a plain concat — clip N's audio ran
    // (N-1)*D seconds LATE. Each clip's audio must start where its video
    // starts: adelay to the xfade offset, then amix (overlaps mix tails).
    stubResolutionProbes(2)
    mocks.getVideoDuration
      .mockResolvedValueOnce(5)
      .mockResolvedValueOnce(5)
    stubAudioStreamProbes(2, true)

    await combineVideos(defaultOptions({
      transition: "fade", audioMode: "keep", transitionDuration: 1,
    }))

    const args = lastArgs()
    const fc = args[args.indexOf("-filter_complex") + 1]
    // clip 0 starts at 0 (no delay); clip 1 starts at 5-1 = 4s
    expect(fc).toContain("[0:a]anull[ka0]")
    expect(fc).toContain("[1:a]adelay=4000:all=1[ka1]")
    expect(fc).toContain("[ka0][ka1]amix=inputs=2:normalize=0:duration=longest[aout]")
    expect(fc).not.toContain("concat=n=2:v=0:a=1")
    expect(fc).not.toContain("acrossfade")
  })

  it("audioMode=keep: a soundless clip in a mixed set gets a silent track injected, then joins the mix", async () => {
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
      transition: "fade", audioMode: "keep", transitionDuration: 1,
    }))

    // Injection remux ran for clip 1 before the merge.
    const injectArgs = ffargs(0)
    expect(injectArgs.join(" ")).toContain("anullsrc")
    expect(injectArgs[injectArgs.length - 1]).toBe("/tmp/work/silenced_1.mp4")

    // Merge inputs reference the silenced file; BOTH clips are in the mix,
    // anchored to their video starts (5s clip, 1s overlap → 4000ms delay).
    const args = lastArgs()
    expect(args).toContain("/tmp/work/silenced_1.mp4")
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).not.toContain("aevalsrc")
    expect(fc).toContain("[0:a]anull[ka0]")
    expect(fc).toContain("[1:a]adelay=4000:all=1[ka1]")
    expect(fc).toContain("amix=inputs=2:normalize=0:duration=longest[aout]")
  })

  it("audioMode=keep: when NO clip has audio (probe rejections), emits video-only with -an", async () => {
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

    const args = lastArgs()
    expect(args).toContain("-an")
    expect(args).not.toContain("[aout]")
    const fc = args[args.indexOf("-filter_complex") + 1]
    expect(fc).toContain("xfade=")
    expect(fc).not.toContain("amix")
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
