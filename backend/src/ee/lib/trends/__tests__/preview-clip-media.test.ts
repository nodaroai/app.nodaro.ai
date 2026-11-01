// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * Making the preview's input clip (ee/lib/trends/preview-clip-media.ts).
 *
 * What must hold:
 *  - the clip is cut from the downloaded source by FRAME INDEX (its rate and
 *    frames probed; the frame nearest the start, then the window's frames;
 *    no seek, a `trim` by frame number, the sound alongside by `atrim`) and a
 *    re-encode, no scaling and no `-r`, into a NEW file under
 *    `trends/<trendId>/<uuid>.mp4`, with exactly the frames asked for and its
 *    frame count, size, length and SHA-256 measured from the file stored;
 *  - the face mask, when given, is cut at the SAME frames (the picture's
 *    arguments identical) and its frame count must equal the clip's, else
 *    nothing is stored — even when its timestamps are another time base's
 *    (where a cut by time gave 120 frames against 119);
 *  - a source that cannot be measured, or a clip ffmpeg cannot cut, is
 *    `media_unreadable`, a download that fails `download_failed`, a killed
 *    launch is thrown as it is; nothing stored;
 *  - `ensurePreviewClip` makes the clip only when the draft needs one, drops
 *    it when no preview is offered, keeps a current one, and re-uses one made
 *    moments ago when it still fits.
 *
 * The download and the upload are stubbed; the real ffmpeg tests run only
 * where ffmpeg and ffprobe are on PATH.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { VIDEO_MASK_RECIPE } from "@nodaro/shared/media"

const uploads = vi.hoisted(() => ({
  keepDir: "",
  list: [] as Array<{ key: string; contentType: string; kept: string }>,
}))

const fetches = vi.hoisted(() => ({
  /** URL → the local fixture copied in its place (a URL not listed fails the download). */
  files: new Map<string, string>(),
  calls: [] as string[],
}))

vi.mock("../../../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/storage.js")>()
  const { copyFile: copy } = await import("node:fs/promises")
  const { join: joinPath } = await import("node:path")
  return {
    ...actual,
    uploadFileWithKeyToR2: vi.fn(async (file: string, key: string, contentType: string) => {
      const kept = joinPath(uploads.keepDir, key.replaceAll("/", "_"))
      await copy(file, kept)
      uploads.list.push({ key, contentType, kept })
      return `https://cdn.test/${key}`
    }),
  }
})

vi.mock("../../../../providers/video/ffmpeg-utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../providers/video/ffmpeg-utils.js")>()
  const { copyFile: copy } = await import("node:fs/promises")
  return {
    ...actual,
    downloadFile: vi.fn(async (url: string, dest: string) => {
      fetches.calls.push(url)
      const from = fetches.files.get(url)
      if (!from) throw new Error(`fetch failed: ${url}`)
      await copy(from, dest)
    }),
    runFfmpeg: vi.fn(actual.runFfmpeg),
    probeVideoSource: vi.fn(actual.probeVideoSource),
    probeVideoFrameCount: vi.fn(actual.probeVideoFrameCount),
    runFfprobe: vi.fn(actual.runFfprobe),
  }
})

import { probeVideoFrameCount, probeVideoSource, runFfmpeg, runFfprobe } from "../../../../providers/video/ffmpeg-utils.js"
import { TrendMediaError } from "../media.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { PREVIEW_CLIP_RECIPE } from "../preview-clip.js"
import { cutFrameRate, ensurePreviewClip, makePreviewClip, parseCutTimeline, previewClipArgs, previewCutAudio } from "../preview-clip-media.js"
import type { TrendFaceMask, TrendPreviewClip, TrendVersionData } from "../types.js"

const TREND = "00000000-0000-4000-8000-0000000000a1"
const SRC = "https://cdn.test/trends/t1/src.mp4"
const MASK = "https://cdn.test/trends/t1/mask.mp4"
const KEY_RE = new RegExp(`^https://cdn\\.test/trends/${TREND}/[0-9a-f-]{36}\\.mp4$`)
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex")

let sandbox = ""
let sourceFixture = ""
let maskFixture = ""
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "trend-preview-clip-test-"))
  uploads.keepDir = await mkdtemp(join(sandbox, "kept-"))
  sourceFixture = join(sandbox, "source.bin")
  maskFixture = join(sandbox, "mask.bin")
  await writeFile(sourceFixture, "the source clip's bytes")
  await writeFile(maskFixture, "the face mask's bytes")
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})
beforeEach(() => {
  uploads.list = []
  fetches.calls = []
  fetches.files = new Map([[SRC, sourceFixture], [MASK, maskFixture]])
  vi.mocked(runFfmpeg).mockReset()
  vi.mocked(probeVideoSource).mockReset()
  vi.mocked(probeVideoFrameCount).mockReset()
  vi.mocked(runFfprobe).mockReset()
})

/**
 * The stubbed ffmpeg world: a source of `frames` frames at `fps` (with sound
 * unless `audio` is false), a mask of `maskFrames` (default: the source's),
 * and cuts that write a file named by their arguments and keep the frames the
 * trim asked for that the input has.
 */
const world = {
  fps: 30 as number | undefined,
  frames: 360,
  maskFrames: undefined as number | undefined,
  audio: true,
  videoStart: 0,
  /** Output path → the frames its cut kept. */
  cuts: new Map<string, number>(),
}

const isSource = (p: string) => p.endsWith("/source")
const isMask = (p: string) => p.endsWith("/mask")
const trimOf = (args: readonly string[]) => {
  const m = /trim=start_frame=(\d+):end_frame=(\d+)/.exec(args[args.indexOf("-vf") + 1] ?? "")
  return m ? { from: Number(m[1]), to: Number(m[2]) } : undefined
}

function stubWorld(over: Partial<Omit<typeof world, "cuts">> = {}) {
  Object.assign(world, { fps: 30, frames: 360, maskFrames: undefined, audio: true, videoStart: 0 }, over)
  world.cuts = new Map()
  vi.mocked(runFfmpeg).mockImplementation(async (args) => {
    const input = args[args.indexOf("-i") + 1]!
    const out = args.at(-1)!
    await writeFile(out, `cut of ${input}: ${args.join(" ")}`)
    const trim = trimOf(args)
    const has = isMask(input) ? (world.maskFrames ?? world.frames) : world.frames
    world.cuts.set(out, trim ? Math.max(0, Math.min(trim.to, has) - trim.from) : has)
    return ""
  })
  vi.mocked(probeVideoSource).mockImplementation(async (p) => {
    const rate = world.fps ?? 30
    if (isSource(p)) return { width: 720, height: 1280, durationSeconds: world.frames / rate, ...(world.fps ? { fps: world.fps } : {}) }
    return { width: 720, height: 1280, durationSeconds: (world.cuts.get(p) ?? 0) / rate, fps: rate }
  })
  vi.mocked(probeVideoFrameCount).mockImplementation(async (p) => {
    if (isSource(p)) return world.frames
    if (isMask(p)) return world.maskFrames ?? world.frames
    const n = world.cuts.get(p)
    if (!n) throw new Error(`Could not count the video frames of: ${p}`)
    return n
  })
  vi.mocked(runFfprobe).mockImplementation(async () =>
    JSON.stringify({
      streams: [{ codec_type: "video", start_time: String(world.videoStart) }, ...(world.audio ? [{ codec_type: "audio", start_time: "0.000000" }] : [])],
      format: { start_time: "0.000000" },
    }),
  )
}

const joined = (args: readonly string[]) => args.join(" ")
const cutRuns = () => vi.mocked(runFfmpeg).mock.calls.map((c) => c[0])
const flag = (args: readonly string[], name: string) => args[args.indexOf(name) + 1]

describe("previewClipArgs", () => {
  it("cuts by FRAME INDEX: no seek, a trim by frame number, every frame kept, re-encoded near-lossless with no scaling and no -r, faststart", () => {
    const args = previewClipArgs("/in/src.mp4", { startFrame: 48, frameCount: 120, audio: { startSec: 2, durationSec: 5 } }, "/out/clip.mp4")
    expect(args).toEqual([
      "-y", "-i", "/in/src.mp4",
      "-map", "0:v:0", "-map", "0:a:0",
      "-vf", "trim=start_frame=48:end_frame=168,setpts=PTS-STARTPTS",
      "-af", "atrim=start=2.000000:duration=5.000000,asetpts=PTS-STARTPTS",
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      "/out/clip.mp4",
    ])
    expect(args).not.toContain("-ss")
    expect(args).not.toContain("-t")
    expect(joined(args)).not.toMatch(/scale|-r /)
  })

  it("with no sound asked for: the picture alone (-an), the same picture arguments", () => {
    const withSound = previewClipArgs("/in/a.mp4", { startFrame: 7, frameCount: 120, audio: { startSec: 7 / 24, durationSec: 5 } }, "/out/a.mp4")
    const picture = previewClipArgs("/in/b.mp4", { startFrame: 7, frameCount: 120 }, "/out/b.mp4")
    expect(picture).toContain("-an")
    expect(joined(picture)).not.toMatch(/0:a|atrim|-c:a|aac/)
    expect(flag(picture, "-vf")).toBe(flag(withSound, "-vf"))
    // The sound's start to the microsecond: 7/24 s is never rounded to a millisecond.
    expect(flag(withSound, "-af")).toBe("atrim=start=0.291667:duration=5.000000,asetpts=PTS-STARTPTS")
  })
})

describe("the cut's numbers (pure)", () => {
  it("parseCutTimeline: the picture's offset from the file's start, and whether there is sound", () => {
    const json = (streams: unknown[], start = "0.000000") => JSON.stringify({ streams, format: { start_time: start } })
    expect(parseCutTimeline(json([{ codec_type: "video", start_time: "0.000000" }, { codec_type: "audio", start_time: "0.000000" }]))).toEqual({ videoOffsetSec: 0, hasAudio: true })
    expect(parseCutTimeline(json([{ codec_type: "audio", start_time: "0.000000" }, { codec_type: "video", start_time: "0.041667" }]))).toEqual({ videoOffsetSec: 0.041667, hasAudio: true })
    // The file starts where its earliest stream does: never a negative offset; unknown starts are 0.
    expect(parseCutTimeline(json([{ codec_type: "video", start_time: "0.000000" }], "0.021000")).videoOffsetSec).toBe(0)
    expect(parseCutTimeline(json([{ codec_type: "video" }]))).toEqual({ videoOffsetSec: 0, hasAudio: false })
    expect(() => parseCutTimeline(json([{ codec_type: "audio" }]))).toThrow(/video/)
    expect(() => parseCutTimeline("not json")).toThrow()
  })

  it("previewCutAudio: the sound from where the first frame falls, for as long as the frames last", () => {
    expect(previewCutAudio({ startFrame: 191, frameCount: 120 }, 24, 0)).toEqual({ startSec: 191 / 24, durationSec: 5 })
    expect(previewCutAudio({ startFrame: 24, frameCount: 96 }, 24, 0.5)).toEqual({ startSec: 1.5, durationSec: 4 })
  })

  it("cutFrameRate: the constant rate, else frames over the video's length, else none", () => {
    expect(cutFrameRate({ fps: 24, durationSeconds: 29 }, 695)).toBe(24)
    expect(cutFrameRate({ durationSeconds: 30, videoDurationSeconds: 28.958333 }, 695)).toBeCloseTo(24, 4)
    expect(cutFrameRate({ durationSeconds: 10 }, 300)).toBe(30)
    expect(cutFrameRate({ durationSeconds: 0 }, 300)).toBeUndefined()
    expect(cutFrameRate({ fps: Number.NaN, durationSeconds: Number.NaN }, 300)).toBeUndefined()
  })
})

describe("makePreviewClip (ffmpeg stubbed)", () => {
  it("downloads the source, measures it, cuts its frames by index (and the sound alongside) admitted at its canvas, measures the cut, hashes and uploads it under the trend's key", async () => {
    stubWorld({ fps: 30, frames: 360 })

    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 })

    expect(fetches.calls).toEqual([SRC])
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    const [args, , launch] = vi.mocked(runFfmpeg).mock.calls[0]!
    expect(args.slice(0, 3)).toEqual(["-y", "-i", expect.stringMatching(/\/source$/)])
    // 2 s × 30 fps = frame 60; 5 s × 30 fps = 150 frames; the sound from 2 s for 5 s.
    expect(flag(args, "-vf")).toBe("trim=start_frame=60:end_frame=210,setpts=PTS-STARTPTS")
    expect(flag(args, "-af")).toBe("atrim=start=2.000000:duration=5.000000,asetpts=PTS-STARTPTS")
    expect(joined(args)).toContain("-fps_mode passthrough -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart")
    expect(args.at(-1)!.endsWith("clip.mp4")).toBe(true)
    expect(launch?.peakMemoryMiB).toBeGreaterThan(0)
    // The source is measured (rate, frames, timeline), then the cut: its numbers are the cut's, never the source's.
    expect(probeVideoSource).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/source$/))
    expect(probeVideoFrameCount).toHaveBeenNthCalledWith(1, expect.stringMatching(/\/source$/))
    expect(probeVideoSource).toHaveBeenLastCalledWith(args.at(-1))
    expect(probeVideoFrameCount).toHaveBeenLastCalledWith(args.at(-1))

    expect(clip).toEqual({
      videoUrl: expect.stringMatching(KEY_RE),
      durationSec: 5,
      width: 720,
      height: 1280,
      frames: 150,
      sha256: sha(await readFile(uploads.list[0]!.kept)),
      sourceVideoUrl: SRC,
      // The draft's start as it was asked, never the frame it snapped to: what `previewClipState` compares.
      startSec: 2,
      recipe: PREVIEW_CLIP_RECIPE,
      madeAt: expect.any(String),
    })
    expect(clip).not.toHaveProperty("faceMask")
    expect(uploads.list).toEqual([{ key: expect.stringMatching(/^trends\/.*\.mp4$/), contentType: "video/mp4", kept: expect.any(String) }])
    expect(Number.isNaN(Date.parse(clip.madeAt))).toBe(false)
  })

  it("a start between frames takes the NEAREST frame, the sound from that frame's moment; a silent source is cut with no sound; a late picture start shifts the sound with it", async () => {
    stubWorld({ fps: 24, frames: 695, audio: false })
    // 7.96 s × 24 = 191.04 → frame 191 (at 7.958333 s).
    const silent = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 7.96, durationSec: 5 })
    expect(silent.frames).toBe(120)
    expect(silent.startSec).toBe(7.96)
    let args = cutRuns()[0]!
    expect(flag(args, "-vf")).toBe("trim=start_frame=191:end_frame=311,setpts=PTS-STARTPTS")
    expect(args).toContain("-an")
    expect(args).not.toContain("-af")

    stubWorld({ fps: 24, frames: 695, audio: true, videoStart: 0.5 })
    await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 1, durationSec: 4 })
    args = cutRuns().at(-1)!
    expect(flag(args, "-vf")).toBe("trim=start_frame=24:end_frame=120,setpts=PTS-STARTPTS")
    // Frame 24 falls at 0.5 + 1 s on ffmpeg's timeline: the sound is cut there, in sync.
    expect(flag(args, "-af")).toBe("atrim=start=1.500000:duration=4.000000,asetpts=PTS-STARTPTS")
  })

  it("a window at the source's end keeps only the frames there are, and a variable-rate source is counted at its frames over its length", async () => {
    // 10 s at 30 fps = 300 frames; from 8 s (frame 240) "5 s" leaves 60.
    stubWorld({ fps: 30, frames: 300 })
    const end = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 8, durationSec: 5 })
    expect(flag(cutRuns()[0]!, "-vf")).toBe("trim=start_frame=240:end_frame=300,setpts=PTS-STARTPTS")
    expect(end.frames).toBe(60)

    stubWorld({ fps: undefined, frames: 300 })
    await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 4 })
    expect(flag(cutRuns().at(-1)!, "-vf")).toBe("trim=start_frame=60:end_frame=180,setpts=PTS-STARTPTS")
  })

  it("cuts the face mask at the SAME frames (the picture's arguments identical, no sound), stores both, and pins the mask cut to the mask it was cut from", async () => {
    stubWorld({ fps: 30, frames: 360 })

    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } })

    expect(fetches.calls).toEqual([SRC, MASK])
    const runs = cutRuns()
    expect(runs).toHaveLength(2)
    expect(runs[1]![runs[1]!.indexOf("-i") + 1]).toMatch(/\/mask$/)
    expect(flag(runs[1]!, "-vf")).toBe(flag(runs[0]!, "-vf"))
    expect(runs[1]).toContain("-an")
    expect(joined(runs[1]!)).not.toMatch(/atrim|-c:a/)
    // Everything else as the clip's: the same encode, the same faststart.
    const encode = (args: readonly string[]) => args.slice(args.indexOf("-fps_mode"), -1).filter((a) => !["-c:a", "aac", "-b:a", "192k"].includes(a))
    expect(encode(runs[1]!)).toEqual(encode(runs[0]!))
    expect(clip.faceMask).toEqual({
      url: expect.stringMatching(KEY_RE),
      frames: 150,
      sha256: sha(await readFile(uploads.list[1]!.kept)),
      sourceMaskUrl: MASK,
    })
    expect(clip.faceMask!.url).not.toBe(clip.videoUrl)
    expect(clip.faceMask!.sha256).not.toBe(clip.sha256)
    expect(uploads.list.map((u) => u.contentType)).toEqual(["video/mp4", "video/mp4"])
  })

  it("a mask cut whose frame count differs from the clip's is a media_unreadable fault, and nothing is stored", async () => {
    // The mask ends a frame before the window does.
    stubWorld({ fps: 30, frames: 360, maskFrames: 209 })
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as Error).message).toMatch(/149 frames.*150/)
    expect(uploads.list).toEqual([])
  })

  it("a clip cut that does not have exactly the frames asked for is media_unreadable, and nothing is stored", async () => {
    stubWorld({ fps: 30, frames: 360 })
    vi.mocked(probeVideoFrameCount).mockImplementation(async (p) => (isSource(p) ? 360 : 149))
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as Error).message).toMatch(/149 frames, 150 were asked for \(from frame 60\)/)
    expect(uploads.list).toEqual([])
  })

  it("a source ffmpeg cannot cut is media_unreadable with ffmpeg's failure as its cause; a stopped launch is thrown as it is; nothing stored", async () => {
    stubWorld()
    const cause = new Error("ffmpeg failed: Invalid data found when processing input")
    vi.mocked(runFfmpeg).mockRejectedValueOnce(cause)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as TrendMediaError).cause).toBe(cause)

    const killed = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    vi.mocked(runFfmpeg).mockRejectedValueOnce(killed)
    expect(await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)).toBe(killed)

    // A frame count of the cut that cannot be read is the clip's fault too.
    vi.mocked(probeVideoFrameCount).mockImplementation(async (p) => {
      if (isSource(p)) return 360
      throw new Error("Could not count the video frames")
    })
    const unc = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect((unc as TrendMediaError).code).toBe("media_unreadable")
    expect(uploads.list).toEqual([])
  })

  it("a source (or mask) that cannot be fetched is download_failed; a source that cannot be measured is media_unreadable before any cut (a stopped probe thrown as it is)", async () => {
    stubWorld()
    fetches.files.delete(SRC)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect((e as TrendMediaError).code).toBe("download_failed")
    expect(runFfmpeg).not.toHaveBeenCalled()

    fetches.files.set(SRC, sourceFixture)
    fetches.files.delete(MASK)
    const m = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } }).catch((x: unknown) => x)
    expect((m as TrendMediaError).code).toBe("download_failed")
    expect(uploads.list).toEqual([])
    vi.mocked(runFfmpeg).mockClear()

    // The cut's numbers come from the source: one that cannot be probed, counted or read is not cut at all.
    for (const broken of [
      () => vi.mocked(probeVideoSource).mockRejectedValueOnce(new Error("ffprobe failed: no stream")),
      () => vi.mocked(probeVideoFrameCount).mockRejectedValueOnce(new Error("Could not count the video frames")),
      () => vi.mocked(runFfprobe).mockResolvedValueOnce("not json"),
    ]) {
      broken()
      const u = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
      expect((u as TrendMediaError).code).toBe("media_unreadable")
      expect((u as Error).message).toMatch(/source clip's frames/)
    }
    expect(runFfmpeg).not.toHaveBeenCalled()
    const stopped = Object.assign(new Error("ffprobe failed: killed"), { killed: true, timedOut: true })
    vi.mocked(probeVideoSource).mockRejectedValueOnce(stopped)
    expect(await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)).toBe(stopped)

    // A window past the source's last frame holds nothing: said, never cut.
    stubWorld({ fps: 30, frames: 300 })
    const past = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 10, durationSec: 4 }).catch((x: unknown) => x)
    expect((past as TrendMediaError).code).toBe("media_unreadable")
    expect((past as Error).message).toMatch(/holds no frame/)
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(uploads.list).toEqual([])
  })
})

// ── ensurePreviewClip ──────────────────────────────────────────────────────

const MASKING = { mode: "always" as const, threshold: 0.4 }

function data(over: Partial<TrendVersionData> = {}): TrendVersionData {
  return {
    name: { en: "Dance" },
    source: { videoUrl: SRC, durationSec: 12, width: 720, height: 1280 },
    previewStart: 2,
    slots: [{ key: "lead", kind: "person", label: { en: "Lead" }, required: true, roleName: "the woman" }],
    references: [],
    examples: [],
    ...over,
  }
}

function mask(d: Pick<TrendVersionData, "source" | "faceMasking" | "slots">): TrendFaceMask {
  return {
    url: MASK, frames: 360, recipe: { core: VIDEO_MASK_RECIPE, plugin: "1" }, settingsKey: faceMaskSettingsKey(d)!,
    jobId: "j1", stats: { shots: 1, heldFrames: 0, coverage: 0.02, droppedRegions: 0 }, approvedAt: "2026-10-26T00:00:00Z", approvedBy: "admin",
  }
}

const current = (over: Partial<TrendPreviewClip> = {}): TrendPreviewClip => ({
  videoUrl: "https://cdn.test/trends/t1/preview.mp4", durationSec: 5, width: 720, height: 1280, frames: 150, sha256: "a".repeat(64),
  sourceVideoUrl: SRC, startSec: 2, recipe: PREVIEW_CLIP_RECIPE, madeAt: "2026-10-27T10:00:00.000Z", ...over,
})

describe("ensurePreviewClip", () => {
  // The draft's source: 12 s at 30 fps.
  beforeEach(() => stubWorld({ fps: 30, frames: 360 }))

  it("makes the clip when none is stored: the window plus the tail, from the draft's source at its start", async () => {
    const next = await ensurePreviewClip(TREND, data())
    expect(next.previewClip).toMatchObject({ sourceVideoUrl: SRC, startSec: 2, frames: 150, recipe: PREVIEW_CLIP_RECIPE })
    // From frame 2 × 30, for (4 + 1) × 30 frames.
    expect(flag(cutRuns()[0]!, "-vf")).toBe("trim=start_frame=60:end_frame=210,setpts=PTS-STARTPTS")
    // Everything else as it was.
    const { previewClip: _c, ...rest } = next
    expect(rest).toEqual(data())
  })

  it("cuts only the window when it ends the clip, and with the stored face mask's cut when the draft has a current mask", async () => {
    const masked = data({ previewStart: 8, faceMasking: MASKING })
    const next = await ensurePreviewClip(TREND, { ...masked, faceMask: mask(masked) })
    // The last 4 s: frames 240 to 360, the mask at the same frames.
    expect(cutRuns().map((a) => flag(a, "-vf"))).toEqual(Array(2).fill("trim=start_frame=240:end_frame=360,setpts=PTS-STARTPTS"))
    expect(fetches.calls).toEqual([SRC, MASK])
    expect(next.previewClip).toMatchObject({ frames: 120, faceMask: { frames: 120, sourceMaskUrl: MASK } })
  })

  it("keeps a current clip untouched (the same object, nothing cut), and drops one when no preview is offered", async () => {
    const d = data({ previewClip: current() })
    expect(await ensurePreviewClip(TREND, d)).toBe(d)
    expect(runFfmpeg).not.toHaveBeenCalled()
    // A clip cut by time (recipe "1") is kept as it is: only a new cut is made by frame index.
    const byTime = data({ previewClip: current({ recipe: "1" }) })
    expect(await ensurePreviewClip(TREND, byTime)).toBe(byTime)
    expect(runFfmpeg).not.toHaveBeenCalled()
    const off = await ensurePreviewClip(TREND, data({ previewStart: null, previewClip: current() }))
    expect(off).not.toHaveProperty("previewClip")
    expect(off.previewStart).toBeNull()
    expect(runFfmpeg).not.toHaveBeenCalled()
    const noSource = await ensurePreviewClip(TREND, data({ source: null, previewClip: current() }))
    expect(noSource).not.toHaveProperty("previewClip")
  })

  it("re-cuts an out-of-date clip (a moved start, another source, an older recipe, a mask approved since)", async () => {
    for (const d of [
      data({ previewStart: 3, previewClip: current() }),
      data({ source: { videoUrl: "https://cdn.test/trends/t1/other.mp4", durationSec: 12 }, previewClip: current() }),
      data({ previewClip: current({ recipe: "0" }) }),
    ]) {
      fetches.files.set("https://cdn.test/trends/t1/other.mp4", sourceFixture)
      const next = await ensurePreviewClip(TREND, d)
      expect(next.previewClip!.videoUrl).not.toBe(current().videoUrl)
      expect(next.previewClip).toMatchObject({ sourceVideoUrl: d.source!.videoUrl, startSec: d.previewStart, recipe: PREVIEW_CLIP_RECIPE })
    }
    expect(runFfmpeg).toHaveBeenCalledTimes(3)
    const masked = data({ faceMasking: MASKING })
    const next = await ensurePreviewClip(TREND, { ...masked, faceMask: mask(masked), previewClip: current() })
    expect(next.previewClip!.faceMask).toMatchObject({ sourceMaskUrl: MASK })
  })

  it("re-uses a clip made moments ago (a retry after a lost race) while it still fits the draft, and cuts again when it does not", async () => {
    const reuse = current({ videoUrl: "https://cdn.test/trends/t1/just-made.mp4" })
    const next = await ensurePreviewClip(TREND, data(), { reuse })
    expect(next.previewClip).toBe(reuse)
    expect(runFfmpeg).not.toHaveBeenCalled()
    const moved = await ensurePreviewClip(TREND, data({ previewStart: 3 }), { reuse })
    expect(moved.previewClip!.videoUrl).not.toBe(reuse.videoUrl)
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
  })

  it("a failed cut is thrown as makePreviewClip throws it: the draft is not changed", async () => {
    vi.mocked(runFfmpeg).mockRejectedValueOnce(new Error("ffmpeg failed: moov atom not found"))
    const e = await ensurePreviewClip(TREND, data()).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect(uploads.list).toEqual([])
  })
})

// ── real ffmpeg ────────────────────────────────────────────────────────────

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

function ffprobe(path: string, entries: string, select = "v:0", extra: string[] = []): Record<string, unknown> {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", select, ...extra, "-show_entries", entries, "-of", "json", path]).toString()
  return (JSON.parse(out) as { streams: Array<Record<string, unknown>> }).streams[0] ?? {}
}

describe.skipIf(!hasFfmpeg)("makePreviewClip (real ffmpeg)", () => {
  let source = ""
  let maskClip = ""

  beforeAll(async () => {
    // A 12 s 320×240 clip at 24 fps with sound, and a "mask" of the same length and rate at another size.
    source = join(sandbox, "real-source.mp4")
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
    ])
    maskClip = join(sandbox, "real-mask.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:size=160x120:rate=24", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", maskClip])
    fetches.files.set(SRC, source)
    fetches.files.set(MASK, maskClip)
  })

  beforeEach(async () => {
    const actual = await vi.importActual<typeof import("../../../../providers/video/ffmpeg-utils.js")>("../../../../providers/video/ffmpeg-utils.js")
    vi.mocked(runFfmpeg).mockImplementation(actual.runFfmpeg)
    vi.mocked(probeVideoSource).mockImplementation(actual.probeVideoSource)
    vi.mocked(probeVideoFrameCount).mockImplementation(actual.probeVideoFrameCount)
    vi.mocked(runFfprobe).mockImplementation(actual.runFfprobe)
    fetches.files.set(SRC, source)
    fetches.files.set(MASK, maskClip)
  })

  it("cuts exactly the window plus the tail at the source's rate and size: 5 s × 24 fps = 120 frames, H.264 / yuv420p / AAC, faststart, hashed as stored", async () => {
    const before = await readFile(source)
    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } })

    expect(clip).toMatchObject({ width: 320, height: 240, frames: 120, sourceVideoUrl: SRC, startSec: 2, recipe: PREVIEW_CLIP_RECIPE })
    expect(clip.durationSec).toBeGreaterThan(4.9)
    expect(clip.durationSec).toBeLessThan(5.2)
    expect(clip.faceMask).toMatchObject({ frames: 120, sourceMaskUrl: MASK })

    const video = uploads.list.find((u) => `https://cdn.test/${u.key}` === clip.videoUrl)!
    expect(ffprobe(video.kept, "stream=codec_name,pix_fmt,width,height")).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p", width: 320, height: 240 })
    expect(ffprobe(video.kept, "stream=codec_name", "a:0")).toMatchObject({ codec_name: "aac" })
    // Decoded, the clip really has 120 frames.
    expect(ffprobe(video.kept, "stream=nb_read_frames", "v:0", ["-count_frames"])).toMatchObject({ nb_read_frames: "120" })
    const bytes = await readFile(video.kept)
    const head = bytes.subarray(0, 4096).toString("latin1")
    expect(head.indexOf("moov")).toBeGreaterThan(-1)
    expect(clip.sha256).toBe(sha(bytes))

    const maskStored = uploads.list.find((u) => `https://cdn.test/${u.key}` === clip.faceMask!.url)!
    expect(ffprobe(maskStored.kept, "stream=nb_read_frames,width,height", "v:0", ["-count_frames"])).toMatchObject({ nb_read_frames: "120", width: 160, height: 120 })
    expect(clip.faceMask!.sha256).toBe(sha(await readFile(maskStored.kept)))

    // The source itself is left as it was.
    expect((await readFile(source)).equals(before)).toBe(true)
  })

  it("the window at the very end cuts the 4 s only (96 frames), and the same source cut twice is the same clip (deterministic)", async () => {
    const a = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 8, durationSec: 4 })
    expect(a.frames).toBe(96)
    const b = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 8, durationSec: 4 })
    expect(b.frames).toBe(96)
    expect(b.videoUrl).not.toBe(a.videoUrl)
    // Same bytes: the recipe is deterministic, so a regenerated clip is the same input.
    const kept = (c: TrendPreviewClip) => uploads.list.find((u) => `https://cdn.test/${u.key}` === c.videoUrl)!.kept
    expect(sha(await readFile(kept(a)))).toBe(sha(await readFile(kept(b))))
    expect(a.sha256).toBe(b.sha256)
  })

  it("a mask in another time base (a millisecond one) cut at a start right on a frame boundary: the same frames as the clip — where the cut by time gave 120 against 119", async () => {
    // The source as an upload stores it (24 fps, time base 1/12288) and its "mask" re-encoded by another
    // encoder in a millisecond time base: frame for frame the same, but frame 7 sits at 0.292 s in the
    // mask and at 0.291667 s in the source.
    const src = join(sandbox, "tb-source.mp4")
    execFileSync("ffmpeg", [
      "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=160x120:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", src,
    ])
    const msMask = join(sandbox, "tb-mask.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-i", src, "-an", "-c:v", "libx264", "-pix_fmt", "yuv444p", "-crf", "12", "-video_track_timescale", "1000", msMask])
    expect(ffprobe(src, "stream=time_base")).toMatchObject({ time_base: "1/12288" })
    expect(ffprobe(msMask, "stream=time_base")).toMatchObject({ time_base: "1/1000" })
    const startSec = 7 / 24

    // The recipe-1 cut (by time, to the millisecond), kept here only to show the fault it had.
    const byTime = async (input: string, out: string) => {
      execFileSync("ffmpeg", [
        "-v", "error", "-y", "-ss", startSec.toFixed(3), "-i", input, "-t", (5).toFixed(3),
        "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac", out,
      ])
      return probeVideoFrameCount(out)
    }
    const old = [await byTime(src, join(sandbox, "tb-old-clip.mp4")), await byTime(msMask, join(sandbox, "tb-old-mask.mp4"))]
    // Measured 119 against 120 (ffmpeg 9): the millisecond start drops frame 7 of the source only.
    expect(old[0]).not.toBe(old[1])

    fetches.files.set(SRC, src)
    fetches.files.set(MASK, msMask)
    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec, durationSec: 5, faceMask: { url: MASK } })
    expect(clip.frames).toBe(120)
    expect(clip.faceMask!.frames).toBe(120)
    expect(clip.startSec).toBe(startSec)
    const kept = (url: string) => uploads.list.find((u) => `https://cdn.test/${u.key}` === url)!.kept
    expect(ffprobe(kept(clip.videoUrl), "stream=nb_read_frames", "v:0", ["-count_frames"])).toMatchObject({ nb_read_frames: "120" })
    expect(ffprobe(kept(clip.faceMask!.url), "stream=nb_read_frames", "v:0", ["-count_frames"])).toMatchObject({ nb_read_frames: "120" })
    // The sound cut alongside, from the same moment for as long: 5 s, give or take one AAC frame.
    const sound = Number(ffprobe(kept(clip.videoUrl), "stream=duration", "a:0").duration)
    expect(Math.abs(sound - 5)).toBeLessThan(0.05)
  })

  it("a mask whose length differs from the source (an older mask) fails the frame check before anything is stored", async () => {
    const short = join(sandbox, "real-mask-short.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=black:size=160x120:rate=24", "-t", "6", "-c:v", "libx264", "-pix_fmt", "yuv420p", short])
    fetches.files.set(MASK, short)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } }).catch((x: unknown) => x)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as Error).message).toMatch(/frames/)
    expect(uploads.list).toEqual([])
  })
})
