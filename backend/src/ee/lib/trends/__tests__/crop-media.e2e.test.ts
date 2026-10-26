// @test-reads-none reads only the temp clips it makes with ffmpeg and the copies the stubbed upload keeps
/**
 * Cropping the source clip (ee/lib/trends/media.ts `storeCroppedSource`), on
 * real ffmpeg.
 *
 * What must hold:
 *  - a 2568×1080 clip comes out 1920×1080, and the admin's position decides
 *    which part is kept (centered by default; 0 = flush left, 1 = flush right);
 *  - the original's quality is kept: the same codec family (H.264 stays
 *    H.264, HEVC stays HEVC), about the original's bitrate, its pixel format,
 *    and its sound copied bit for bit;
 *  - it is stored exactly as a new source clip is, with a new display copy.
 *
 * Downloads read local files; the upload is stubbed (it keeps a copy of each
 * file to look at). Runs only where ffmpeg and ffprobe are on PATH (CI
 * installs the production one).
 */
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
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
  // "https://files.test/<absolute path>" is that local file.
  return { ...actual, downloadFile: vi.fn(async (url: string, dest: string) => copy(decodeURIComponent(new URL(url).pathname), dest)) }
})

import { probeSourceVideoStream, storeCroppedSource } from "../media.js"

function has(bin: string): boolean {
  try {
    execFileSync(bin, ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}
const ffmpegAvailable = has("ffmpeg") && has("ffprobe")
const x265Available = ffmpegAvailable && execFileSync("ffmpeg", ["-hide_banner", "-encoders"]).toString().includes("libx265")

const TREND = "00000000-0000-4000-8000-0000000000a1"
const url = (path: string) => `https://files.test${path}`

let sandbox = ""
beforeAll(async () => {
  sandbox = await mkdtemp(join(tmpdir(), "trend-crop-test-"))
  uploads.keepDir = await mkdtemp(join(sandbox, "kept-"))
})
afterAll(async () => {
  await rm(sandbox, { recursive: true, force: true })
})
beforeEach(() => {
  uploads.list = []
})

/**
 * A 2568×1080, 4.5 s clip of three vertical bands — green 324 px | red 1920 px
 * | blue 324 px — with a moving test pattern in strips across the top and
 * bottom (so the bitrate means something; the rows the colour checks read,
 * 400–600, stay plain) and a tone. Not random noise: flat colour under heavy
 * noise is incompressible, and x264's two passes then overshoot by up to 40 %
 * depending on the thread count, which real footage does not (measured: within
 * 1 % on natural motion, within 3 % on this fixture at 2, 4 and 8 threads).
 */
function makeBands(path: string, codec: "libx264" | "libx265"): void {
  execFileSync("ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "color=c=green:s=324x1080:r=30:d=4.5",
    "-f", "lavfi", "-i", "color=c=red:s=1920x1080:r=30:d=4.5",
    "-f", "lavfi", "-i", "color=c=blue:s=324x1080:r=30:d=4.5",
    "-f", "lavfi", "-i", "testsrc2=s=2568x360:r=30:d=4.5",
    "-f", "lavfi", "-i", "sine=f=440:r=48000:d=4.5",
    "-filter_complex", "[0][1][2]hstack=inputs=3[bands];[3]split[top][bottom];[bands][top]overlay=0:0[o];[o][bottom]overlay=0:720[v]",
    "-map", "[v]", "-map", "4:a",
    "-c:v", codec, "-preset", "fast", "-b:v", "6M", "-pix_fmt", "yuv420p",
    ...(codec === "libx265" ? ["-tag:v", "hvc1"] : []),
    "-c:a", "aac", "-b:a", "128k",
    path,
  ])
}

function probe(path: string): { codec: string; width: number; height: number; pixFmt: string; bitRate: number } {
  const out = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt,bit_rate", "-of", "json", path]).toString())
  const s = out.streams[0]
  return { codec: s.codec_name, width: s.width, height: s.height, pixFmt: s.pix_fmt, bitRate: Number(s.bit_rate) }
}

/** The average colour of a `w`×`h` box at (`x`, `y`) of the frame at 1 s. */
function colourAt(path: string, x: number, y: number, w: number, h: number): "red" | "green" | "blue" | string {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", "1", "-i", path, "-frames:v", "1", "-vf", `crop=${w}:${h}:${x}:${y},scale=1:1`, "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"])
  const [r, g, b] = [raw[0]!, raw[1]!, raw[2]!]
  if (r > 150 && g < 110 && b < 110) return "red"
  if (g > 70 && r < 90 && b < 90) return "green"
  if (b > 150 && r < 110 && g < 110) return "blue"
  return `?(${r},${g},${b})`
}

/** The md5 of a file's sound packets, as they are (no decode). */
const soundMd5 = (path: string) => execFileSync("ffmpeg", ["-v", "error", "-i", path, "-map", "0:a:0", "-c", "copy", "-f", "md5", "-"]).toString().trim()

describe.skipIf(!ffmpegAvailable)("storeCroppedSource (real ffmpeg)", () => {
  it("crops 2568×1080 to 1920×1080 centered by default, keeping the original's codec, bitrate, pixel format and sound", async () => {
    const src = join(sandbox, "bands-h264.mp4")
    makeBands(src, "libx264")
    const stored = await storeCroppedSource(TREND, { sourceUrl: url(src), aspect: "16:9", position: 0.5 })
    expect(stored).toMatchObject({ width: 1920, height: 1080 })
    expect(stored.display).toBeDefined()

    // The clip itself, then its display copy and poster.
    const clip = uploads.list[uploads.list.length - 1]!
    expect(clip.key).toMatch(new RegExp(`^trends/${TREND}/[0-9a-f-]{36}\\.mp4$`))
    expect(uploads.list.some((u) => u.contentType === "image/png")).toBe(true)
    const got = probe(clip.kept)
    const orig = probe(src)
    expect(got).toMatchObject({ codec: "h264", width: 1920, height: 1080, pixFmt: "yuv420p" })
    // The original's own bitrate (two passes hit it; one pass of x264 came out at less than half).
    expect(got.bitRate).toBeGreaterThan(orig.bitRate * 0.9)
    expect(got.bitRate).toBeLessThan(orig.bitRate * 1.1)
    expect(soundMd5(clip.kept)).toBe(soundMd5(src))
    // Centered: the 324 px bands on both sides are gone, all red.
    expect(colourAt(clip.kept, 0, 400, 40, 200)).toBe("red")
    expect(colourAt(clip.kept, 1880, 400, 40, 200)).toBe("red")
  }, 120_000)

  it("the position decides which side is kept: 0 = flush left, 1 = flush right", async () => {
    const src = join(sandbox, "bands-h264-pos.mp4")
    makeBands(src, "libx264")
    await storeCroppedSource(TREND, { sourceUrl: url(src), aspect: "16:9", position: 0 })
    const left = uploads.list[uploads.list.length - 1]!.kept
    expect(colourAt(left, 0, 400, 40, 200)).toBe("green")
    expect(colourAt(left, 1880, 400, 40, 200)).toBe("red")
    uploads.list = []
    await storeCroppedSource(TREND, { sourceUrl: url(src), aspect: "16:9", position: 1 })
    const right = uploads.list[uploads.list.length - 1]!.kept
    expect(colourAt(right, 0, 400, 40, 200)).toBe("red")
    expect(colourAt(right, 1880, 400, 40, 200)).toBe("blue")
  }, 120_000)

  it.skipIf(!x265Available)("an HEVC original stays HEVC", async () => {
    const src = join(sandbox, "bands-hevc.mp4")
    makeBands(src, "libx265")
    expect((await probeSourceVideoStream(src)).codec).toBe("hevc")
    await storeCroppedSource(TREND, { sourceUrl: url(src), aspect: "16:9", position: 0.5 })
    expect(probe(uploads.list[uploads.list.length - 1]!.kept)).toMatchObject({ codec: "hevc", width: 1920, height: 1080 })
  }, 180_000)
})
