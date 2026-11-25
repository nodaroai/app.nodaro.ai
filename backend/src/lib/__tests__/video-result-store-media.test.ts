// @test-reads-none reads only the temp clips it writes
/**
 * The video result funnel on REAL files (`lib/video-result-store.ts`, decided
 * 2026-11-22): tiny generated clips go through the real probe and the real
 * preview encode; only the storage upload is replaced (it copies the file
 * aside so the test can probe what would have been stored). Skips without
 * ffmpeg; the HDR case needs zscale, which the pinned build CI installs has
 * and Homebrew's does not.
 */
import { execFileSync } from "node:child_process"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const stored = vi.hoisted(() => ({ dir: "", files: new Map<string, string>(), charges: [] as string[] }))

vi.mock("../storage.js", () => ({
  mediaObjectKey: (id: string, type: string, ext = "mp4") => `${type}s/${id}.${ext}`,
  uploadFileToR2: vi.fn(async (path: string, id: string, _type: string, _user: string | undefined, opts: { ext?: string } = {}) => {
    const name = `${id}.${opts.ext ?? "mp4"}`
    const copy = join(stored.dir, name)
    await (await import("node:fs")).promises.copyFile(path, copy)
    stored.files.set(name, copy)
    return `https://cdn.test/videos/${name}`
  }),
  uploadToR2: vi.fn(async () => {
    throw new Error("not used")
  }),
}))

vi.mock("../job-server-output.js", async (orig) => ({
  ...(await orig<object>()),
  recordStoredObjectAndCharge: vi.fn(async (a: { key: string; bytes: number }) => {
    stored.charges.push(a.key)
    return { outcome: "recorded", charged: a.bytes }
  }),
  storeBeginTime: vi.fn(async () => "2026-11-23T10:00:00.000Z"),
}))
vi.mock("../supabase.js", () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { status: "processing" }, error: null }) }) }) }) },
}))

import { runFfmpeg, runFfprobe } from "../../providers/video/ffmpeg-utils.js"
import { storeVideoResult } from "../video-result-store.js"

function has(kind: "-encoders" | "-filters", name: string): boolean {
  try {
    return new RegExp(`\\s${name}\\s`).test(execFileSync("ffmpeg", ["-hide_banner", kind], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }))
  } catch {
    return false
  }
}
const ffmpegAvailable = has("-encoders", "libx264")
const x265Available = ffmpegAvailable && has("-encoders", "libx265")
const zscaleAvailable = ffmpegAvailable && has("-filters", "zscale")
if (x265Available && !zscaleAvailable) console.warn("[video-result-store-media] HDR case skipped: this ffmpeg has no zscale filter (CI's pinned build does)")

let dir = ""
beforeAll(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), "vstore-media-"))
  stored.dir = await fs.mkdtemp(join(tmpdir(), "vstore-stored-"))
})
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true })
  await fs.rm(stored.dir, { recursive: true, force: true })
})
beforeEach(() => {
  stored.files.clear()
  stored.charges.length = 0
})

interface Stream { codec_name?: string; pix_fmt?: string; color_transfer?: string; color_primaries?: string; color_space?: string }
async function streamOf(file: string): Promise<Stream> {
  return (JSON.parse(await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,pix_fmt,color_primaries,color_transfer,color_space", "-of", "json", file,
  ])) as { streams: Stream[] }).streams[0]!
}

/** Mean luma of every frame (signalstats YAVG), 8-bit scale. */
async function meanLuma(file: string): Promise<number> {
  const out = await runFfmpeg(["-v", "error", "-i", file, "-vf", "format=yuv420p,signalstats,metadata=print:file=-", "-f", "null", "-"])
  const ys = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((x) => Number(x[1]))
  return ys.reduce((a, b) => a + b, 0) / ys.length
}

/** A 1 s 320x180 clip of testsrc2 with sound, encoded as given. */
async function clip(name: string, video: string[], filter?: string): Promise<string> {
  const out = join(dir, name)
  await runFfmpeg([
    "-y",
    "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24:duration=1",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000",
    ...(filter ? ["-vf", filter] : []),
    ...video,
    "-c:a", "aac", "-shortest", out,
  ])
  return out
}

describe.skipIf(!ffmpegAvailable)("storeVideoResult on real files", () => {
  it("an 8-bit H.264 file is stored as it is, with no original", async () => {
    const src = await clip("h264.mp4", ["-c:v", "libx264", "-pix_fmt", "yuv420p"])
    const result = await storeVideoResult({ path: src }, { jobId: "aaaaaaaa-0000-4000-8000-00000000000a", userId: undefined, watermark: false })
    expect(result).toEqual({ videoUrl: "https://cdn.test/videos/aaaaaaaa-0000-4000-8000-00000000000a.mp4" })
    expect([...stored.files.keys()]).toEqual(["aaaaaaaa-0000-4000-8000-00000000000a.mp4"])
  }, 60_000)

  it.skipIf(!x265Available)("a 10-bit HEVC SDR file is kept untouched beside an 8-bit H.264 preview", async () => {
    const src = await clip("hevc10.mp4", [
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1",
      "-x265-params", "log-level=error:colorprim=bt709:transfer=bt709:colormatrix=bt709",
      "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
    ], "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv")
    expect((await streamOf(src)).color_transfer).toBe("bt709")
    const result = await storeVideoResult({ path: src }, { jobId: "bbbbbbbb-0000-4000-8000-00000000000b", userId: undefined, watermark: false })
    expect(result).toEqual({ videoUrl: "https://cdn.test/videos/bbbbbbbb-0000-4000-8000-00000000000b.mp4", originalVideoUrl: "https://cdn.test/videos/bbbbbbbb-0000-4000-8000-00000000000b-master.mp4" })
    const original = stored.files.get("bbbbbbbb-0000-4000-8000-00000000000b-master.mp4")!
    // The original is the provider's file byte for byte.
    expect(await fs.readFile(original)).toEqual(await fs.readFile(src))
    expect(await streamOf(original)).toMatchObject({ codec_name: "hevc", pix_fmt: "yuv420p10le" })
    expect(await streamOf(stored.files.get("bbbbbbbb-0000-4000-8000-00000000000b.mp4")!)).toMatchObject({ codec_name: "h264", pix_fmt: "yuv420p", color_transfer: "bt709" })
  }, 60_000)

  it.skipIf(!x265Available || !zscaleAvailable)("an HLG file's preview is tone-mapped: SDR BT.709 tags and a picture that is neither black nor blown out", async () => {
    const src = await clip("hlg.mp4", [
      "-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1",
      "-x265-params", "log-level=error:colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc",
      "-color_primaries", "bt2020", "-color_trc", "arib-std-b67", "-colorspace", "bt2020nc",
    ], "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv")
    expect((await streamOf(src)).color_transfer).toBe("arib-std-b67")

    const result = await storeVideoResult({ path: src }, { jobId: "cccccccc-0000-4000-8000-00000000000c", userId: undefined, watermark: false })
    expect(result.originalVideoUrl).toBe("https://cdn.test/videos/cccccccc-0000-4000-8000-00000000000c-master.mp4")
    const preview = stored.files.get("cccccccc-0000-4000-8000-00000000000c.mp4")!
    expect(await streamOf(preview)).toMatchObject({
      codec_name: "h264", pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709",
    })
    const luma = await meanLuma(preview)
    expect(luma).toBeGreaterThan(30)
    expect(luma).toBeLessThan(230)
    // The tone map really moved the levels: the preview is not the HLG code values relabelled.
    expect(Math.abs(luma - (await meanLuma(src)))).toBeGreaterThan(2)
    expect(await streamOf(stored.files.get("cccccccc-0000-4000-8000-00000000000c-master.mp4")!)).toMatchObject({ color_transfer: "arib-std-b67" })
  }, 60_000)
})

/**
 * Files whose header reads but whose picture does not decode (decided
 * 2026-11-22): the store fails the old way — nothing kept, nothing charged.
 * Built from a real 10-bit HEVC clip by cutting or zeroing its boxes.
 */
describe.skipIf(!x265Available)("a header that reads over a picture that does not", () => {
  const JOB = "dddddddd-0000-4000-8000-00000000000d"
  /** The top-level boxes of an mp4: [type, offset, size]. */
  function boxes(buf: Buffer): Array<[string, number, number]> {
    const out: Array<[string, number, number]> = []
    for (let i = 0; i + 8 <= buf.length; ) {
      const size = buf.readUInt32BE(i)
      out.push([buf.toString("latin1", i + 4, i + 8), i, size])
      if (size < 8) break
      i += size
    }
    return out
  }
  async function hevcSource(): Promise<Buffer> {
    // faststart off: the media data comes before the moov, as a provider's file often has it.
    return fs.readFile(await clip("bad-src.mp4", ["-c:v", "libx265", "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1", "-x265-params", "log-level=error"]))
  }
  async function storesNothing(file: string): Promise<void> {
    await expect(storeVideoResult({ path: file }, { jobId: JOB, userId: undefined, watermark: false })).rejects.toBeTruthy()
    expect([...stored.files.keys()]).toEqual([])
    expect(stored.charges).toEqual([])
  }

  it("sound alone (changed 2026-11-22: the encode used to write a sound-only MP4 and the store kept it)", async () => {
    const file = join(dir, "sound-only.m4a")
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000", "-c:a", "aac", file])
    await expect(storeVideoResult({ path: file }, { jobId: JOB, userId: undefined, watermark: false })).rejects.toThrow(/^unusable-video:/)
    expect([...stored.files.keys()]).toEqual([])
    expect(stored.charges).toEqual([])
  }, 60_000)

  it("its media data zeroed (the preview encode exits non-zero)", async () => {
    const buf = Buffer.from(await hevcSource())
    const [, at, size] = boxes(buf).find(([t]) => t === "mdat")!
    buf.fill(0, at + 8, at + size)
    const file = join(dir, "mdat-zeroed.mp4")
    await fs.writeFile(file, buf)
    await storesNothing(file)
  }, 60_000)

  it("its moov alone, the media data cut away (the encode exits 0 having written no frame)", async () => {
    const buf = await hevcSource()
    const all = boxes(buf)
    const keep = all.filter(([t]) => t === "ftyp" || t === "moov").map(([, at, size]) => buf.subarray(at, at + size))
    const file = join(dir, "moov-only.mp4")
    await fs.writeFile(file, Buffer.concat(keep))
    await storesNothing(file)
  }, 60_000)

  it("a picture of no size (its sample entry 0x0, no decoder setup)", async () => {
    const buf = Buffer.from(await hevcSource())
    const entry = buf.indexOf("hvc1", 0, "latin1")
    // Sample entry: size, type, 6 reserved, data ref, 16 pre-defined/reserved, then width and height.
    buf.fill(0, entry + 4 + 6 + 2 + 16, entry + 4 + 6 + 2 + 16 + 4)
    const config = buf.indexOf("hvcC", 0, "latin1")
    buf.write("free", config, "latin1")
    const file = join(dir, "zero-size.mp4")
    await fs.writeFile(file, buf)
    await storesNothing(file)
  }, 60_000)
})
