// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * The original's display copy (ee/lib/trends/media.ts `makeDisplayCopy`).
 *
 * What must hold (trends "show the original", S7):
 *  - the copy is ALWAYS a new file under `trends/<trendId>/<uuid>.mp4`, made
 *    by a re-encode even when the upload is already H.264 (never the source's
 *    own file or URL), with a PNG poster beside it;
 *  - it is H.264 / yuv420p with AAC audio and faststart (the browser-safe
 *    args, run unconditionally);
 *  - its width, height and length are probed from the COPY, so a portrait
 *    phone clip (landscape frames + a rotation tag) reads portrait.
 *
 * The upload is stubbed (it keeps a copy of each file to look at); the real
 * ffmpeg tests run only where ffmpeg and ffprobe are on PATH (CI installs the
 * production one), and a mocked `runFfmpeg` pins the arguments everywhere.
 */
import { execFileSync } from "node:child_process"
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
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
  return { ...actual, runFfmpeg: vi.fn(actual.runFfmpeg), probeVideoSource: vi.fn(actual.probeVideoSource) }
})

vi.mock("../../../../utils/thumbnail.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../utils/thumbnail.js")>()
  return { ...actual, thumbnailFromLocalVideo: vi.fn(actual.thumbnailFromLocalVideo) }
})

import { probeVideoSource, runFfmpeg } from "../../../../providers/video/ffmpeg-utils.js"
import { thumbnailFromLocalVideo } from "../../../../utils/thumbnail.js"
import { TrendMediaError, isTransientMediaFailure, makeDisplayCopy } from "../media.js"

const TREND = "00000000-0000-4000-8000-0000000000a1"
const KEY_RE = (ext: string) => new RegExp(`^https://cdn\\.test/trends/${TREND}/[0-9a-f-]{36}\\.${ext}$`)
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

let sandbox = ""
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "trend-display-test-"))
  uploads.keepDir = await mkdtemp(join(sandbox, "kept-"))
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})
beforeEach(() => {
  uploads.list = []
  vi.mocked(runFfmpeg).mockClear()
  vi.mocked(probeVideoSource).mockClear()
  vi.mocked(thumbnailFromLocalVideo).mockClear()
})

/** The run's arguments as one string, for "these flags, in this order". */
const joined = (args: readonly string[]) => args.join(" ")

describe("makeDisplayCopy (runFfmpeg stubbed)", () => {
  it("re-encodes with the browser-safe args plus AAC, uploads the copy and its poster, and measures the COPY", async () => {
    vi.mocked(runFfmpeg).mockImplementationOnce(async (args) => {
      await writeFile(args.at(-1)!, "an encoded copy")
      return ""
    })
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 12.04 })
    vi.mocked(thumbnailFromLocalVideo).mockResolvedValueOnce(Buffer.concat([PNG_MAGIC, Buffer.from("poster")]))

    const display = await makeDisplayCopy(TREND, "/uploads/source.mov")

    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    const args = vi.mocked(runFfmpeg).mock.calls[0]![0]
    expect(joined(args)).toContain("-i /uploads/source.mov")
    expect(joined(args)).toContain("-c:v libx264 -pix_fmt yuv420p -preset fast -crf 23 -movflags +faststart")
    expect(joined(args)).toContain("-c:a aac -b:a 128k")
    const out = args.at(-1)!
    expect(out).not.toBe("/uploads/source.mov")
    expect(out.endsWith(".mp4")).toBe(true)
    // Admitted like every full re-encode: against its predicted peak memory.
    expect(vi.mocked(runFfmpeg).mock.calls[0]![2]?.peakMemoryMiB).toBeGreaterThan(0)

    // Measured and postered from the copy, never from the upload.
    expect(probeVideoSource).toHaveBeenCalledWith(out)
    expect(thumbnailFromLocalVideo).toHaveBeenCalledWith(out)

    expect(display).toEqual({
      videoUrl: expect.stringMatching(KEY_RE("mp4")),
      posterUrl: expect.stringMatching(KEY_RE("png")),
      width: 720,
      height: 1280,
      durationSec: 12.04,
    })
    expect(uploads.list.map((u) => u.contentType).sort()).toEqual(["image/png", "video/mp4"])
  })

  it("a clip ffmpeg cannot re-encode is a media_unreadable TrendMediaError, and nothing is stored", async () => {
    vi.mocked(runFfmpeg).mockRejectedValueOnce(new Error("ffmpeg failed: Invalid data found when processing input"))
    const e = await makeDisplayCopy(TREND, "/uploads/broken.mov").catch((x: unknown) => x)
    expect(e).toBeInstanceOf(TrendMediaError)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect(uploads.list).toEqual([])
  })

  it("an unreadable clip's media_unreadable carries ffmpeg's own failure as its cause", async () => {
    const cause = new Error("ffmpeg failed: moov atom not found")
    vi.mocked(runFfmpeg).mockRejectedValueOnce(cause)
    const e = await makeDisplayCopy(TREND, "/uploads/broken.mov").catch((x: unknown) => x)
    expect((e as TrendMediaError).cause).toBe(cause)
  })

  it("an ffmpeg the platform killed or could not admit is thrown as it is, never media_unreadable (the box was busy, not the file bad)", async () => {
    const failures = [
      Object.assign(new Error("ffmpeg failed: killed"), { killed: true, timedOut: true }),
      Object.assign(new Error("trend display poster held its ffmpeg slot past 95 s; the slot was released"), { killed: true, timedOut: true }),
      Object.assign(new Error("ffmpeg failed: no progress for 120 s — the launch was stopped"), { killed: true, timedOut: false, stalled: true, ranMs: 1 }),
      new Error("ledger client unavailable: ECONNREFUSED"),
    ]
    for (const failure of failures) {
      expect(isTransientMediaFailure(failure), failure.message).toBe(true)
      vi.mocked(runFfmpeg).mockRejectedValueOnce(failure)
      const e = await makeDisplayCopy(TREND, "/uploads/source.mov").catch((x: unknown) => x)
      expect(e, failure.message).toBe(failure)
    }
    expect(isTransientMediaFailure(Object.assign(new Error("ffmpeg failed: Invalid data"), { killed: false, timedOut: false }))).toBe(false)
    expect(uploads.list).toEqual([])
  })

  it("a copy whose poster cannot be made is media_unreadable too, and the copy is not stored", async () => {
    vi.mocked(runFfmpeg).mockImplementationOnce(async (args) => {
      await writeFile(args.at(-1)!, "an encoded copy")
      return ""
    })
    vi.mocked(probeVideoSource).mockResolvedValueOnce({ width: 720, height: 1280, durationSeconds: 12 })
    vi.mocked(thumbnailFromLocalVideo).mockRejectedValueOnce(new Error("ffmpeg frame extraction failed"))
    const e = await makeDisplayCopy(TREND, "/uploads/source.mp4").catch((x: unknown) => x)
    expect((e as TrendMediaError).code).toBe("media_unreadable")
    expect(uploads.list).toEqual([])
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

describe.skipIf(!hasFfmpeg)("makeDisplayCopy (real ffmpeg)", () => {
  let h264 = ""
  let rotated = ""

  beforeAll(async () => {
    // A landscape 320×240 H.264 + AAC clip: already browser-safe.
    h264 = join(sandbox, "h264.mp4")
    execFileSync("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=24",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
      "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", h264,
    ])
    // The same frames tagged as turned 90° — how a phone stores a portrait clip.
    rotated = join(sandbox, "rotated.mp4")
    execFileSync("ffmpeg", ["-v", "error", "-y", "-display_rotation", "90", "-i", h264, "-c", "copy", rotated])
  })

  it("an upload that is already H.264 still gets a NEW re-encoded file under the trend's key", async () => {
    const before = join(sandbox, "h264-before.mp4")
    await copyFile(h264, before)

    const display = await makeDisplayCopy(TREND, h264)

    expect(runFfmpeg).toHaveBeenCalledTimes(1)
    expect(display.videoUrl).toMatch(KEY_RE("mp4"))
    expect(display.videoUrl).not.toContain("h264.mp4")
    expect(display.posterUrl).toMatch(KEY_RE("png"))
    expect(display).toMatchObject({ width: 320, height: 240 })
    expect(display.durationSec).toBeGreaterThan(3.9)

    const video = uploads.list.find((u) => u.contentType === "video/mp4")!
    expect(ffprobe(video.kept, "stream=codec_name,pix_fmt")).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p" })
    expect(ffprobe(video.kept, "stream=codec_name", "a:0")).toMatchObject({ codec_name: "aac" })
    // faststart: the index (moov) comes before the media (mdat).
    const bytes = (await readFile(video.kept)).subarray(0, 4096).toString("latin1")
    expect(bytes.indexOf("moov")).toBeGreaterThan(-1)
    expect(bytes.indexOf("moov")).toBeLessThan(bytes.indexOf("mdat") === -1 ? Infinity : bytes.indexOf("mdat"))

    const poster = uploads.list.find((u) => u.contentType === "image/png")!
    expect((await readFile(poster.kept)).subarray(0, 4).equals(PNG_MAGIC)).toBe(true)

    // The upload itself is left as it was: runs still edit the true original.
    expect((await readFile(h264)).equals(await readFile(before))).toBe(true)
  })

  it("a clip tagged as rotated reads portrait (height > width), probed from the copy", async () => {
    // The fixture really is landscape frames with a rotation tag.
    expect(ffprobe(rotated, "stream=width,height:stream_side_data=rotation")).toMatchObject({
      width: 320, height: 240, side_data_list: [expect.objectContaining({ rotation: 90 })],
    })

    const display = await makeDisplayCopy(TREND, rotated)

    expect(display.height).toBeGreaterThan(display.width)
    expect(display).toMatchObject({ width: 240, height: 320 })
  })
})
