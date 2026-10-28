// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * Storing a Topaz upscale at its target, 720p or 1080p (ee/lib/trends/media.ts
 * `storeUpscaledVideo`).
 *
 * What must hold:
 *  - the stored video's SHORT side is exactly the target's (720 or 1080), the aspect and the
 *    orientation kept, both sides even — a rotation tag included (the size is
 *    picked from the decoded frame);
 *  - Topaz's output is stored AS IT IS (no re-encode) only when it already is
 *    exactly that: 1080 short side, the right way round, no longer than the
 *    original, browser-safe H.264, with sound whenever the original has some;
 *  - otherwise its sound is the ORIGINAL clip's, copied (Topaz may drop it),
 *    re-encoded to AAC only when the MP4 refuses the copy, and it is never
 *    longer than the clip it replaces;
 *  - an example's gets a fresh poster; the source's is stored exactly as a
 *    new source clip is, with a new display copy;
 *  - a result that is not at its target, or that cannot be resized, is a
 *    `media_unreadable` and nothing is stored; a launch the platform stopped
 *    is thrown as it is.
 *
 * Downloads read local files; the upload is stubbed (it keeps a copy of each
 * file to look at). The real ffmpeg tests run only where ffmpeg and ffprobe
 * are on PATH (CI installs the production one).
 */
import { execFileSync } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const uploads = vi.hoisted(() => ({
  keepDir: "",
  list: [] as Array<{ key: string; contentType: string; kept: string }>,
}))

vi.mock("../../../../lib/storage.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/storage.js")>()
  const { copyFile: copy, writeFile: write } = await import("node:fs/promises")
  const { join: joinPath } = await import("node:path")
  const keep = (key: string) => joinPath(uploads.keepDir, key.replaceAll("/", "_"))
  return {
    ...actual,
    uploadFileWithKeyToR2: vi.fn(async (file: string, key: string, contentType: string) => {
      const kept = keep(key)
      await copy(file, kept)
      uploads.list.push({ key, contentType, kept })
      return `https://cdn.test/${key}`
    }),
    uploadBufferToR2: vi.fn(async (buffer: Buffer, key: string, contentType: string) => {
      const kept = keep(key)
      await write(kept, buffer)
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
    // "https://files.test/<absolute path>" is that local file.
    downloadFile: vi.fn(async (url: string, dest: string) => copy(decodeURIComponent(new URL(url).pathname), dest)),
    runFfmpeg: vi.fn(actual.runFfmpeg),
    probeVideoSource: vi.fn(actual.probeVideoSource),
    probeVideoStream: vi.fn(actual.probeVideoStream),
    hasAudioStream: vi.fn(actual.hasAudioStream),
  }
})

vi.mock("../../../../utils/thumbnail.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../utils/thumbnail.js")>()
  return { ...actual, thumbnailFromLocalVideo: vi.fn(actual.thumbnailFromLocalVideo) }
})

import { hasAudioStream, probeVideoSource, probeVideoStream, runFfmpeg } from "../../../../providers/video/ffmpeg-utils.js"
import { thumbnailFromLocalVideo } from "../../../../utils/thumbnail.js"
import { TrendMediaError, isAudioCopyFailure, storeUpscaledVideo, upscaleResizeArgs } from "../media.js"

const TREND = "00000000-0000-4000-8000-0000000000a1"
const KEY_RE = (ext: string) => new RegExp(`^https://cdn\\.test/trends/${TREND}/[0-9a-f-]{36}\\.${ext}$`)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const MP4_STUB = Buffer.from([0, 0, 0, 0x18, ...Buffer.from("ftypisom"), 0, 0, 0, 0])
const url = (path: string) => `https://files.test${path}`

let sandbox = ""
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "trend-upscale-test-"))
  uploads.keepDir = await mkdtemp(join(sandbox, "kept-"))
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})
const actual = vi.hoisted(() => ({ ffmpeg: null as null | typeof import("../../../../providers/video/ffmpeg-utils.js"), thumbnail: null as null | typeof import("../../../../utils/thumbnail.js") }))
beforeEach(async () => {
  uploads.list = []
  actual.ffmpeg ??= await vi.importActual<typeof import("../../../../providers/video/ffmpeg-utils.js")>("../../../../providers/video/ffmpeg-utils.js")
  actual.thumbnail ??= await vi.importActual<typeof import("../../../../utils/thumbnail.js")>("../../../../utils/thumbnail.js")
  // Each test starts on the real ffmpeg; a stubbed one overrides what it needs.
  vi.mocked(runFfmpeg).mockReset().mockImplementation(actual.ffmpeg.runFfmpeg)
  vi.mocked(probeVideoSource).mockReset().mockImplementation(actual.ffmpeg.probeVideoSource)
  vi.mocked(probeVideoStream).mockReset().mockImplementation(actual.ffmpeg.probeVideoStream)
  vi.mocked(hasAudioStream).mockReset().mockImplementation(actual.ffmpeg.hasAudioStream)
  vi.mocked(thumbnailFromLocalVideo).mockReset().mockImplementation(actual.thumbnail.thumbnailFromLocalVideo)
})

describe("upscaleResizeArgs", () => {
  it("scales by the decoded frame's orientation, takes the original's sound, caps the length and encodes H.264 with faststart", () => {
    const args = upscaleResizeArgs("/t/up", "/t/orig", { width: 1080, height: 1920 }, 12.04, "copy", "/t/out.mp4")
    const text = args.join(" ")
    expect(text).toContain("-i /t/up -i /t/orig -map 0:v:0 -map 1:a:0?")
    expect(args[args.indexOf("-vf") + 1]).toBe("scale='if(lte(iw,ih),1080,1920)':'if(lte(iw,ih),1920,1080)':flags=lanczos,setsar=1")
    expect(text).toContain("-t 12.040")
    expect(text).toContain("-c:v libx264 -pix_fmt yuv420p -preset fast -crf 18 -movflags +faststart")
    expect(text).toContain("-c:a copy")
    expect(args.at(-1)).toBe("/t/out.mp4")
    // A landscape target is the same pair: the expression picks the side.
    expect(upscaleResizeArgs("a", "b", { width: 1920, height: 1080 }, 5, "aac", "c")).toContain("scale='if(lte(iw,ih),1080,1920)':'if(lte(iw,ih),1920,1080)':flags=lanczos,setsar=1")
    expect(upscaleResizeArgs("a", "b", { width: 1920, height: 1080 }, 5, "aac", "c").join(" ")).toContain("-c:a aac -b:a 192k")
  })
})

describe("storeUpscaledVideo (ffmpeg stubbed)", () => {
  /** Every ffmpeg run writes a stand-in MP4 where its output goes; the poster is a stand-in PNG. */
  const stubRun = () => {
    vi.mocked(runFfmpeg).mockImplementation(async (args) => {
      await writeFile(args.at(-1)!, MP4_STUB)
      return ""
    })
    vi.mocked(thumbnailFromLocalVideo).mockResolvedValue(Buffer.concat([PNG_MAGIC, Buffer.from("poster")]))
  }

  async function inputs() {
    const up = join(sandbox, "stub-up.mp4")
    const orig = join(sandbox, "stub-orig.mp4")
    await writeFile(up, MP4_STUB)
    await writeFile(orig, MP4_STUB)
    return { upscaledUrl: url(up), originalUrl: url(orig) }
  }

  it("probes the upscale, resizes it admitted against its predicted memory, and stores the 1080p result with a poster", async () => {
    stubRun()
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10.04 })
      .mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 10 })
    const stored = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" })
    expect(stored).toEqual({
      url: expect.stringMatching(KEY_RE("mp4")),
      posterUrl: expect.stringMatching(KEY_RE("png")),
      width: 1080,
      height: 1920,
      durationSec: 10,
      // Hashed as stored, for the provenance a run records.
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    const [args, , launch] = vi.mocked(runFfmpeg).mock.calls[0]!
    expect(args.join(" ")).toContain("-t 10.000")
    expect(args.join(" ")).toContain("-c:a copy")
    expect(launch?.peakMemoryMiB).toBeGreaterThan(0)
  })

  it("a sound the MP4 cannot copy is encoded to AAC instead", async () => {
    stubRun()
    vi.mocked(runFfmpeg).mockRejectedValueOnce(new Error("ffmpeg failed: Could not find tag for codec vorbis in stream #1"))
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10 })
      .mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 10 })
    await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" })
    expect(vi.mocked(runFfmpeg).mock.calls.map((c) => (c[0].join(" ").includes("-c:a copy") ? "copy" : "aac"))).toEqual(["copy", "aac"])
  })

  it("an upscale that cannot be resized is media_unreadable, not retried (only a refused sound copy is), and nothing is stored", async () => {
    vi.mocked(runFfmpeg).mockRejectedValue(new Error("ffmpeg failed: Invalid data found when processing input"))
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10 })
    const e = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    expect(uploads.list).toEqual([])
  })

  it("a refused sound copy is told from every other failure", () => {
    expect(isAudioCopyFailure(new Error("ffmpeg failed: [mp4 @ 0x1] Could not find tag for codec adpcm_ima_qt in stream #1, codec not currently supported in container"))).toBe(true)
    expect(isAudioCopyFailure(new Error("ffmpeg failed: [mp4 @ 0x1] Could not find tag for codec hevc in stream #0, codec not currently supported in container"))).toBe(false)
    expect(isAudioCopyFailure(new Error("ffmpeg failed: Invalid data found when processing input"))).toBe(false)
    expect(isAudioCopyFailure("not an error")).toBe(false)
  })

  /** Topaz's output as the as-is check reads it: H.264 / yuv420p with sound, unless told otherwise. */
  function asIs(probe: { width: number; height: number; durationSeconds: number }, stream = { codec: "h264", pixFmt: "yuv420p" }, sound = { up: true, original: true }) {
    stubRun()
    vi.mocked(probeVideoSource).mockResolvedValue(probe)
    vi.mocked(probeVideoStream).mockResolvedValue(stream)
    vi.mocked(hasAudioStream).mockImplementation(async (path: string) => (path.endsWith("upscaled") ? sound.up : sound.original))
  }

  it("stores Topaz's output as it is when it already is exactly 1080p, the right way round, no longer, browser-safe and with its sound", async () => {
    asIs({ width: 1080, height: 1920, durationSeconds: 10.02 })
    const stored = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p", shownAs: { width: 720, height: 1280 } })
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(stored).toMatchObject({ width: 1080, height: 1920, posterUrl: expect.stringMatching(KEY_RE("png")) })
    // A silent original needs no sound from Topaz either.
    vi.mocked(runFfmpeg).mockClear()
    asIs({ width: 1920, height: 1080, durationSeconds: 10 }, undefined, { up: false, original: false })
    await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" })
    expect(runFfmpeg).not.toHaveBeenCalled()
  })

  it.each([
    ["longer than the original", { width: 1080, height: 1920, durationSeconds: 10.5 }, undefined, undefined, undefined],
    ["not 1080 on its short side", { width: 1440, height: 2560, durationSeconds: 10 }, undefined, undefined, undefined],
    ["an odd side", { width: 1080, height: 1919, durationSeconds: 10 }, undefined, undefined, undefined],
    ["HEVC", { width: 1080, height: 1920, durationSeconds: 10 }, { codec: "hevc", pixFmt: "yuv420p10le" }, undefined, undefined],
    ["silent while the original has sound", { width: 1080, height: 1920, durationSeconds: 10 }, undefined, { up: false, original: true }, undefined],
    ["the other way round from the original as shown", { width: 1920, height: 1080, durationSeconds: 10 }, undefined, undefined, { width: 720, height: 1280 }],
  ])("re-encodes an output that is %s", async (_what, probe, stream, sound, shownAs) => {
    asIs(probe, stream, sound)
    // The resize's own result is what the stub probe answers: only the decision is pinned here.
    await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p", ...(shownAs ? { shownAs } : {}) }).catch(() => undefined)
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runFfmpeg).mock.calls[0]![0].join(" ")).toContain("-t 10.000")
  })

  it("an ffmpeg the platform stopped is thrown as it is, never retried or called unreadable", async () => {
    const killed = Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true })
    vi.mocked(runFfmpeg).mockRejectedValueOnce(killed)
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10 })
    const e = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" }).catch((x: unknown) => x)
    expect(e).toBe(killed)
    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    expect(uploads.list).toEqual([])
  })

  it("an upscale that came out the other way round from how the original is shown is refused before anything is stored", async () => {
    stubRun()
    // Topaz dropped a phone clip's rotation tag: the frames come back landscape.
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 2560, height: 1440, durationSeconds: 10 })
      .mockResolvedValue({ width: 1920, height: 1080, durationSeconds: 10 })
    const e = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: true, resolution: "1080p", shownAs: { width: 720, height: 1280 } }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).message).toContain("lost its rotation")
    expect(uploads.list).toEqual([])
    // The same upscale of a landscape original is fine.
    const ok = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p", shownAs: { width: 1280, height: 720 } })
    expect(ok).toMatchObject({ width: 1920, height: 1080 })
  })

  it("a result that is not 1080p is media_unreadable", async () => {
    stubRun()
    vi.mocked(probeVideoSource)
      .mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10 })
      .mockResolvedValue({ width: 720, height: 1280, durationSeconds: 10 })
    const e = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "1080p" }).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).message).toContain("720×1280")
    expect(uploads.list).toEqual([])
  })

  describe("at a 720p target", () => {
    it("a 720p clip enhanced at 720p is stored as it is (the same size), never resized up to 1080", async () => {
      asIs({ width: 720, height: 1280, durationSeconds: 10 })
      const stored = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "720p", shownAs: { width: 720, height: 1280 } })
      expect(runFfmpeg).not.toHaveBeenCalled()
      expect(stored).toMatchObject({ width: 720, height: 1280 })
    })

    it("an output that is not 720 on its short side is resized to 720, the aspect and orientation kept", async () => {
      asIs({ width: 1080, height: 1920, durationSeconds: 10 })
      vi.mocked(probeVideoSource)
        .mockReset()
        .mockResolvedValueOnce({ width: 1080, height: 1920, durationSeconds: 10 })
        .mockResolvedValue({ width: 720, height: 1280, durationSeconds: 10 })
      const stored = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "720p" })
      expect(runFfmpeg).toHaveBeenCalledTimes(1)
      expect(vi.mocked(runFfmpeg).mock.calls[0]![0][vi.mocked(runFfmpeg).mock.calls[0]![0].indexOf("-vf") + 1]).toBe(
        "scale='if(lte(iw,ih),720,1280)':'if(lte(iw,ih),1280,720)':flags=lanczos,setsar=1",
      )
      expect(stored).toMatchObject({ width: 720, height: 1280 })
    })

    it("a result that came out at 1080p for a 720p ask is media_unreadable, and nothing is stored", async () => {
      stubRun()
      vi.mocked(probeVideoSource)
        .mockResolvedValueOnce({ width: 1440, height: 2560, durationSeconds: 10 })
        .mockResolvedValue({ width: 1080, height: 1920, durationSeconds: 10 })
      const e = await storeUpscaledVideo(TREND, { ...(await inputs()), durationSec: 10, asSource: false, resolution: "720p" }).catch((x: unknown) => x)
      expect(e).toBeInstanceOf(TrendMediaError)
      expect((e as TrendMediaError).message).toBe("The upscaled video came out at 1080×1920, not 720p.")
      expect(uploads.list).toEqual([])
    })
  })
})

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
})()

function ffprobe(path: string, entries: string, select = "v:0"): Record<string, unknown> {
  const out = execFileSync("ffprobe", ["-v", "error", "-select_streams", select, "-show_entries", entries, "-of", "json", path]).toString()
  return (JSON.parse(out) as { streams: Array<Record<string, unknown>> }).streams[0] ?? {}
}

describe.skipIf(!hasFfmpeg)("storeUpscaledVideo (real ffmpeg)", () => {
  /** A clip of `size` with no sound, or with a 440 Hz tone. */
  function clip(name: string, size: string, opts: { sound?: boolean; seconds?: number; rotate?: number } = {}): string {
    const path = join(sandbox, name)
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", `testsrc=size=${size}:rate=24`,
      ...(opts.sound ? ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100"] : []),
      "-t", String(opts.seconds ?? 2), "-c:v", "libx264", "-pix_fmt", "yuv420p",
      ...(opts.sound ? ["-c:a", "aac", "-shortest"] : ["-an"]),
      path,
    ])
    if (opts.rotate === undefined) return path
    const rotated = join(sandbox, `rot-${name}`)
    execFileSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", String(opts.rotate), "-i", path, "-c", "copy", rotated])
    return rotated
  }

  it("an example: 1080×1920 from a silent 2x upscale, the original's sound, no longer than the original, and a fresh poster", async () => {
    const up = clip("up-portrait.mp4", "1440x2560", { seconds: 2.5 })
    const orig = clip("orig-portrait.mp4", "720x1280", { sound: true, seconds: 2 })
    const stored = await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 2, asSource: false, resolution: "1080p" })
    expect(stored).toMatchObject({ width: 1080, height: 1920 })
    expect(stored.url).toMatch(KEY_RE("mp4"))
    expect(stored.posterUrl).toMatch(KEY_RE("png"))
    expect(stored.durationSec).toBeLessThanOrEqual(2.05)
    expect(stored).not.toHaveProperty("display")
    const video = uploads.list.find((u) => u.contentType === "video/mp4")!
    expect(ffprobe(video.kept, "stream=codec_name,pix_fmt,width,height")).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p", width: 1080, height: 1920 })
    expect(ffprobe(video.kept, "stream=codec_name", "a:0")).toMatchObject({ codec_name: "aac" })
    const poster = uploads.list.find((u) => u.contentType === "image/png")!
    expect((await readFile(poster.kept)).subarray(0, 4).equals(PNG_MAGIC)).toBe(true)
  }, 60_000)

  it("an upscale already 1080p H.264 with sound is stored as it is, with no re-encode", async () => {
    const up = clip("up-asis.mp4", "1080x1920", { sound: true, seconds: 2 })
    const orig = clip("orig-asis.mp4", "720x1280", { sound: true, seconds: 2 })
    const stored = await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 2.1, asSource: false, resolution: "1080p", shownAs: { width: 720, height: 1280 } })
    expect(runFfmpeg).not.toHaveBeenCalled()
    expect(stored).toMatchObject({ width: 1080, height: 1920 })
    const video = uploads.list.find((u) => u.contentType === "video/mp4")!
    expect((await readFile(video.kept)).equals(await readFile(up))).toBe(true)
  }, 60_000)

  it("a landscape upscale comes out 1920×1080; an odd one keeps an even long side", async () => {
    const up = clip("up-land.mp4", "2560x1440")
    const orig = clip("orig-land.mp4", "1280x720", { sound: true })
    expect(await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 2, asSource: false, resolution: "1080p" })).toMatchObject({ width: 1920, height: 1080 })
    const odd = clip("up-odd.mp4", "1442x2562")
    expect(await storeUpscaledVideo(TREND, { upscaledUrl: url(odd), originalUrl: url(orig), durationSec: 2, asSource: false, resolution: "1080p" })).toMatchObject({ width: 1080, height: 1918 })
  }, 60_000)

  it("a rotated upscale (landscape frames tagged 90°) comes out portrait, by its decoded frame", async () => {
    const up = clip("up-rot.mp4", "2560x1440", { rotate: 90 })
    const orig = clip("orig-rot.mp4", "720x1280", { sound: true })
    expect(await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 2, asSource: false, resolution: "1080p" })).toMatchObject({ width: 1080, height: 1920 })
  }, 60_000)

  it("the source: stored as a new source clip is, with a new display copy at 1080p and no poster of its own", async () => {
    const up = clip("up-src.mp4", "1440x2560", { seconds: 4.2 })
    const orig = clip("orig-src.mp4", "720x1280", { sound: true, seconds: 4.2 })
    const stored = await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 4.2, asSource: true, resolution: "1080p" })
    expect(stored).toMatchObject({ width: 1080, height: 1920 })
    expect(stored).not.toHaveProperty("posterUrl")
    expect(stored.display).toEqual({
      videoUrl: expect.stringMatching(KEY_RE("mp4")),
      posterUrl: expect.stringMatching(KEY_RE("png")),
      width: 1080,
      height: 1920,
      durationSec: expect.any(Number),
    })
    expect(stored.display!.videoUrl).not.toBe(stored.url)
  }, 60_000)

  it("at a 720p target: a landscape upscale comes out 1280×720, and a 720p source's display copy is 720p too", async () => {
    const up = clip("up-720-land.mp4", "1920x1080")
    const orig = clip("orig-720-land.mp4", "1280x720", { sound: true })
    expect(await storeUpscaledVideo(TREND, { upscaledUrl: url(up), originalUrl: url(orig), durationSec: 2, asSource: false, resolution: "720p" })).toMatchObject({ width: 1280, height: 720 })
    // A source clip is 4–30 s.
    const upSrc = clip("up-720-src.mp4", "1920x1080", { seconds: 4.2 })
    const origSrc = clip("orig-720-src.mp4", "1280x720", { sound: true, seconds: 4.2 })
    const src = await storeUpscaledVideo(TREND, { upscaledUrl: url(upSrc), originalUrl: url(origSrc), durationSec: 4.2, asSource: true, resolution: "720p" })
    expect(src).toMatchObject({ width: 1280, height: 720 })
    expect(src.display).toMatchObject({ width: 1280, height: 720 })
  }, 60_000)
})
