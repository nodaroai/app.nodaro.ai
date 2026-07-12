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
 *                      0): anchored L-cut blend (outgoing tails atempo-
 *                      stretched over the incoming fade-in; LAST clip
 *                      anchored so its sound ends WITH the video) rendered
 *                      in an audio-only pass, muxed onto STREAM-COPIED
 *                      video; xfade video: anchored afade+adelay+amix with
 *                      an independent audio fade length; video-only when
 *                      NO clip has audio
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
  // combine-videos probes VIDEO STREAM durations (audio-overhang-free);
  // tests drive both through the same mock.
  getVideoStreamDuration: mocks.getVideoDuration,
  createWorkDir: mocks.createWorkDir,
  cleanupWorkDir: mocks.cleanupWorkDir,
  normalizeVideoForCombine: mocks.normalizeVideoForCombine,
  trimEdgeFrames: mocks.trimEdgeFrames,
}))

vi.mock("node:fs", () => ({
  promises: { writeFile: mocks.fsWriteFile },
}))

const smartCutMocks = vi.hoisted(() => ({
  findSmartCutBoundary: vi.fn(),
}))
vi.mock("../smart-cut.js", () => ({
  findSmartCutBoundary: smartCutMocks.findSmartCutBoundary,
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
  smartCut?: { enabled: boolean; framesFromPrev: number; framesFromNext: number }
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
    smartCut: over.smartCut,
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
  smartCutMocks.findSmartCutBoundary.mockReset()
  smartCutMocks.findSmartCutBoundary.mockResolvedValue({ trimEndFrames: 0, trimStartFrames: 1, psnr: 30, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 })
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
// 2b) Smart cut — PSNR boundary matching replaces the fixed boundary trims
// ===========================================================================

describe("combineVideos — smart cut", () => {
  it("overrides the fixed boundary trims with the matcher's result (outer edges stay 0)", async () => {
    stubResolutionProbes(2)
    smartCutMocks.findSmartCutBoundary.mockResolvedValueOnce({ trimEndFrames: 3, trimStartFrames: 5, psnr: 34.2, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 })

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "cut",
      trimStartFrames: 1,
      trimEndFrames: 2,
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    }))

    expect(smartCutMocks.findSmartCutBoundary).toHaveBeenCalledWith(
      "/tmp/work/normalized_0.mp4", "/tmp/work/normalized_1.mp4", 8, 8,
    )
    // Fixed trims (1/2) are ignored — the boundary comes from the matcher.
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      1, "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 3,
    )
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 5, 0,
    )
  })

  it("3 clips: the middle clip combines boundary-0 start trim with boundary-1 end trim", async () => {
    stubResolutionProbes(3)
    smartCutMocks.findSmartCutBoundary
      .mockResolvedValueOnce({ trimEndFrames: 2, trimStartFrames: 4, psnr: 31, matched: true, searchedPrevFrames: 12, searchedNextFrames: 10 })
      .mockResolvedValueOnce({ trimEndFrames: 6, trimStartFrames: 1, psnr: 29, matched: true, searchedPrevFrames: 12, searchedNextFrames: 10 })

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"],
      transition: "cut",
      smartCut: { enabled: true, framesFromPrev: 12, framesFromNext: 10 },
    }))

    expect(smartCutMocks.findSmartCutBoundary).toHaveBeenCalledTimes(2)
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      1, "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 2,
    )
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 4, 6,
    )
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      3, "/tmp/work/normalized_2.mp4", "/tmp/work/trimmed_2.mp4", 1, 0,
    )
  })

  it("below-threshold best pair (matched:false): the boundary keeps the FIXED trims and reports them", async () => {
    stubResolutionProbes(2)
    smartCutMocks.findSmartCutBoundary.mockResolvedValueOnce({
      trimEndFrames: 5, trimStartFrames: 7, psnr: 12.3, matched: false, searchedPrevFrames: 8, searchedNextFrames: 8,
    })

    const out = await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "cut",
      trimStartFrames: 1,
      trimEndFrames: 2,
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    }))

    // The matcher's below-threshold values are NOT applied — the user's
    // fixed trims are.
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      1, "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 2,
    )
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 1, 0,
    )
    expect(out.smartCuts).toEqual([
      { boundary: 0, prevClipEndTrimFrames: 2, nextClipStartTrimFrames: 1, psnrDb: 12.3, matched: false, searchedPrevFrames: 8, searchedNextFrames: 8 },
    ])
  })

  it("a failed boundary search keeps that boundary's fixed trims (best effort)", async () => {
    stubResolutionProbes(2)
    smartCutMocks.findSmartCutBoundary.mockRejectedValueOnce(new Error("probe failed"))

    await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "cut",
      trimStartFrames: 1,
      trimEndFrames: 2,
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    }))

    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      1, "/tmp/work/normalized_0.mp4", "/tmp/work/trimmed_0.mp4", 0, 2,
    )
    expect(mocks.trimEdgeFrames).toHaveBeenNthCalledWith(
      2, "/tmp/work/normalized_1.mp4", "/tmp/work/trimmed_1.mp4", 1, 0,
    )
  })

  it("disabled (default): the matcher never runs", async () => {
    stubResolutionProbes(2)
    await combineVideos(defaultOptions({ videoUrls: ["a.mp4", "b.mp4"], transition: "cut" }))
    expect(smartCutMocks.findSmartCutBoundary).not.toHaveBeenCalled()
  })

  it("reports every boundary's applied cut in the result (per-junction values)", async () => {
    stubResolutionProbes(3)
    smartCutMocks.findSmartCutBoundary
      .mockResolvedValueOnce({ trimEndFrames: 2, trimStartFrames: 4, psnr: 31.456, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 })
      .mockResolvedValueOnce({ trimEndFrames: 0, trimStartFrames: 1, psnr: Infinity, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 })

    const out = await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4", "c.mp4"],
      transition: "cut",
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    }))

    expect(out.smartCuts).toEqual([
      { boundary: 0, prevClipEndTrimFrames: 2, nextClipStartTrimFrames: 4, psnrDb: 31.46, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 },
      // Infinity (pixel-identical) is JSON-unsafe — reported as 100.
      { boundary: 1, prevClipEndTrimFrames: 0, nextClipStartTrimFrames: 1, psnrDb: 100, matched: true, searchedPrevFrames: 8, searchedNextFrames: 8 },
    ])
  })

  it("a failed boundary is reported with the fixed trims it fell back to and psnrDb null", async () => {
    stubResolutionProbes(2)
    smartCutMocks.findSmartCutBoundary.mockRejectedValueOnce(new Error("probe failed"))

    const out = await combineVideos(defaultOptions({
      videoUrls: ["a.mp4", "b.mp4"],
      transition: "cut",
      trimStartFrames: 1,
      trimEndFrames: 2,
      smartCut: { enabled: true, framesFromPrev: 8, framesFromNext: 8 },
    }))

    expect(out.smartCuts).toEqual([
      { boundary: 0, prevClipEndTrimFrames: 2, nextClipStartTrimFrames: 1, psnrDb: null, matched: false, searchedPrevFrames: null, searchedNextFrames: null },
    ])
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

  it("cut + audioMode=crossfade: anchored L-cut blend in an audio-only pass, muxed onto STREAM-COPIED video", async () => {
    // Design history (do not regress): #3307's fade-through-silence sounded
    // like a dropout at every boundary; the overlapping acrossfade chain
    // that replaced it made audio lead video AND ended the last clip's
    // sound (n-1)*d early (silence at the very end — user bug report).
    // The L-cut graph fixes all of it: every clip's audio starts ON its
    // video cut, outgoing tails are atempo-stretched to linger d past the
    // cut under the incoming fade-in, and the LAST clip is untouched and
    // anchored — it ends exactly with the video. The video itself is
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

    // Pass 1: audio-only anchored L-cut graph at the pinned uniform params.
    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    // Outgoing clip: stretched 5s→5.5s (ratio 0.909091), fades out over the
    // 0.5s that lingers past its cut. No delay (starts at 0).
    expect(fc).toContain("[0:a]atempo=0.909091,afade=t=out:st=5:d=0.5:curve=tri[ca0]")
    // Incoming/last clip: anchored at its video cut (5s), fades in, is NOT
    // stretched and has NO fade-out — it ends exactly with the video.
    expect(fc).toContain("[1:a]afade=t=in:st=0:d=0.5:curve=tri,adelay=5000:all=1[ca1]")
    expect(fc).toContain("[ca0][ca1]amix=inputs=2:normalize=0:duration=longest[aout]")
    expect(fc).not.toContain("acrossfade")
    expect(fc).not.toContain("apad")
    expect(audioArgs[audioArgs.indexOf("-map") + 1]).toBe("[aout]")
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

  it("cut + crossfade with a very short clip: fade clamps to 90% of the shortest clip, keeping atempo above its 0.5 floor", async () => {
    stubResolutionProbes(2)
    stubAudioStreamProbes(2, true)
    mocks.getVideoDuration
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(5)

    await combineVideos(defaultOptions({
      transition: "cut",
      audioMode: "crossfade",
      transitionDuration: 0,
      audioCrossfadeDuration: 5, // way beyond the 1s clip — must clamp to 0.9
    }))

    const audioArgs = ffargs(0)
    const fc = audioArgs[audioArgs.indexOf("-filter_complex") + 1]
    // ratio = 1 / (1 + 0.9) = 0.526316 — above atempo's 0.5 minimum by
    // construction (clamp ≤ 0.9·minDur ⇒ ratio ≥ 1/1.9).
    expect(fc).toContain("atempo=0.526316")
    expect(fc).toContain("afade=t=out:st=1:d=0.9")
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
    // 5s clip stretched to 6.5s (ratio 0.769231); fades run 1.5s.
    expect(fc).toContain("atempo=0.769231")
    expect(fc).toContain("afade=t=out:st=5:d=1.5")
    expect(fc).toContain("afade=t=in:st=0:d=1.5")
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
    expect(fc).toContain("afade=t=out:st=5:d=1")
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

  it("cut + crossfade with 3 clips: middle clip stretches, fades both ways, and is anchored; last clip only fades in", async () => {
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
    // Middle clip (4s → 4.5s, ratio 0.888889): anchored at 5s, both fades.
    expect(fc).toContain("[1:a]atempo=0.888889,afade=t=out:st=4:d=0.5:curve=tri,afade=t=in:st=0:d=0.5:curve=tri,adelay=5000:all=1[ca1]")
    // Last clip: anchored at 9s (5+4), fade-in only, no stretch, no fade-out.
    expect(fc).toContain("[2:a]afade=t=in:st=0:d=0.5:curve=tri,adelay=9000:all=1[ca2]")
    expect(fc).toContain("[ca0][ca1][ca2]amix=inputs=3:normalize=0:duration=longest[aout]")
    expect(fc).not.toContain("acrossfade")
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
    expect(out.outputPath).toBe("/tmp/work/output.mp4")
    expect(out.smartCuts).toBeUndefined()
  })

  it("cleans up workDir on terminal ffmpeg failure", async () => {
    mocks.runFfmpeg.mockRejectedValueOnce(new Error("xfade exploded"))
    await expect(
      combineVideos(defaultOptions({ transition: "cut" })),
    ).rejects.toThrow()
    expect(mocks.cleanupWorkDir).toHaveBeenCalled()
  })
})
