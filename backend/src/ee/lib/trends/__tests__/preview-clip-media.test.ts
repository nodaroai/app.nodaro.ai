// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * Making the preview's input clip (ee/lib/trends/preview-clip-media.ts).
 *
 * What must hold:
 *  - the clip is cut from the downloaded source with an INPUT seek (`-ss`
 *    before `-i`) and a re-encode, no scaling and no `-r`, into a NEW file
 *    under `trends/<trendId>/<uuid>.mp4`, with its frame count, size, length
 *    and SHA-256 measured from the file stored;
 *  - the face mask, when given, is cut with the IDENTICAL arguments and its
 *    frame count must equal the clip's, else nothing is stored;
 *  - a clip ffmpeg cannot cut is `media_unreadable`, a download that fails
 *    `download_failed`, a killed launch is thrown as it is; nothing stored;
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
  }
})

import { probeVideoFrameCount, probeVideoSource, runFfmpeg } from "../../../../providers/video/ffmpeg-utils.js"
import { TrendMediaError } from "../media.js"
import { faceMaskSettingsKey } from "../face-mask.js"
import { PREVIEW_CLIP_RECIPE } from "../preview-clip.js"
import { ensurePreviewClip, makePreviewClip, previewClipArgs } from "../preview-clip-media.js"
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
})

/** A stubbed cut: writes `content` (default: a file named by its arguments) where ffmpeg would. */
function stubCut(content?: (args: readonly string[]) => string) {
  vi.mocked(runFfmpeg).mockImplementation(async (args) => {
    await writeFile(args.at(-1)!, content ? content(args) : `cut of ${args[args.indexOf("-i") + 1]}`)
    return ""
  })
}

const joined = (args: readonly string[]) => args.join(" ")

describe("previewClipArgs", () => {
  it("seeks the INPUT (frame-accurate), re-encodes at a near-lossless quality with no scaling and no -r, maps picture + optional sound, faststart", () => {
    const args = previewClipArgs("/in/src.mp4", 2, 5, "/out/clip.mp4")
    expect(args).toEqual([
      "-y", "-ss", "2.000", "-i", "/in/src.mp4", "-t", "5.000",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-c:v", "libx264", "-preset", "medium", "-crf", "16", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart",
      "/out/clip.mp4",
    ])
    expect(args.indexOf("-ss")).toBeLessThan(args.indexOf("-i"))
    expect(joined(args)).not.toMatch(/scale|-r |-vf/)
    // Fractions of a second to the millisecond.
    expect(previewClipArgs("a", 7.96, 4.04, "b").slice(1, 7)).toEqual(["-ss", "7.960", "-i", "a", "-t", "4.040"])
  })
})

describe("makePreviewClip (ffmpeg stubbed)", () => {
  it("downloads the source, cuts it with the recipe's arguments admitted at its canvas, measures the cut, hashes and uploads it under the trend's key", async () => {
    stubCut()
    // The source's probe (for the canvas), then the cut's.
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 12 })
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 5.02, fps: 30 })
    vi.mocked(probeVideoFrameCount).mockResolvedValueOnce(150)

    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 })

    expect(fetches.calls).toEqual([SRC])
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    const [args, , launch] = vi.mocked(runFfmpeg).mock.calls[0]!
    expect(joined(args)).toContain("-ss 2.000 -i ")
    expect(joined(args)).toContain("-t 5.000 -map 0:v:0 -map 0:a:0? -c:v libx264 -preset medium -crf 16 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart")
    expect(args.at(-1)!.endsWith("clip.mp4")).toBe(true)
    expect(launch?.peakMemoryMiB).toBeGreaterThan(0)
    // Measured from the cut, never the source.
    expect(probeVideoSource).toHaveBeenLastCalledWith(args.at(-1))
    expect(probeVideoFrameCount).toHaveBeenCalledWith(args.at(-1))

    expect(clip).toEqual({
      videoUrl: expect.stringMatching(KEY_RE),
      durationSec: 5.02,
      width: 720,
      height: 1280,
      frames: 150,
      sha256: sha(await readFile(uploads.list[0]!.kept)),
      sourceVideoUrl: SRC,
      startSec: 2,
      recipe: PREVIEW_CLIP_RECIPE,
      madeAt: expect.any(String),
    })
    expect(clip).not.toHaveProperty("faceMask")
    expect(uploads.list).toEqual([{ key: expect.stringMatching(/^trends\/.*\.mp4$/), contentType: "video/mp4", kept: expect.any(String) }])
    expect(Number.isNaN(Date.parse(clip.madeAt))).toBe(false)
  })

  it("cuts the face mask with the IDENTICAL arguments, stores both, and pins the mask cut to the mask it was cut from", async () => {
    stubCut()
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 12 })
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 5 })
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 5 })
    vi.mocked(probeVideoFrameCount).mockResolvedValueOnce(150).mockResolvedValueOnce(150)

    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } })

    expect(fetches.calls).toEqual([SRC, MASK])
    const runs = vi.mocked(runFfmpeg).mock.calls.map((c) => c[0])
    expect(runs).toHaveLength(2)
    // Everything but the input and output paths is the same.
    const shape = (args: readonly string[]) => args.map((a, i) => (i === args.indexOf("-i") + 1 || i === args.length - 1 ? "<path>" : a))
    expect(shape(runs[1]!)).toEqual(shape(runs[0]!))
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
    stubCut()
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 720, height: 1280, durationSeconds: 5 })
    vi.mocked(probeVideoFrameCount).mockResolvedValueOnce(150).mockResolvedValueOnce(149)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as Error).message).toMatch(/149 frames.*150/)
    expect(uploads.list).toEqual([])
  })

  it("a source ffmpeg cannot cut is media_unreadable with ffmpeg's failure as its cause; a stopped launch is thrown as it is; nothing stored", async () => {
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 720, height: 1280, durationSeconds: 12 })
    const cause = new Error("ffmpeg failed: Invalid data found when processing input")
    vi.mocked(runFfmpeg).mockRejectedValueOnce(cause)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect((e as TrendMediaError).cause).toBe(cause)

    const killed = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    vi.mocked(runFfmpeg).mockRejectedValueOnce(killed)
    expect(await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)).toBe(killed)

    // A frame count that cannot be read is the clip's fault too.
    stubCut()
    vi.mocked(probeVideoFrameCount).mockRejectedValueOnce(new Error("Could not count the video frames"))
    const unc = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect((unc as TrendMediaError).code).toBe("media_unreadable")
    expect(uploads.list).toEqual([])
  })

  it("a source (or mask) that cannot be fetched is download_failed, and a source that cannot be probed is still cut (admitted at the default)", async () => {
    fetches.files.delete(SRC)
    const e = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 }).catch((x: unknown) => x)
    expect((e as TrendMediaError).code).toBe("download_failed")
    expect(runFfmpeg).not.toHaveBeenCalled()

    fetches.files.set(SRC, sourceFixture)
    fetches.files.delete(MASK)
    stubCut()
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 720, height: 1280, durationSeconds: 5 })
    vi.mocked(probeVideoFrameCount).mockResolvedValue(150)
    const m = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5, faceMask: { url: MASK } }).catch((x: unknown) => x)
    expect((m as TrendMediaError).code).toBe("download_failed")
    expect(uploads.list).toEqual([])

    // The canvas probe failing is not the clip's fault yet: the cut decides.
    vi.mocked(probeVideoSource).mockReset()
    vi.mocked(probeVideoSource)
      .mockRejectedValueOnce(new Error("ffprobe failed: no stream"))
      .mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 5 })
    const clip = await makePreviewClip(TREND, { sourceUrl: SRC, startSec: 2, durationSec: 5 })
    expect(clip.frames).toBe(150)
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

function mask(d: Pick<TrendVersionData, "source" | "faceMasking">): TrendFaceMask {
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
  beforeEach(() => {
    stubCut()
    vi.mocked(probeVideoSource).mockResolvedValue({ width: 720, height: 1280, durationSeconds: 5 })
    vi.mocked(probeVideoFrameCount).mockResolvedValue(150)
  })

  it("makes the clip when none is stored: the window plus the tail, from the draft's source at its start", async () => {
    const next = await ensurePreviewClip(TREND, data())
    expect(next.previewClip).toMatchObject({ sourceVideoUrl: SRC, startSec: 2, frames: 150, recipe: PREVIEW_CLIP_RECIPE })
    expect(joined(vi.mocked(runFfmpeg).mock.calls[0]![0])).toContain("-ss 2.000 -i ")
    expect(joined(vi.mocked(runFfmpeg).mock.calls[0]![0])).toContain("-t 5.000")
    // Everything else as it was.
    const { previewClip: _c, ...rest } = next
    expect(rest).toEqual(data())
  })

  it("cuts only the window when it ends the clip, and with the stored face mask's cut when the draft has a current mask", async () => {
    const masked = data({ previewStart: 8, faceMasking: MASKING })
    const next = await ensurePreviewClip(TREND, { ...masked, faceMask: mask(masked) })
    expect(joined(vi.mocked(runFfmpeg).mock.calls[0]![0])).toContain("-ss 8.000 -i ")
    expect(joined(vi.mocked(runFfmpeg).mock.calls[0]![0])).toContain("-t 4.000")
    expect(fetches.calls).toEqual([SRC, MASK])
    expect(next.previewClip?.faceMask).toMatchObject({ frames: 150, sourceMaskUrl: MASK })
  })

  it("keeps a current clip untouched (the same object, nothing cut), and drops one when no preview is offered", async () => {
    const d = data({ previewClip: current() })
    expect(await ensurePreviewClip(TREND, d)).toBe(d)
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
