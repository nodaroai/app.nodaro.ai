// @test-reads-none reads only the temp files it writes
/**
 * Real-ffmpeg tests for `stitchExtension` (`../extend-stitch.ts`): tiny
 * generated clips, stitched by the local ffmpeg, the result probed. Skips when
 * ffmpeg is not on PATH, like `extract-tail.test.ts` (CI installs the pinned
 * build).
 *
 * No smart-cut matcher registers in this repo's own processes (the matcher is
 * the cloud plugin's), so every stitch here takes the fixed trims (4 and 3),
 * but the one test that registers a stand-in matcher for its own stitch
 * (`standInMatcher`).
 *
 * The sound is cut to the picture's frame count, sample for sample, so the
 * result's sound and picture end together: to within one AAC frame (1024
 * samples at 48 kHz), the most an encoder's framing can add.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { execFileSync } from "node:child_process"
import { dirname, join } from "node:path"
import { promises as fs } from "node:fs"
import { tmpdir } from "node:os"
import { needsTranscode, runFfmpeg, runFfmpegCapture, runFfprobe } from "../ffmpeg-utils.js"
import { stitchExtension } from "../extend-stitch.js"
import { extendStitchArgs } from "../extend-stitch-args.js"
import { probeMatched } from "../matched-encode.js"
import { getSmartCutMatcher, registerSmartCutMatcher, type SmartCutMatcher } from "../smart-cut.js"
import { colourTagArgs, hdrTags, writeTaggedClip, type ColourTags } from "./colour-tagged-clip.js"
import { TAIL_RECIPES } from "../../../lib/extend-recipe.js"

function isFfmpegAvailable(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

const ffmpegAvailable = isFfmpegAvailable()

/** Whether this ffmpeg can encode with `name` (libx265: the pinned build and most local ones can). */
function hasEncoder(name: string): boolean {
  try {
    return execFileSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).includes(name)
  } catch {
    return false
  }
}

/** Whether this ffmpeg has the filter `name` (zscale needs libzimg: the pinned build has it, Homebrew's does not). */
function hasFilter(name: string): boolean {
  try {
    const out = execFileSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    return new RegExp(`\\s${name}\\s`).test(out)
  } catch {
    return false
  }
}

const x265Available = ffmpegAvailable && hasEncoder("libx265")
if (ffmpegAvailable && !x265Available) console.warn("[extend-stitch-output] HEVC case skipped: this ffmpeg has no libx265 (CI's pinned build does)")
const zscaleAvailable = ffmpegAvailable && hasFilter("zscale")
if (ffmpegAvailable && !zscaleAvailable) console.warn("[extend-stitch-output] HDR cases skipped: this ffmpeg has no zscale filter (CI's pinned build does)")

/** One AAC frame at 48 kHz: how far the sound may end from the picture. */
const LOCKED_WITHIN_SEC = 1024 / 48_000

type Stream = Record<string, unknown> & { side_data_list?: Array<Record<string, unknown>> }

interface Probed {
  video: Stream
  audio: Stream | undefined
  brand: string | undefined
}

async function probe(file: string): Promise<Probed> {
  const out = JSON.parse(await runFfprobe([
    "-v", "error", "-count_frames",
    "-show_entries",
    "stream=codec_type,codec_name,width,height,pix_fmt,sample_aspect_ratio,r_frame_rate,avg_frame_rate,nb_read_frames,duration" +
      ":stream_side_data=rotation:format_tags=major_brand",
    "-of", "json", file,
  ])) as { streams: Stream[]; format?: { tags?: { major_brand?: string } } }
  return {
    video: out.streams.find((s) => s.codec_type === "video")!,
    audio: out.streams.find((s) => s.codec_type === "audio"),
    brand: out.format?.tags?.major_brand?.trim(),
  }
}

/** The settings x264 recorded in `file` (its SEI): how its picture was rate-controlled ("rc=crf … crf=14.0", "rc=2pass"). */
async function x264Settings(file: string): Promise<string> {
  return /x264 - core[^\0]*/.exec((await fs.readFile(file)).toString("latin1"))?.[0] ?? ""
}

/** The result's sound ends with its picture. */
function expectLocked(p: Probed): void {
  expect(p.audio, "the result has sound").toBeDefined()
  expect(Math.abs(Number(p.audio!.duration) - Number(p.video.duration))).toBeLessThan(LOCKED_WITHIN_SEC)
}

/**
 * The PSNR at which `standInMatcher` calls a pair a match. Not the extend's
 * documented 24 dB: one picture compared at full range against limited range
 * scores right about there (each level moves by at most 20, about 22 dB where
 * every pixel is white; 24 dB on the test's fixture), so 24 dB could not tell
 * the two apart. A pair at the same levels scores far above 32.
 */
const STAND_IN_MATCH_DB = 32

/** Every picture frame's luma plane in `file` (an 8-bit 4:2:0 picture), raw as decoded: no conversion of any kind. */
async function lumaPlanes(file: string): Promise<Buffer[]> {
  const stream = (JSON.parse(await runFfprobe([
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,pix_fmt", "-of", "json", file,
  ])) as { streams: Array<{ width: number; height: number; pix_fmt: string }> }).streams[0]!
  expect(["yuv420p", "yuvj420p"]).toContain(stream.pix_fmt)
  const luma = stream.width * stream.height
  const frame = luma + 2 * Math.ceil(stream.width / 2) * Math.ceil(stream.height / 2)
  // `rawvideo` in the decoded pixel format: the planes as they are stored.
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-map", "0:v:0", "-fps_mode", "passthrough", "-f", "rawvideo", "-"], { maxBuffer: 256 * 1024 * 1024 })
  return Array.from({ length: Math.floor(raw.length / frame) }, (_, n) => raw.subarray(n * frame, n * frame + luma))
}

/** Two luma planes' PSNR, in dB (identical: Infinity). */
function lumaPsnr(a: Buffer, b: Buffer): number {
  expect(a.length).toBe(b.length)
  let squared = 0
  for (let k = 0; k < a.length; k++) squared += (a[k]! - b[k]!) ** 2
  return squared === 0 ? Infinity : 10 * Math.log10((255 * 255) / (squared / a.length))
}

/**
 * A stand-in for the cloud plugin's boundary matcher, which never registers in
 * this repo: the best pair of the two proxies' frames by the PSNR of their raw
 * luma planes, a match at `STAND_IN_MATCH_DB` or more. It tells whether the
 * stitch's two proxies carry the same levels, not how the plugin's own search
 * scores them.
 */
const standInMatcher: SmartCutMatcher = async (prevPath, nextPath, framesFromPrev, framesFromNext) => {
  const prev = (await lumaPlanes(prevPath)).slice(-framesFromPrev)
  const next = (await lumaPlanes(nextPath)).slice(0, framesFromNext)
  const best = prev
    .flatMap((p, i) => next.map((n, j) => ({ i, j, psnr: lumaPsnr(p, n) })))
    .reduce((a, b) => (b.psnr > a.psnr ? b : a))
  return {
    trimEndFrames: prev.length - 1 - best.i,
    trimStartFrames: best.j + 1,
    psnr: best.psnr,
    matched: best.psnr >= STAND_IN_MATCH_DB,
    searchedPrevFrames: prev.length,
    searchedNextFrames: next.length,
  }
}

describe.skipIf(!ffmpegAvailable)("stitchExtension (real ffmpeg)", () => {
  let dir: string
  /** An 854×480 @ 24 MP4, 3 s (72 frames), AAC sound. */
  let source: string
  /** A 1280×720 @ 24 MP4, 2 s (48 frames), no sound. */
  let extension: string

  /** Stitch into a fresh work dir with the fixed trims, and probe the result. */
  const stitch = async (sourcePath: string, extensionPath: string) => {
    const workDir = await fs.mkdtemp(join(dir, "w-"))
    const result = await stitchExtension({
      sourcePath,
      extensionPath,
      workDir,
      smartCut: { framesFromPrev: 8, framesFromNext: 8 },
      fallbackTrims: { trimEndFrames: 4, trimStartFrames: 3 },
      audioFadeSec: 0.15,
    })
    return { ...result, probed: await probe(result.outputPath) }
  }

  /** The source's picture chain exactly as the stitch builds it (`extendStitchArgs`, fed the real probe), its end trim 4. */
  const sourceChainOf = async (file: string, sourceFrames: number): Promise<string> => {
    const args = extendStitchArgs({
      sourcePath: file, extensionPath: extension, outputPath: join(dir, "unused.mp4"), source: await probeMatched(file),
      sourceFrames, extensionFrames: 60, trimEndFrames: 4, trimStartFrames: 3, audioFadeSec: 0.15, sourceHasAudio: false, extensionHasAudio: false,
    })
    const graph = args[args.indexOf("-filter_complex") + 1]!
    return graph.split(";").find((c) => c.endsWith("[sv]"))!.slice("[0:v:0]".length, -"[sv]".length)
  }

  /** Every picture frame `file` gives with these output options, as its framemd5 hash, in order. */
  const frameHashes = async (file: string, options: string[]): Promise<string[]> => (await runFfmpeg([
    "-v", "error", "-i", file, "-map", "0:v:0", "-an", ...options, "-fps_mode", "passthrough", "-f", "framemd5", "-",
  ])).split("\n").filter((l) => l && !l.startsWith("#")).map((l) => l.split(",").at(-1)!.trim())

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "extend-stitch-test-"))
    source = join(dir, "source.mp4")
    extension = join(dir, "extension.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "600k",
      "-c:a", "aac", "-shortest",
      source,
    ])
    await runFfmpeg([
      "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
      extension,
    ])
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("keeps the source's size, rate, pixel format and frame count, with the sound as long as the picture", async () => {
    const { outputPath, boundary, probed } = await stitch(source, extension)
    expect(boundary).toEqual({ matched: false, psnrDb: null, trimEndFrames: 4, trimStartFrames: 3, searchedPrevFrames: null, searchedNextFrames: null })
    expect(outputPath.endsWith(".mp4")).toBe(true)
    const { video } = probed
    expect(video.width).toBe(854)
    expect(video.height).toBe(480)
    expect(video.r_frame_rate).toBe("24/1")
    expect(video.avg_frame_rate).toBe("24/1")
    expect(video.pix_fmt).toBe("yuv420p")
    // The source less its end trim, then the extension less its start trim.
    expect(Number(video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  it("takes a 4:4:4 PCM MOV extension (a Seedance raw clip) onto an H.264 4:2:0 MP4 source as a 4:2:0 MP4 with AAC", async () => {
    const mov = join(dir, "extension-444.mov")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=2:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-c:a", "pcm_s16le", "-shortest",
      mov,
    ])
    const { outputPath, probed } = await stitch(source, mov)
    expect(outputPath.endsWith(".mp4")).toBe(true)
    expect(probed.brand).not.toBe("qt")
    expect(probed.video.pix_fmt).toBe("yuv420p")
    expect([probed.video.width, probed.video.height]).toEqual([854, 480])
    expect(probed.audio?.codec_name).toBe("aac")
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  // A full-range source (yuvj420p / pc, as some phones and screen recorders make):
  // delivered limited range, its levels converted in the stitch's one encode, so
  // the upload's browser-safe check takes it as it is. Flat black and white panels:
  // the full range's 0 and 255 land on about 16 and 235. A moving third panel gives
  // the clip a real bitrate: a clip of flat panels alone compresses to a few kb/s,
  // which the stitch then matches, and a flat region's level drifts at that rate.
  it.each<[string, ColourTags | undefined, string]>([
    ["with colour tags", { primaries: "bt709", transfer: "bt709", matrix: "bt709", range: "pc" }, "tv"],
    // No colour description at all: no signal type is written, which H.264 reads as limited.
    ["with no colour tags", undefined, "unknown"],
  ])("delivers a full-range source %s as limited range, levels converted, no second encode", async (_label, tags, range) => {
    const full = join(dir, `source-full-${tags ? "tagged" : "untagged"}.mp4`)
    // Tagged on any ffmpeg (`colourTagArgs`); untagged, only the full range is said.
    const tagging = tags ? colourTagArgs(tags) : undefined
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=black:s=160x90:r=24:d=3[b];color=c=white:s=160x90:r=24:d=3[w];testsrc2=s=160x90:r=24:d=3[t];[b][w][t]hstack=inputs=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      // The tags go on after the conversion to full range (`setparams` labels, it does not convert).
      "-vf", tagging ? `format=yuvj420p,${tagging.filter}` : "format=yuvj420p",
      "-c:v", "libx264", "-pix_fmt", "yuvj420p", "-b:v", "300k", ...(tagging ? tagging.encoder : ["-color_range", "pc"]),
      "-c:a", "aac", "-shortest",
      full,
    ])
    const levels = async (file: string, select: string): Promise<[number, number]> => {
      const out = await runFfmpeg(["-v", "error", "-i", file, "-vf", `${select},signalstats,metadata=print:file=-`, "-f", "null", "-"])
      const all = (key: string) => [...out.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=(\\d+)`, "g"))].map((m) => Number(m[1]))
      return [Math.min(...all("YMIN")), Math.max(...all("YMAX"))]
    }
    // The fixture really is full range (and tagged, when it is meant to be).
    expect((await probe(full)).video.pix_fmt).toBe("yuvj420p")
    expect(await levels(full, "null")).toEqual([0, 255])
    if (tags) {
      const fixture = JSON.parse(await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_primaries,color_transfer,color_space", "-of", "json", full])) as { streams: Array<Record<string, string>> }
      expect(fixture.streams[0]).toMatchObject({ color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709" })
    }

    const { outputPath, probed } = await stitch(full, extension)
    const stream = JSON.parse(await runFfprobe(["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt,color_range", "-of", "json", outputPath])) as { streams: Array<{ pix_fmt: string; color_range?: string }> }
    expect(stream.streams[0]!.pix_fmt).toBe("yuv420p")
    expect(stream.streams[0]!.color_range ?? "unknown").toBe(range)
    expect(await needsTranscode(outputPath)).toBe(false)
    // The source's frames (72 − 4), each flat panel's mean inside its edges: black at about
    // 16 and white at about 235, as limited range has them, not full range's 0 and 255.
    // (A mean over the flat region, not an extreme: encode noise moves a single pixel.)
    const meanLuma = async (x: number): Promise<number> => {
      const out = await runFfmpeg([
        "-v", "error", "-i", outputPath, "-vf", `select=lt(n\\,68),crop=120:70:${x}:10,signalstats,metadata=print:file=-`, "-f", "null", "-",
      ])
      const yavg = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
      expect(yavg).toHaveLength(68)
      return yavg.reduce((a, b) => a + b, 0) / yavg.length
    }
    const black = await meanLuma(20)
    const white = await meanLuma(180)
    expect(black).toBeGreaterThanOrEqual(12)
    expect(black).toBeLessThanOrEqual(20)
    expect(white).toBeGreaterThanOrEqual(230)
    expect(white).toBeLessThanOrEqual(240)
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
  }, 60_000)

  // A full-range source and an extension that starts with the source's own last frames in
  // limited range, as Seedance returns its picture. The matcher compares the two boundary
  // proxies' raw planes, so the source's proxy must be limited range too for the twins to match.
  it("finds the matched cut on a full-range source whose extension starts with its last frames, limited range", async () => {
    // Flat black and white panels (full range's 0 and 255) beside a moving one, 5 s of it.
    const panels = "color=c=black:s=160x90:r=24:d=5[b];color=c=white:s=160x90:r=24:d=5[w];testsrc2=s=160x90:r=24:d=5[t];[b][w][t]hstack=inputs=3"
    const bt709 = { primaries: "bt709", transfer: "bt709", matrix: "bt709" }
    const fullTags = colourTagArgs({ ...bt709, range: "pc" })
    const limitedTags = colourTagArgs({ ...bt709, range: "tv" })
    const full = join(dir, "source-full-twins.mp4")
    const twins = join(dir, "extension-twins.mp4")
    // The source: its first 72 frames (3 s), full range.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", panels,
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-vf", `trim=end_frame=72,format=yuvj420p,${fullTags.filter}`,
      "-c:v", "libx264", "-pix_fmt", "yuvj420p", "-b:v", "300k", ...fullTags.encoder,
      "-c:a", "aac", "-shortest",
      full,
    ])
    // The extension: the same picture from the source's last 4 frames on (frames 68–115), limited range.
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", panels,
      "-vf", `trim=start_frame=68:end_frame=116,setpts=PTS-STARTPTS,format=yuv420p,${limitedTags.filter}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "14", ...limitedTags.encoder, "-an",
      twins,
    ])
    expect((await probeMatched(full)).colorRange).toBe("pc")
    expect((await probeMatched(twins)).colorRange).toBe("tv")

    const registered = getSmartCutMatcher()
    registerSmartCutMatcher(standInMatcher)
    try {
      const { boundary, probed } = await stitch(full, twins)
      expect(boundary.matched, JSON.stringify(boundary)).toBe(true)
      expect(boundary.psnrDb).toBeGreaterThanOrEqual(STAND_IN_MATCH_DB)
      // A twin pair: the source's frame 64 + 7 − end trim is the extension's 68 + start trim − 1.
      expect(boundary.trimEndFrames + boundary.trimStartFrames, JSON.stringify(boundary)).toBe(4)
      expect(Number(probed.video.nb_read_frames)).toBe(72 + 48 - 4)
    } finally {
      registerSmartCutMatcher(registered as SmartCutMatcher)
    }
  }, 60_000)

  // Each proxy carries a margin of frames beyond its window (the matcher clamps a
  // window to the clip it is given), so an 8 × 8 search gets proxies of 10 frames.
  it("gives the matcher proxies of 10 frames each for an 8 × 8 search", async () => {
    const calls: Array<{ prevFrames: number; nextFrames: number; framesFromPrev: number; framesFromNext: number; mode: string }> = []
    const recording: SmartCutMatcher = async (prevPath, nextPath, framesFromPrev, framesFromNext, mode) => {
      calls.push({ prevFrames: (await lumaPlanes(prevPath)).length, nextFrames: (await lumaPlanes(nextPath)).length, framesFromPrev, framesFromNext, mode })
      // No genuine match: the fixed trims apply.
      return { trimEndFrames: 0, trimStartFrames: 1, psnr: 10, matched: false, searchedPrevFrames: framesFromPrev, searchedNextFrames: framesFromNext }
    }
    const registered = getSmartCutMatcher()
    registerSmartCutMatcher(recording)
    try {
      const { boundary } = await stitch(source, extension)
      expect(calls).toEqual([{ prevFrames: 10, nextFrames: 10, framesFromPrev: 8, framesFromNext: 8, mode: "best-pair" }])
      expect(boundary).toMatchObject({ matched: false, trimEndFrames: 4, trimStartFrames: 3 })
    } finally {
      registerSmartCutMatcher(registered as SmartCutMatcher)
    }
  }, 60_000)

  // A native extension (PixVerse V6) that opens on a hold: its first 4 frames are one
  // picture, byte-identical, then the picture moves on. Cut lossless, as the native cut
  // is (`native-extension-cut.ts`), at the source's size and rate. The leading repeats
  // are each new frame against the new frame before it.
  describe("an extension that opens on a 4-frame hold", () => {
    /** The hold is the source's last frame (decoded, bit for bit), with a tone: the matcher finds its twin there. */
    let held: string
    /** The hold is a picture unlike the source's last frame (as PixVerse's re-render can be), with a tone: no twin to find. */
    let heldApart: string

    beforeAll(async () => {
      held = join(dir, "extension-held.mov")
      heldApart = join(dir, "extension-held-apart.mov")
      await runFfmpeg([
        "-y",
        "-i", source,
        "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=5",
        "-f", "lavfi", "-i", "sine=frequency=550:duration=2:sample_rate=48000",
        "-filter_complex",
        "[0:v:0]trim=start_frame=71:end_frame=72,setpts=PTS-STARTPTS,loop=loop=3:size=1:start=0,setpts=N/(24*TB)[h];" +
          "[1:v:0]trim=start_frame=72:end_frame=116,setpts=PTS-STARTPTS[m];" +
          "[h][m]concat=n=2:v=1:a=0,fps=24,format=yuv420p[v]",
        "-map", "[v]", "-map", "2:a:0", "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-c:a", "pcm_s24le",
        held,
      ])
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=7",
        "-f", "lavfi", "-i", "sine=frequency=660:duration=2:sample_rate=48000",
        "-filter_complex",
        "[0:v:0]split[a][b];" +
          "[a]trim=start_frame=100:end_frame=101,setpts=PTS-STARTPTS,loop=loop=3:size=1:start=0,setpts=N/(24*TB)[h];" +
          "[b]trim=start_frame=101:end_frame=145,setpts=PTS-STARTPTS[m];" +
          "[h][m]concat=n=2:v=1:a=0,fps=24,format=yuv420p[v]",
        "-map", "[v]", "-map", "1:a:0", "-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-c:a", "pcm_s24le",
        heldApart,
      ])
      for (const fixture of [await probe(held), await probe(heldApart)]) {
        expect(Number(fixture.video.nb_read_frames)).toBe(48)
        expect(fixture.video.r_frame_rate).toBe("24/1")
      }
    }, 60_000)

    const stitchHeld = async (extensionPath: string) => {
      const workDir = await fs.mkdtemp(join(dir, "w-"))
      const result = await stitchExtension({
        sourcePath: source,
        extensionPath,
        workDir,
        smartCut: { framesFromPrev: 8, framesFromNext: 8 },
        fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
        audioFadeSec: 0.15,
        dropLeadingRepeats: true,
      })
      return { ...result, probed: await probe(result.outputPath) }
    }

    /** Runs `fn` with `matcher` registered, then puts back whatever was. */
    const withMatcher = async <T>(matcher: SmartCutMatcher, fn: () => Promise<T>): Promise<T> => {
      const registered = getSmartCutMatcher()
      registerSmartCutMatcher(matcher)
      try {
        return await fn()
      } finally {
        registerSmartCutMatcher(registered as SmartCutMatcher)
      }
    }

    it("a hold whose first frame is the matched twin: the cut drops the twin, the repeat drop the rest of the hold", async () => {
      const { outputPath, boundary, probed } = await withMatcher(standInMatcher, () => stitchHeld(held))
      expect(boundary.matched, JSON.stringify(boundary)).toBe(true)
      expect(boundary.trimEndFrames, JSON.stringify(boundary)).toBe(0)
      // The twin and every repeat after it: the 4 held frames.
      expect(boundary.trimStartFrames, JSON.stringify(boundary)).toBe(4)
      expect(Number(probed.video.nb_read_frames)).toBe(72 + 48 - 4)
      // The extension's sound loses the same time as its picture, from its start: the two end together.
      expectLocked(probed)
      // The source's last frame is followed by the moving picture, not by a hold.
      const luma = await lumaPlanes(outputPath)
      expect(lumaPsnr(luma[71]!, luma[72]!)).toBeLessThan(40)
    }, 60_000)

    it("no match: the fixed trims 0/0, the hold's first frame kept and its 3 repeats dropped, the sound with the picture", async () => {
      const { outputPath, boundary, probed } = await withMatcher(standInMatcher, () => stitchHeld(heldApart))
      expect(boundary).toMatchObject({ matched: false, trimEndFrames: 0, trimStartFrames: 3 })
      expect(boundary.psnrDb).toBeLessThan(STAND_IN_MATCH_DB)
      expect(Number(probed.video.nb_read_frames)).toBe(72 + 48 - 3)
      expectLocked(probed)
      // The source's last frame, the hold's one frame, then the moving picture.
      const luma = await lumaPlanes(outputPath)
      expect(lumaPsnr(luma[71]!, luma[72]!)).toBeLessThan(40)
      expect(lumaPsnr(luma[72]!, luma[73]!)).toBeLessThan(40)
    }, 60_000)

    it("with no matcher: new[0] kept, new[1..3] dropped", async () => {
      const { boundary, probed } = await stitchHeld(held)
      expect(boundary).toEqual({ matched: false, psnrDb: null, trimEndFrames: 0, trimStartFrames: 3, searchedPrevFrames: null, searchedNextFrames: null })
      expect(Number(probed.video.nb_read_frames)).toBe(72 + 48 - 3)
      expectLocked(probed)
    }, 60_000)

    it("drops nothing without the flag (Seedance, Kling 4): the hold plays", async () => {
      const workDir = await fs.mkdtemp(join(dir, "w-"))
      const { boundary } = await stitchExtension({
        sourcePath: source, extensionPath: held, workDir,
        smartCut: { framesFromPrev: 8, framesFromNext: 8 },
        fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
        audioFadeSec: 0.15,
      })
      expect(boundary.trimStartFrames).toBe(0)
    }, 60_000)
  })

  // PixVerse's frame rate is not the source's: a 24 fps new part on a 60 fps source shows
  // each PixVerse frame on 2 or 3 output frames. Repeats are PixVerse's own frames repeating
  // each other, never the conform's copies, and what is dropped is their time.
  describe("a 24 fps new part on a 60 fps source", () => {
    /** 640×360 @ 60, 3 s (180 frames), with a tone. */
    let source60: string
    /** 24 fps, 2 s (48 frames), every frame moving, a tone; cut lossless like the native cut. */
    let moving24: string
    /** The same, but PixVerse frames 1–4 repeat frame 0 (byte-identical) before it moves. */
    let held24: string

    beforeAll(async () => {
      source60 = join(dir, "source-60.mp4")
      moving24 = join(dir, "extension-24-moving.mov")
      held24 = join(dir, "extension-24-held.mov")
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=60:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "1500k", "-c:a", "aac", "-shortest",
        source60,
      ])
      const tone = ["-f", "lavfi", "-i", "sine=frequency=660:duration=2:sample_rate=48000"]
      const lossless = ["-c:v", "libx264", "-preset", "veryfast", "-qp", "0", "-c:a", "pcm_s24le"]
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=2", ...tone,
        "-map", "0:v:0", "-map", "1:a:0", "-vf", "format=yuv420p", ...lossless, moving24,
      ])
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=3", ...tone,
        "-filter_complex",
        "[0:v:0]split[a][b];" +
          "[a]trim=end_frame=1,setpts=PTS-STARTPTS,loop=loop=4:size=1:start=0,setpts=N/(24*TB)[h];" +
          "[b]trim=start_frame=1:end_frame=44,setpts=PTS-STARTPTS[m];" +
          "[h][m]concat=n=2:v=1:a=0,fps=24,format=yuv420p[v]",
        "-map", "[v]", "-map", "1:a:0", ...lossless, held24,
      ])
      for (const fixture of [await probe(moving24), await probe(held24)]) {
        expect(Number(fixture.video.nb_read_frames)).toBe(48)
        expect(fixture.video.r_frame_rate).toBe("24/1")
      }
    }, 60_000)

    const stitch24 = async (extensionPath: string) => {
      const workDir = await fs.mkdtemp(join(dir, "w-"))
      const result = await stitchExtension({
        sourcePath: source60,
        extensionPath,
        workDir,
        smartCut: { framesFromPrev: 8, framesFromNext: 8 },
        fallbackTrims: { trimEndFrames: 0, trimStartFrames: 0 },
        audioFadeSec: 0.15,
        dropLeadingRepeats: true,
      })
      return { ...result, probed: await probe(result.outputPath) }
    }

    it("drops nothing when every PixVerse frame moves, though the conform repeats each one", async () => {
      const { boundary, probed } = await stitch24(moving24)
      expect(boundary.trimStartFrames).toBe(0)
      expect(Number(probed.video.nb_read_frames)).toBe(180 + 120)
      expectLocked(probed)
    }, 60_000)

    it("drops a 4-frame repeat's time (4/24 s: 10 output frames) after frame 0's own", async () => {
      const { outputPath, boundary, probed } = await stitch24(held24)
      expect(boundary).toEqual({ matched: false, psnrDb: null, trimEndFrames: 0, trimStartFrames: 10, searchedPrevFrames: null, searchedNextFrames: null })
      expect(Number(probed.video.nb_read_frames)).toBe(180 + 120 - 10)
      expectLocked(probed)
      // PixVerse frame 0 on output frames 180–182, then frame 5 on: no hold left.
      const luma = await lumaPlanes(outputPath)
      expect(lumaPsnr(luma[182]!, luma[183]!)).toBeLessThan(40)
    }, 60_000)
  })

  it("delivers a 4:4:4 PCM MOV source (a chained raw clip) as an H.264 4:2:0 MP4 with AAC, at its size", async () => {
    const mov = join(dir, "source-444.mov")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv444p", "-b:v", "600k", "-c:a", "pcm_s16le", "-shortest",
      mov,
    ])
    const { outputPath, probed } = await stitch(mov, extension)
    expect(outputPath.endsWith(".mp4")).toBe(true)
    expect(probed.brand).not.toBe("qt")
    expect(probed.video.codec_name).toBe("h264")
    expect(probed.video.pix_fmt).toBe("yuv420p")
    expect([probed.video.width, probed.video.height]).toEqual([854, 480])
    expect(probed.audio?.codec_name).toBe("aac")
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  // A near-static H.264 source compresses to a few kb/s; matched as it is, the moving extension
  // after it would be starved. The stitch encodes at the floor instead (ruling AI): 0.1 bits per
  // pixel per frame at the output's size and rate, 320 × 180 × 24 × 0.1 = 138,240 b/s here.
  it("encodes a near-static, low-bitrate H.264 source at the floor, not at its own rate", async () => {
    const still = join(dir, "source-still.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=gray:s=320x180:r=24:d=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "300k", "-c:a", "aac", "-shortest",
      still,
    ])
    const floor = 320 * 180 * 24 * 0.1
    const own = (await probeMatched(still)).videoBitRate!
    // The fixture really is far below the floor (a flat picture compresses to almost nothing).
    expect(own).toBeLessThan(floor / 10)

    const { outputPath, probed } = await stitch(still, extension)
    // Two passes at the floor, as the encoder records its target (in kb/s)…
    const settings = await x264Settings(outputPath)
    expect(settings).toMatch(/ rc=2pass /)
    expect(settings).toContain(` bitrate=${Math.floor(floor / 1000)} `)
    // …and the result's picture comes out near it, many times the source's own rate.
    const rate = Number((JSON.parse(await runFfprobe([
      "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=bit_rate", "-of", "json", outputPath,
    ])) as { streams: Array<{ bit_rate: string }> }).streams[0]!.bit_rate)
    expect(rate).toBeGreaterThan(floor * 0.5)
    expect(rate).toBeLessThan(floor * 1.5)
    expect(rate).toBeGreaterThan(own * 10)
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  // An iPhone's default: HEVC, whose bitrate does not carry its quality over to H.264.
  it.skipIf(!x265Available)("encodes an HEVC source once, at the near-lossless constant quality, as H.264 the upload takes as it is", async () => {
    const hevc = join(dir, "source-hevc.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=854x480:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx265", "-preset", "ultrafast", "-x265-params", "log-level=error", "-b:v", "300k", "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
      "-c:a", "aac", "-shortest",
      hevc,
    ])
    expect((await probe(hevc)).video.codec_name).toBe("hevc")

    const { outputPath, probed } = await stitch(hevc, extension)
    expect(probed.video.codec_name).toBe("h264")
    expect(probed.video.pix_fmt).toBe("yuv420p")
    expect([probed.video.width, probed.video.height]).toEqual([854, 480])
    expect(await needsTranscode(outputPath)).toBe(false)
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
    // One pass at CRF 14, as the encoder records it, and no two-pass log beside the result.
    const settings = await x264Settings(outputPath)
    expect(settings).toMatch(/ rc=crf /)
    expect(settings).toMatch(/ crf=14\.0 /)
    expect((await fs.readdir(dirname(outputPath))).filter((f) => f.startsWith("stitch-pass"))).toEqual([])

    // The H.264 source, for contrast: its bitrate, in two passes.
    const h264 = await stitch(source, extension)
    expect(await x264Settings(h264.outputPath)).toMatch(/ rc=2pass /)
    expect((await fs.readdir(dirname(h264.outputPath))).some((f) => f.startsWith("stitch-pass"))).toBe(true)
  }, 60_000)

  // An HDR source (an iPhone's HLG, an HDR10 file's PQ) comes back in SDR BT.709, the
  // extension's own: tone-mapped in the one encode, tagged BT.709, so the upload takes it as
  // it is. The fixture only carries the tags (8-bit H.264): the tags are what the stitch reads.
  it.skipIf(!zscaleAvailable).each([
    ["HLG", "arib-std-b67"],
    ["PQ", "smpte2084"],
  ])("delivers an %s source in SDR BT.709, limited range, no second encode", async (_label, transfer) => {
    const hdr = join(dir, `source-${transfer}.mp4`)
    await writeTaggedClip(hdr, hdrTags(transfer), { size: "854x480", seconds: 3, bitRate: "600k" })
    const colourOf = async (file: string) => (JSON.parse(await runFfprobe([
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=pix_fmt,color_primaries,color_transfer,color_space,color_range", "-of", "json", file,
    ])) as { streams: Array<Record<string, string | undefined>> }).streams[0]!
    // The fixture really is tagged HDR.
    expect((await colourOf(hdr)).color_transfer).toBe(transfer)

    const { outputPath, probed } = await stitch(hdr, extension)
    expect(await colourOf(outputPath)).toMatchObject({
      pix_fmt: "yuv420p", color_primaries: "bt709", color_transfer: "bt709", color_space: "bt709", color_range: "tv",
    })
    expect(probed.video.codec_name).toBe("h264")
    expect(await needsTranscode(outputPath)).toBe(false)
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
    // The source's frames are a picture, not black or blown out.
    const out = await runFfmpeg(["-v", "error", "-i", outputPath, "-vf", "select=lt(n\\,68),signalstats,metadata=print:file=-", "-f", "null", "-"])
    const yavg = [...out.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]))
    expect(yavg).toHaveLength(68)
    for (const y of yavg) {
      expect(y).toBeGreaterThan(30)
      expect(y).toBeLessThan(230)
    }
  }, 60_000)

  it("keeps the sound with the picture for a variable-rate WebM source (its demuxer reports a rate it never measured)", async () => {
    // 120 frames spread over ~4.6 s (a 0.2 s gap after every second), Opus sound
    // for the whole span: the Matroska demuxer reports 30/1 for both rates.
    const webm = join(dir, "source-vfr.webm")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=4,setpts=N/30/TB+0.2*floor(N/30)/TB",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=4.65:sample_rate=48000",
      "-fps_mode", "passthrough",
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k",
      "-c:a", "libopus",
      webm,
    ])
    const { probed } = await stitch(webm, extension)
    expect([probed.video.width, probed.video.height]).toEqual([320, 180])
    expect(probed.video.r_frame_rate).toBe("30/1")
    expectLocked(probed)
  }, 60_000)

  it("keeps the sound with the picture when a source's and an extension's containers outlast their pictures", async () => {
    // A WebM states no length of its own picture; its container's runs 0.2 s past it (the sound's).
    const webm = join(dir, "overshoot.webm")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3.2:sample_rate=48000",
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "300k",
      "-c:a", "libopus",
      webm,
    ])
    const { probed } = await stitch(webm, webm)
    expectLocked(probed)
  }, 60_000)

  it("keeps the sound with the picture for an MP4 whose rate drops for its last frames", async () => {
    // 170 frames at 30 fps, then 10 at 15 fps (a phone clip slowing as the light drops):
    // it probes as a near-constant 5400/187 average against a 30/1 nominal rate. The
    // timestamps are whole ticks of testsrc2's 1/30 time base, so no two frames share one.
    const mp4 = join(dir, "source-slow-tail.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30:duration=6,setpts='if(lt(N\\,170)\\,N\\,170+2*(N-170))'",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6.4:sample_rate=48000",
      "-fps_mode", "passthrough",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      mp4,
    ])
    const { probed } = await stitch(mp4, extension)
    expectLocked(probed)

    // Conformed to its nominal 30 fps, not its average: every frame of its 30 fps body passes, exactly once,
    // in order; only the 15 fps tail repeats (each frame twice, as it was shown).
    const chain = await sourceChainOf(mp4, 180)
    const conformed = await frameHashes(mp4, ["-vf", chain])
    const body = await frameHashes(mp4, ["-frames:v", "170"])
    for (const hash of body) expect(conformed.filter((h) => h === hash)).toHaveLength(1)
    expect(conformed.slice(0, 170)).toEqual(body)
    expect(chain.startsWith("fps=30/1,")).toBe(true)
    expect(probed.video.r_frame_rate).toBe("30/1")
  }, 60_000)

  it("conforms an even-rate (30000/1001) source without repeating or dropping a frame", async () => {
    const ntsc = join(dir, "source-ntsc.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30000/1001:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      ntsc,
    ])
    const sourceFrames = Number((await probe(ntsc)).video.nb_read_frames)
    const kept = sourceFrames - 4

    // The source's chain exactly as the stitch builds it, run alone: its frames, hashed as decoded.
    const chain = await sourceChainOf(ntsc, sourceFrames)
    expect(chain.startsWith("fps=30000/1001,")).toBe(true)
    const conformed = await frameHashes(ntsc, ["-vf", chain])
    // Every frame the source shows, once each, in order, up to its end trim.
    expect(conformed).toHaveLength(kept)
    expect(conformed).toEqual(await frameHashes(ntsc, ["-frames:v", String(kept)]))

    // And the stitch keeps that many: the source less its end trim, then the extension (2 s at the source's rate) less its start trim.
    const { probed } = await stitch(ntsc, extension)
    expect(probed.video.r_frame_rate).toBe("30000/1001")
    expect(Number(probed.video.nb_read_frames)).toBe(kept + (60 - 3))
    expectLocked(probed)
  }, 60_000)

  it("keeps the sound with the picture for a slideshow below 1 fps (put on 1 fps)", async () => {
    // Five pictures over 10 s (1/2 fps) with sound, and a 5 s 24 fps extension with sound.
    const slides = join(dir, "source-slides.mp4")
    const longer = join(dir, "extension-5s.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=1/2:duration=10",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=10:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      slides,
    ])
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24:duration=5",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=5:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      longer,
    ])
    const { probed } = await stitch(slides, longer)
    expectLocked(probed)
  }, 60_000)

  it("keeps a 120 fps source at 120/1, every frame of it", async () => {
    const fast = join(dir, "source-120.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=120:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      fast,
    ])
    const sourceFrames = Number((await probe(fast)).video.nb_read_frames)
    const kept = sourceFrames - 4
    const chain = await sourceChainOf(fast, sourceFrames)
    const conformed = await frameHashes(fast, ["-vf", chain])
    expect(conformed).toHaveLength(kept)
    expect(conformed).toEqual(await frameHashes(fast, ["-frames:v", String(kept)]))
    expect(chain.startsWith("fps=120/1,")).toBe(true)

    // The extension (2 s) at 120 fps less its start trim.
    const { probed } = await stitch(fast, extension)
    expect(probed.video.r_frame_rate).toBe("120/1")
    expect(Number(probed.video.nb_read_frames)).toBe(kept + (240 - 3))
    expectLocked(probed)
  }, 60_000)

  it("labels an NTSC MOV on a millisecond timescale 30000/1001, its nominal rate, and keeps every frame", async () => {
    // Its timestamps are rounded to the millisecond, so its average reads 8900/297, off the NTSC grid.
    const mov = join(dir, "source-ntsc-ms.mov")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=30000/1001:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-video_track_timescale", "1000",
      mov,
    ])
    const sourceFrames = Number((await probe(mov)).video.nb_read_frames)
    const kept = sourceFrames - 4
    const chain = await sourceChainOf(mov, sourceFrames)
    expect(chain.startsWith("fps=30000/1001,")).toBe(true)
    expect(await frameHashes(mov, ["-vf", chain])).toEqual(await frameHashes(mov, ["-frames:v", String(kept)]))

    const { outputPath, probed } = await stitch(mov, extension)
    // A MOV source still delivers an MP4.
    expect(outputPath.endsWith(".mp4")).toBe(true)
    expect(probed.brand).not.toBe("qt")
    expect(probed.video.r_frame_rate).toBe("30000/1001")
    expect(Number(probed.video.nb_read_frames)).toBe(kept + (60 - 3))
    expectLocked(probed)
  }, 60_000)

  it("stitches onto a source shown rotated 90°: upright pixels at its displayed size, no display matrix", async () => {
    const rotated = join(dir, "source-rot90.mp4")
    await runFfmpeg(["-y", "-display_rotation:v:0", "90", "-i", source, "-c", "copy", rotated])
    const { probed } = await stitch(rotated, extension)
    expect([probed.video.width, probed.video.height]).toEqual([480, 854])
    expect(probed.video.side_data_list ?? []).toEqual([])
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  it("stitches onto a source shown rotated 180°: its size, upright pixels, no display matrix", async () => {
    const rotated = join(dir, "source-rot180.mp4")
    await runFfmpeg(["-y", "-display_rotation:v:0", "180", "-i", source, "-c", "copy", rotated])
    const { probed } = await stitch(rotated, extension)
    expect([probed.video.width, probed.video.height]).toEqual([854, 480])
    expect(probed.video.side_data_list ?? []).toEqual([])
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  // H.264 4:2:0 needs even sides: an odd-size source is delivered at its size rounded down to
  // even. `testsrc2` rounds an odd size itself, so the fixture is `testsrc` in 4:4:4 (which
  // libx264 stores at any size), and it is checked to really be 853×481.
  describe("an odd-size source", () => {
    let odd: string

    beforeAll(async () => {
      odd = join(dir, "source-853x481.mp4")
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "testsrc=size=853x481:rate=24:duration=3",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
        "-c:v", "libx264", "-pix_fmt", "yuv444p", "-b:v", "600k",
        "-c:a", "aac", "-shortest",
        odd,
      ])
    }, 60_000)

    it("is delivered at 852×480, H.264 4:2:0, every frame the even source keeps", async () => {
      const fixture = (await probe(odd)).video
      expect([fixture.width, fixture.height]).toEqual([853, 481])
      const { outputPath, probed } = await stitch(odd, extension)
      expect(outputPath.endsWith(".mp4")).toBe(true)
      expect(probed.video.codec_name).toBe("h264")
      expect(probed.video.pix_fmt).toBe("yuv420p")
      expect([probed.video.width, probed.video.height]).toEqual([852, 480])
      expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
      expect(await needsTranscode(outputPath)).toBe(false)
      expectLocked(probed)
    }, 60_000)

    it("shown rotated 90°: delivered upright at 480×852", async () => {
      const rotated = join(dir, "source-853x481-rot90.mp4")
      await runFfmpeg(["-y", "-display_rotation:v:0", "90", "-i", odd, "-c", "copy", rotated])
      const { probed } = await stitch(rotated, extension)
      expect([probed.video.width, probed.video.height]).toEqual([480, 852])
      expect(probed.video.side_data_list ?? []).toEqual([])
      expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
      expectLocked(probed)
    }, 60_000)
  })

  it("stitches onto a non-square-pixel source: its size and SAR", async () => {
    const anamorphic = join(dir, "source-sar.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "testsrc2=size=720x480:rate=24:duration=3,setsar=32/27",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-b:v", "600k",
      "-c:a", "aac", "-shortest",
      anamorphic,
    ])
    const { probed } = await stitch(anamorphic, extension)
    expect([probed.video.width, probed.video.height]).toEqual([720, 480])
    expect(probed.video.sample_aspect_ratio).toBe("32:27")
    expect(Number(probed.video.nb_read_frames)).toBe(72 - 4 + (48 - 3))
    expectLocked(probed)
  }, 60_000)

  // Picture and sound that start apart in their container (a stream-copied trim, some phone
  // and platform muxes): a white flash and a 1 kHz beep presented together at 1 s, one stream
  // starting `delay` after the other. The result must keep the input's own sync as played.
  describe("keeps lip-sync when a clip's picture and sound start apart", () => {
    /** A black, silent 3 s clip: the other side of each stitch, so the first flash and beep are the clip's. */
    let plain: string

    beforeAll(async () => {
      plain = join(dir, "plain.mp4")
      await runFfmpeg([
        "-y",
        "-f", "lavfi", "-i", "color=c=black:size=320x180:rate=24:duration=3",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-t", "3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
        plain,
      ])
    }, 60_000)

    /** The flash and the beep, played together at 1 s; `late` starts `delay` after the other stream. */
    const flashAndBeep = async (late: "picture" | "sound", delay: number): Promise<string> => {
      const tag = `${late}-${delay.toFixed(4)}`
      const picture = join(dir, `flash-${tag}.mp4`)
      const sound = join(dir, `beep-${tag}.m4a`)
      const clip = join(dir, `flash-beep-${tag}.mp4`)
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", "color=c=black:size=320x180:rate=24:duration=3",
        "-vf", "drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(n,24,25)'",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", picture,
      ])
      // The beep sits where it plays at 1 s: later in a sound that starts first, earlier in one that starts late.
      const beep = late === "picture" ? 1 + delay : 1 - delay
      await runFfmpeg([
        "-y", "-f", "lavfi", "-i", `sine=frequency=1000:sample_rate=48000:duration=${late === "picture" ? 3 + delay : 3}`,
        "-af", `volume=enable='not(between(t,${beep},${beep + 0.1}))':volume=0`, "-c:a", "aac", sound,
      ])
      // The late stream is the second input, offset by `delay`.
      const [first, second] = late === "picture" ? [sound, picture] : [picture, sound]
      await runFfmpeg([
        "-y", "-itsoffset", "0", "-i", first, "-itsoffset", String(delay), "-i", second,
        "-map", late === "picture" ? "1:v" : "0:v", "-map", late === "picture" ? "0:a" : "1:a", "-c", "copy", clip,
      ])
      return clip
    }

    /** When the first flash shows and the first beep sounds, as a player presents `file`. */
    const flashAndBeepAt = async (file: string): Promise<{ flash: number; beep: number }> => {
      const stats = join(dir, `yavg-${Math.random().toString(36).slice(2)}.txt`)
      await runFfmpeg([
        "-y", "-v", "error", "-i", file, "-map", "0:v",
        "-vf", `signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=${stats}`, "-f", "null", "-",
      ])
      let time = Number.NaN
      let flash = Number.NaN
      for (const line of (await fs.readFile(stats, "utf8")).split("\n")) {
        const pts = /pts_time:([-\d.]+)/.exec(line)
        if (pts) time = Number(pts[1])
        const yavg = /YAVG=([\d.]+)/.exec(line)
        if (yavg && Number(yavg[1]) > 100) {
          flash = time
          break
        }
      }
      const { stderr } = await runFfmpegCapture(["-i", file, "-map", "0:a", "-af", "silencedetect=n=-30dB:d=0.05", "-f", "null", "-"])
      const beep = Number(/silence_end: ([\d.]+)/.exec(stderr)?.[1])
      return { flash, beep }
    }

    /** The result's beep sits on its flash as the input's own does: within half a frame (24 fps). */
    const expectSameSync = async (input: string, result: string) => {
      const before = await flashAndBeepAt(input)
      const after = await flashAndBeepAt(result)
      expect(Number.isFinite(after.flash) && Number.isFinite(after.beep), JSON.stringify(after)).toBe(true)
      expect(Math.abs((after.beep - after.flash) - (before.beep - before.flash)), JSON.stringify({ before, after })).toBeLessThan(1 / 48)
    }

    const cases = [
      ["picture", 2 / 24], ["picture", 0.5], ["sound", 2 / 24], ["sound", 0.5],
    ] as const

    it.each(cases)("on the source: its %s starting %ss after the other", async (late, delay) => {
      const clip = await flashAndBeep(late, delay)
      const { outputPath, probed } = await stitch(clip, plain)
      await expectSameSync(clip, outputPath)
      expectLocked(probed)
    }, 60_000)

    it.each(cases)("on the extension: its %s starting %ss after the other", async (late, delay) => {
      const clip = await flashAndBeep(late, delay)
      const { outputPath, probed } = await stitch(plain, clip)
      await expectSameSync(clip, outputPath)
      expectLocked(probed)
    }, 60_000)
  })
})

/**
 * Seedance 2.5's extension is UN-ANCHORED (decided 2026-11-12): the model is
 * sent no start image and declares the request an extension, so its first
 * frame follows the source's last instead of repeating it. Nothing at the join
 * is a duplicate, and the recipe's stitch (`TAIL_RECIPES["seedance-2-5-extend"].stitch`)
 * searches nothing and trims nothing: a hard cut at the source's end, the
 * sound crossfaded across it. Pinned on real media: every frame of both clips
 * is kept, in order, the extension's first right after the source's last, and
 * the sound still ends with the picture. The 2.0 recipe's fallback trims on
 * the same pair would have dropped 4 + 3 real frames.
 */
describe.skipIf(!ffmpegAvailable)("stitchExtension — an un-anchored extension (Seedance 2.5's recipe, real ffmpeg)", () => {
  let dir: string
  /** An 854×480 @ 24 MP4, 3 s (72 frames) of white, with a 440 Hz tone. */
  let source: string
  /** A 1280×720 @ 24 MP4, 2 s (48 frames) of black — nothing like the source's last frame — with a 660 Hz tone. */
  let extension: string

  /** Every frame's mean luma (0–255). */
  const meanLumas = async (file: string): Promise<number[]> =>
    (await lumaPlanes(file)).map((plane) => plane.reduce((sum, v) => sum + v, 0) / plane.length)

  beforeAll(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "extend-stitch-unanchored-"))
    source = join(dir, "source.mp4")
    extension = join(dir, "extension.mp4")
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=white:size=854x480:rate=24:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      source,
    ])
    await runFfmpeg([
      "-y",
      "-f", "lavfi", "-i", "color=c=black:size=1280x720:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=660:duration=2:sample_rate=48000",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      extension,
    ])
  }, 120_000)

  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  })

  it("keeps every frame of both clips: the source whole, then the extension from its first frame, the sound locked", async () => {
    const recipe = TAIL_RECIPES["seedance-2-5-extend"].stitch
    const workDir = await fs.mkdtemp(join(dir, "w-"))
    const { outputPath, boundary } = await stitchExtension({ sourcePath: source, extensionPath: extension, workDir, ...recipe })

    // No search ran, nothing was trimmed.
    expect(boundary).toEqual({ matched: false, psnrDb: null, trimEndFrames: 0, trimStartFrames: 0, searchedPrevFrames: null, searchedNextFrames: null })
    const probed = await probe(outputPath)
    expect([probed.video.width, probed.video.height]).toEqual([854, 480])
    expect(Number(probed.video.nb_read_frames)).toBe(72 + 48)
    // The source's 72 white frames, then the extension's 48 black ones: the cut
    // falls exactly at the source's end, and the extension's first frame is there.
    const lumas = await meanLumas(outputPath)
    expect(lumas).toHaveLength(120)
    expect(lumas.slice(0, 72).every((l) => l > 200), "the source's frames, all of them").toBe(true)
    expect(lumas.slice(72).every((l) => l < 50), "the extension's frames, from its first").toBe(true)
    expectLocked(probed)
  }, 60_000)

  it("a registered matcher is never asked: an un-anchored join has no duplicate to find", async () => {
    const previous = getSmartCutMatcher()
    let asked = 0
    registerSmartCutMatcher(async (...args) => {
      asked++
      return standInMatcher(...args)
    })
    try {
      const workDir = await fs.mkdtemp(join(dir, "w-"))
      const { boundary } = await stitchExtension({ sourcePath: source, extensionPath: extension, workDir, ...TAIL_RECIPES["seedance-2-5-extend"].stitch })
      expect(asked).toBe(0)
      expect(boundary.trimEndFrames + boundary.trimStartFrames).toBe(0)
    } finally {
      registerSmartCutMatcher(previous as SmartCutMatcher)
    }
  }, 60_000)
})
