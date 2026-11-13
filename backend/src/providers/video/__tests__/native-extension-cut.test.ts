// @test-reads-none reads only the temp files it writes
/**
 * The new part of a native extension (`../native-extension-cut.ts`): the pure
 * arguments, where the picture starts, and real-ffmpeg cuts of a stand-in for
 * the provider's clip — the source's part in one colour at one frame rate, the
 * new seconds in another colour at another rate, so the test can see exactly
 * where the cut fell. Skips when ffmpeg is not on PATH (CI installs the pinned
 * build), like `extract-tail.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { runFfmpeg, runFfmpegCapture } from "../ffmpeg-utils.js"
import { cutNativeExtension, nativeExtensionCutArgs, nativeExtensionCutStartSec, pictureStartOffsetSec } from "../native-extension-cut.js"
import { probeMatched } from "../matched-encode.js"
import { pictureSecondsOf, stitchExtension } from "../extend-stitch.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const ffmpegAvailable = isFfmpegAvailable()

describe("nativeExtensionCutArgs", () => {
  it("re-encodes from the start to the end: lossless picture with every frame kept, PCM sound, even sides, in a MOV", () => {
    expect(nativeExtensionCutArgs("/w/pixverse.mp4", 8.0625, "/w/native-extension.mov", { sound: true })).toEqual([
      "-y",
      "-ss", "8.063", "-i", "/w/pixverse.mp4",
      "-map", "0:v:0", "-map", "0:a:0?",
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0",
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "veryfast", "-qp", "0",
      "-c:a", "pcm_s24le",
      "/w/native-extension.mov",
    ])
  })

  it("with the sound off, keeps no sound at all, whatever the clip carries", () => {
    expect(nativeExtensionCutArgs("/w/pixverse.mp4", 8.0625, "/w/native-extension.mov", { sound: false })).toEqual([
      "-y",
      "-ss", "8.063", "-i", "/w/pixverse.mp4",
      "-map", "0:v:0", "-an",
      "-map_metadata", "-1", "-map_chapters", "-1",
      "-vf", "crop=trunc(iw/2)*2:trunc(ih/2)*2:0:0",
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-preset", "veryfast", "-qp", "0",
      "/w/native-extension.mov",
    ])
  })

  it("never seeks before the start", () => {
    expect(nativeExtensionCutArgs("/w/in.mp4", -0.5, "/w/out.mov", { sound: true }).slice(1, 3)).toEqual(["-ss", "0.000"])
  })

  it("never stream-copies (a copy would start on the keyframe before the cut)", () => {
    for (const sound of [true, false]) expect(nativeExtensionCutArgs("/w/in.mp4", 2, "/w/out.mov", { sound })).not.toContain("copy")
  })
})

describe("nativeExtensionCutStartSec", () => {
  it("is the source's picture length, counted from where the clip's picture starts", () => {
    expect(nativeExtensionCutStartSec({}, 8.06)).toBe(8.06)
    expect(nativeExtensionCutStartSec({ videoStartSec: 0.05, audioStartSec: 0 }, 8.06)).toBeCloseTo(8.11, 9)
    expect(nativeExtensionCutStartSec({ videoStartSec: 0, audioStartSec: 0.021 }, 2)).toBe(2)
  })
})

describe("pictureStartOffsetSec", () => {
  it("is how far the picture starts after the earliest stream", () => {
    expect(pictureStartOffsetSec({ videoStartSec: 0.042, audioStartSec: 0 })).toBeCloseTo(0.042, 9)
    expect(pictureStartOffsetSec({ videoStartSec: 1.5, audioStartSec: 1.0 })).toBeCloseTo(0.5, 9)
  })

  it("is 0 when the picture starts first or with the sound, or a start is unread", () => {
    expect(pictureStartOffsetSec({ videoStartSec: 0, audioStartSec: 0.021 })).toBe(0)
    expect(pictureStartOffsetSec({ videoStartSec: 0.2, audioStartSec: 0.2 })).toBe(0)
    expect(pictureStartOffsetSec({ videoStartSec: 0.3 })).toBe(0)
    expect(pictureStartOffsetSec({ audioStartSec: 0.3 })).toBe(0)
    expect(pictureStartOffsetSec({})).toBe(0)
  })
})

describe.skipIf(!ffmpegAvailable)("cutNativeExtension (real ffmpeg)", () => {
  let dir: string

  beforeAll(async () => {
    dir = join(tmpdir(), `native-extension-cut-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
  })

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  /**
   * A stand-in for the provider's clip: `sourceSec` of red (the source's part,
   * re-rendered), then `newSec` of blue (the new seconds), at `fps`, with a
   * tone throughout, as H.264 4:2:0 + AAC.
   */
  async function providerClip(name: string, o: { sourceSec: number; newSec: number; fps: number; size?: string }): Promise<string> {
    const out = join(dir, name)
    const size = o.size ?? "64x48"
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", `color=c=red:s=${size}:r=${o.fps}:d=${o.sourceSec}`,
      "-f", "lavfi", "-i", `color=c=blue:s=${size}:r=${o.fps}:d=${o.newSec}`,
      "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${o.sourceSec + o.newSec}`,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-map", "2:a",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-preset", "ultrafast", "-qp", "0",
      "-c:a", "aac", "-shortest",
      out,
    ])
    return out
  }

  /** The mean of each RGB channel of a picture's first frame (0–255). */
  async function firstFrameRgb(path: string): Promise<[number, number, number]> {
    const raw = await rawFrame(path, ["-frames:v", "1"])
    return meanRgb(raw)
  }

  async function rawFrame(path: string, select: string[]): Promise<Buffer> {
    const out = join(dir, `frame-${randomUUID()}.rgb`)
    await runFfmpeg(["-y", "-i", path, ...select, "-f", "rawvideo", "-pix_fmt", "rgb24", out])
    const buf = await fs.readFile(out)
    await fs.rm(out, { force: true })
    return buf
  }

  function meanRgb(buf: Buffer): [number, number, number] {
    const sums = [0, 0, 0]
    for (let i = 0; i < buf.length; i += 3) for (let c = 0; c < 3; c++) sums[c]! += buf[i + c]!
    const n = buf.length / 3
    return [sums[0]! / n, sums[1]! / n, sums[2]! / n]
  }

  async function frameCount(path: string): Promise<number> {
    const { stdout } = await runFfmpegCapture(["-v", "error", "-i", path, "-map", "0:v:0", "-f", "framemd5", "-"])
    return stdout.split("\n").filter((l) => l && !l.startsWith("#")).length
  }

  it("keeps only the new seconds, cut by time at the source's length, at the provider's own frame rate", async () => {
    // The source was 2 s at 24 fps; the provider returned it at 30 fps, then 1.5 s of new footage.
    const clip = await providerClip("rate-changed.mp4", { sourceSec: 2, newSec: 1.5, fps: 30 })
    const work = join(dir, "rate-changed")
    await fs.mkdir(work)
    const cut = await cutNativeExtension(clip, 2, work, { sound: true })
    expect(cut).toBe(join(work, "native-extension.mov"))

    const probe = await probeMatched(cut)
    expect(probe.videoCodec).toBe("h264")
    expect(probe.audioCodec).toBe("pcm_s24le")
    expect(pictureSecondsOf(probe)).toBeCloseTo(1.5, 1)
    // 1.5 s at the clip's own 30 fps: 45 frames, give or take the one the cut lands between.
    expect(Math.abs((await frameCount(cut)) - 45)).toBeLessThanOrEqual(1)
    // Its first frame is the new footage (blue), not the source's re-render (red).
    const [r, , b] = await firstFrameRgb(cut)
    expect(b).toBeGreaterThan(200)
    expect(r).toBeLessThan(40)
  })

  it("is lossless: a frame of the new part comes out as it went in", async () => {
    const clip = await providerClip("lossless.mp4", { sourceSec: 1, newSec: 1, fps: 25 })
    const work = join(dir, "lossless")
    await fs.mkdir(work)
    const cut = await cutNativeExtension(clip, 1, work, { sound: true })
    const inFrame = await rawFrame(clip, ["-vf", "select=eq(n\\,30)", "-frames:v", "1"])
    const outFrame = await rawFrame(cut, ["-vf", "select=eq(n\\,5)", "-frames:v", "1"])
    expect(outFrame.equals(inFrame)).toBe(true)
  })

  it("rounds an odd-size picture down to even", async () => {
    const clip = await providerClip("odd.mp4", { sourceSec: 1, newSec: 1, fps: 24, size: "65x49" })
    const work = join(dir, "odd")
    await fs.mkdir(work)
    const probe = await probeMatched(await cutNativeExtension(clip, 1, work, { sound: true }))
    expect({ width: probe.width, height: probe.height }).toEqual({ width: 64, height: 48 })
  })

  /** The loudest sample of `path`'s sound from `fromSec` to its end, in dB (−Infinity for digital silence). */
  async function maxVolumeDb(path: string, fromSec: number): Promise<number> {
    const { stderr } = await runFfmpegCapture(["-v", "info", "-ss", fromSec.toFixed(3), "-i", path, "-map", "0:a:0", "-af", "volumedetect", "-f", "null", "-"])
    const m = /max_volume:\s*(-?inf|-?[\d.]+) dB/.exec(stderr)
    if (!m) throw new Error(`no volumedetect reading: ${stderr.slice(-400)}`)
    return m[1]!.endsWith("inf") ? Number.NEGATIVE_INFINITY : Number(m[1])
  }

  // The sound switch off: the new seconds are silent whatever the provider returned.
  it("with the sound off, the cut has no sound stream though the clip has one, and the delivered new seconds are silent", async () => {
    // The user's source: 2 s of red with a tone. The provider's clip: that, re-rendered, then 1.5 s of blue — its tone runs throughout.
    const source = await providerClip("source-with-sound.mp4", { sourceSec: 2, newSec: 0.04, fps: 25 })
    const clip = await providerClip("sound-off.mp4", { sourceSec: 2, newSec: 1.5, fps: 25 })
    expect((await probeMatched(clip)).audioCodec).toBe("aac")
    const work = join(dir, "sound-off")
    await fs.mkdir(work)
    const sourcePictureSec = pictureSecondsOf(await probeMatched(source))!
    const cut = await cutNativeExtension(clip, sourcePictureSec, work, { sound: false })
    const cutProbe = await probeMatched(cut)
    expect(cutProbe.videoCodec).toBe("h264")
    expect(cutProbe.audioCodec).toBeUndefined()

    // The stitch as the worker runs it (the 8 × 8 smart cut, trims 0/0 without a match, the
    // leading repeats dropped, the 0.15 s blend): it pads the new seconds with silence of their own length.
    const stitchWork = join(dir, "sound-off-stitch")
    await fs.mkdir(stitchWork)
    const { outputPath } = await stitchExtension({
      sourcePath: source,
      extensionPath: cut,
      workDir: stitchWork,
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
      audioFadeSec: 0.15,
      dropLeadingRepeats: true,
    })
    // The source's part keeps its tone; past the join and its blend, nothing.
    expect(await maxVolumeDb(outputPath, 0.2)).toBeGreaterThan(-30)
    expect(await maxVolumeDb(outputPath, sourcePictureSec + 0.3)).toBeLessThan(-80)
  })

  it("with the sound on, the cut keeps the clip's sound", async () => {
    const clip = await providerClip("sound-on.mp4", { sourceSec: 1, newSec: 1, fps: 25 })
    const work = join(dir, "sound-on")
    await fs.mkdir(work)
    const cut = await cutNativeExtension(clip, 1, work, { sound: true })
    expect((await probeMatched(cut)).audioCodec).toBe("pcm_s24le")
    expect(await maxVolumeDb(cut, 0.1)).toBeGreaterThan(-30)
  })
})
